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
  await sessions.add({ id: child })
  return sessions
}

describe('TestSessions subagent retention', () => {
  it('shares the fixture binding and mirrors ownership counts after release', async () => {
    const sessions = await bench()
    const face: ISessions = sessions
    const before = sessions.list.getSnapshot()
    const first: SessionReference = face.retain(address, { source: 'testFixture' })
    const second = face.retain(address, { source: 'testFixture' })
    const binding = face.binding(child)
    expect(binding?.session).toBe(sessions.behavior(child))
    expect(face.subagentAddress(child)).toEqual(address)
    expect(sessions.list.getSnapshot()).not.toBe(before)
    expect(sessions.list.getSnapshot().byId[child]?.retainedBy).toEqual({ testFixture: 2 })
    await Promise.all([first.ready, second.ready])
    first.release()
    first.release()
    expect(face.binding(child)).toBe(binding)
    second.release()
    expect(face.binding(child)).toBeUndefined()
    expect(sessions.calls).toEqual([])
    expect(sessions.list.getSnapshot().byId[child]?.retainedBy).toEqual({})
  })

  it('rejects unknown fixtures and an aborted signal before allocating a reference', async () => {
    const sessions = await bench()
    expect(() => sessions.retain(SessionId('ghost'))).toThrow('test session "ghost" is not added')
    const reason = new Error('pane closed')
    expect(() => sessions.retain(address, { source: 'testFixture', signal: AbortSignal.abort(reason) })).toThrow(reason)
    expect(sessions.calls).toEqual([])
    expect(sessions.list.getSnapshot().byId[child]?.retainedBy).toEqual({})
  })

  it('cancels one reference independently and removes its lifetime listener', async () => {
    const sessions = await bench()
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const first = sessions.retain(address, { source: 'testFixture', signal: controller.signal })
    const second = sessions.retain(address)
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
    const reference = sessions.retain(address, { source: 'testFixture', signal: controller.signal })
    await reference.ready
    const previous = sessions.binding(child)
    await previous?.ctx.fiber.await()
    reference.release()
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
    await sessions.disposeScopes()
    const next = sessions.retain(address)
    await next.ready
    expect(sessions.binding(child)).not.toBe(previous)
    expect(sessions.list.getSnapshot().byId[child]?.retainedBy).toEqual({})
    next.release()
  })
})
