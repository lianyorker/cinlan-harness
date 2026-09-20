/** Fixture retention mirrors ownership without navigating away from the main Session. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { TestSessions } from '../src/sessions.ts'

const parent = SessionId('parent')
const child = SessionId('child')
const address: SubagentAddress = { parentSessionId: parent, childSessionId: child, mode: 'continuable' }
const roots: Context[] = []
afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
})

async function bench() {
  const ctx = new Context()
  roots.push(ctx)
  const sessions = new TestSessions(async (operation) => { await operation() }, ctx)
  await ctx.plugin(() => undefined)
  await sessions.add({ id: parent })
  await sessions.add({ id: child }, { current: false })
  sessions.list.update((draft) => {
    draft.subagentsByParent = {
      [parent]: {
        entries: [{ kind: 'child', id: child, label: 'Child', mode: 'continuable', activity: 'inactive', hasChildren: false }],
        parentAvailable: true, state: 'ready', error: null,
      },
    }
  })
  return sessions
}

describe('TestSessions retainSubagent', () => {
  it('shares the fixture binding and keeps selection unchanged after release', async () => {
    const sessions = await bench()
    const face: ISessions = sessions
    const before = sessions.list.getSnapshot()
    const first: SessionReference = face.retainSubagent(address)
    const second = face.retainSubagent(address)
    const binding = face.binding(child)
    expect(binding?.session).toBe(sessions.behavior(child))
    expect(binding?.session.getSnapshot().subagent).toEqual({ address, parentAvailable: true })
    expect(face.subagentAddress(child)).toEqual(address)
    expect(sessions.list.getSnapshot()).toBe(before)
    await Promise.all([first.ready, second.ready])
    first.release()
    first.release()
    expect(face.binding(child)).toBe(binding)
    second.release()
    expect(face.binding(child)).toBe(binding)
    expect(sessions.list.getSnapshot().current).toBe(parent)
    expect(sessions.calls.map(call => call.method)).toEqual(['retainSubagent', 'retainSubagent'])
  })

  it('rejects invalid addresses and an aborted signal before allocating a reference', async () => {
    const sessions = await bench()
    expect(() => sessions.retainSubagent({ ...address, parentSessionId: SessionId('wrong') }))
      .toThrow('not a healthy catalog child')
    const reason = new Error('pane closed')
    expect(() => sessions.retainSubagent(address, { signal: AbortSignal.abort(reason) })).toThrow(reason)
    expect(sessions.calls).toEqual([])
    expect(sessions.list.getSnapshot().current).toBe(parent)
  })

  it('cancels one reference independently and removes its lifetime listener', async () => {
    const sessions = await bench()
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const first = sessions.retainSubagent(address, { signal: controller.signal })
    const second = sessions.retainSubagent(address)
    const reason = new Error('pane changed')
    const rejected = expect(first.ready).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
    await second.ready
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(sessions.binding(child)?.session).toBe(sessions.behavior(child))
    second.release()
  })

  it('releases reference listeners when fixture scopes dispose', async () => {
    const sessions = await bench()
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const reference = sessions.retainSubagent(address, { signal: controller.signal })
    await reference.ready
    const previous = sessions.binding(child)
    await previous?.ctx.fiber.await()
    await sessions.disposeScopes()
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
    const next = sessions.retainSubagent(address)
    await next.ready
    reference.release()
    controller.abort()
    expect(sessions.binding(child)).not.toBe(previous)
    expect(sessions.list.getSnapshot().current).toBe(parent)
    next.release()
  })
})
