/** Independent catalog-child owners share history without changing main navigation. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubagentAddress, SubagentCatalog } from '@deepseek-ai/dsh-subagent/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ClientSessions } from '../src/client/sessions/service.ts'
import type { SessionReference } from '../src/client/index.ts'
import { deferred, err, FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

const parent = SessionId('parent')
const child = SessionId('child')
const address: SubagentAddress = { parentSessionId: parent, childSessionId: child, mode: 'continuable' }
const catalog: SubagentCatalog = {
  entries: [{ kind: 'child', id: child, label: 'Child', mode: 'continuable', activity: 'inactive', hasChildren: false }],
  parentAvailable: true,
}
const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function bench() {
  const ctx = new Context()
  const api = new FakeApiClient()
  const remote = fakeRemote(api)
  const svc = new ClientSessions(ctx, remote)
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(() => undefined)
  api.onSubagentList = id => Promise.resolve(ok(id === parent ? catalog : { entries: [], parentAvailable: false }))
  api.onList = () => Promise.resolve(ok({ items: [
    { sessionId: parent, updatedAt: 1, running: false, blank: false },
  ] as never[] }))
  await svc.refresh()
  svc.open(parent)
  await svc.refreshSubagents(parent)
  await vi.waitFor(() => { expect(svc.binding(parent)?.session.getSnapshot().openState).toBe('open') })
  return { ctx, api, svc }
}

function childBinding(svc: ClientSessions) {
  const binding = svc.binding(child)
  if (binding === undefined) throw new Error('expected retained child binding')
  return binding
}

describe('retainSubagent', () => {
  it('opens a resolved catalog child through its address while the parent stays selected', async () => {
    const { api, svc } = await bench()
    const before = svc.list.getSnapshot()
    const reference: SessionReference = svc.retainSubagent(address)
    const binding = childBinding(svc)
    expect(reference.sessionId).toBe(child)
    expect(binding.session.getSnapshot().subagent).toEqual({ address, parentAvailable: true })
    expect(svc.list.getSnapshot()).toBe(before)
    await reference.ready

    expect(api.callsOf('session.follow')).toContainEqual(expect.objectContaining({
      address: { kind: 'subagent', ...address },
    }))
    expect(api.callsOf('session.follow')).not.toContainEqual(expect.objectContaining({
      address: { kind: 'session', sessionId: child },
    }))
    expect(svc.list.getSnapshot().current).toBe(parent)
    await svc.refresh()
    await svc.refreshSubagents(parent)
    expect(childBinding(svc)).toBe(binding)
    expect(api.activeFollows(child)).toBe(1)
    await api.pushFollow(child, {
      type: 'event', event: { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    })
    expect(binding.eventSource.getSnapshot().entries).toHaveLength(1)
    reference.release()
    expect(svc.binding(child)).toBeUndefined()
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(0) })
    expect(api.activeFollows(parent)).toBe(1)
  })

  it('configures an already materialized cold child before its first open', async () => {
    const { api, svc } = await bench()
    svc.resolveAgentScope(child)
    const cold = childBinding(svc)
    expect(cold.session.getSnapshot().openState).toBe('cold')
    const reference = svc.retainSubagent(address)
    await reference.ready
    expect(childBinding(svc)).toBe(cold)
    expect(api.callsOf('session.follow')).toContainEqual(expect.objectContaining({
      address: { kind: 'subagent', ...address },
    }))
    expect(api.callsOf('session.follow')).not.toContainEqual(expect.objectContaining({
      address: { kind: 'session', sessionId: child },
    }))
    reference.release()
  })

  it('shares one follow until the last reference releases', async () => {
    const { api, svc } = await bench()
    const first = svc.retainSubagent(address)
    const second = svc.retainSubagent(address)
    const binding = childBinding(svc)
    await Promise.all([first.ready, second.ready])
    first.release()
    first.release()
    expect(childBinding(svc)).toBe(binding)
    expect(api.followStarts.filter(id => id === child)).toHaveLength(1)
    expect(api.activeFollows(child)).toBe(1)
    second.release()
    expect(svc.binding(child)).toBeUndefined()
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(0) })
  })

  it('preserves a selected main child when its sidebar reference releases', async () => {
    const { api, svc } = await bench()
    const reference = svc.retainSubagent(address)
    await reference.ready
    const binding = childBinding(svc)
    svc.openSubagent(address)
    reference.release()
    expect(svc.list.getSnapshot().current).toBe(child)
    expect(childBinding(svc)).toBe(binding)
    expect(api.activeFollows(child)).toBe(1)
    svc.open(parent)
    expect(svc.binding(child)).toBeUndefined()
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(0) })
  })

  it('preserves the retained child across selection changes and list removal', async () => {
    const { api, svc } = await bench()
    const reference = svc.retainSubagent(address)
    await reference.ready
    const binding = childBinding(svc)
    svc.open(child)
    svc.open(parent)
    svc.handleSessionRemoved(child)
    await svc.refresh()
    expect(childBinding(svc)).toBe(binding)
    expect(api.activeFollows(child)).toBe(1)
    expect(svc.list.getSnapshot().current).toBe(parent)
    reference.release()
    expect(svc.binding(child)).toBeUndefined()
  })

  it('keeps a listed child after its final reference releases', async () => {
    const { api, svc } = await bench()
    svc.handleSessionAdded({ sessionId: child, parentSessionId: parent, origin: 'subagent', updatedAt: 1, running: false, blank: false })
    await Promise.resolve()
    const reference = svc.retainSubagent(address)
    await reference.ready
    const binding = childBinding(svc)
    reference.release()
    expect(childBinding(svc)).toBe(binding)
    expect(api.activeFollows(child)).toBe(1)
    await svc.refresh()
    expect(svc.binding(child)).toBeUndefined()
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(0) })
  })

  it('clears the live inbox when a retained child becomes cold', async () => {
    const { api, svc } = await bench()
    const reference = svc.retainSubagent(address)
    await reference.ready
    const binding = childBinding(svc)
    const messageId = MessageId('queued-child-message')
    svc.handleControlFrame({
      type: 'queue', sessionId: child,
      items: [{ id: messageId, placement: 'queued', message: {
        id: messageId, content: [{ type: 'text', text: 'waiting' }],
      } }],
    })
    expect(binding.session.getSnapshot().queue).toHaveLength(1)
    svc.handleSessionRemoved(child)
    expect(binding.session.getSnapshot().queue).toEqual([])
    expect(childBinding(svc)).toBe(binding)
    expect(api.activeFollows(child)).toBe(1)
    reference.release()
  })

  it('uses the exact direct-parent catalog authority and mode', async () => {
    const { api, svc } = await bench()
    const before = svc.list.getSnapshot()
    for (const invalid of [
      { ...address, parentSessionId: SessionId('other-parent') },
      { ...address, childSessionId: SessionId('missing') },
      { ...address, mode: 'one-shot' as const },
    ]) expect(() => svc.retainSubagent(invalid)).toThrow('not a healthy catalog child')
    expect(svc.list.getSnapshot()).toBe(before)
    expect(svc.binding(child)).toBeUndefined()
    expect(api.followStarts).not.toContain(child)
  })

  it('routes continuation and interruption through the retained direct parent', async () => {
    const { api, svc } = await bench()
    const reference = svc.retainSubagent(address)
    await reference.ready
    const session = childBinding(svc).session
    await session.prompt([{ type: 'text', text: 'continue' }], 'steer')
    await session.cancel()
    expect(api.callsOf('subagents.prompt')).toEqual([expect.objectContaining({
      ...address, delivery: 'steer', content: [{ type: 'text', text: 'continue' }],
    })])
    expect(api.callsOf('subagents.interruptByParent')).toEqual([address])
    expect(api.callsOf('session.prompt')).toEqual([])
    expect(api.callsOf('session.cancel')).toEqual([])
    svc.handleSessionRemoved(parent)
    expect(session.getSnapshot().subagent?.parentAvailable).toBe(false)
    reference.release()
  })

  it('rejects an already aborted acquisition without materializing a child', async () => {
    const { api, svc } = await bench()
    const controller = new AbortController()
    const reason = new Error('closed pane')
    controller.abort(reason)
    expect(() => svc.retainSubagent(address, { signal: controller.signal })).toThrow(reason)
    expect(svc.binding(child)).toBeUndefined()
    expect(api.followStarts).not.toContain(child)
  })

  it('aborts only one pending reference while another finishes the shared opening', async () => {
    const { api, svc } = await bench()
    const opening = deferred<Awaited<ReturnType<typeof api.onHistory>>>()
    api.onHistory = () => opening.promise
    cleanups.push(async () => { opening.resolve(ok({ records: [], hasMore: false })) })
    const controller = new AbortController()
    const first = svc.retainSubagent(address, { signal: controller.signal })
    const second = svc.retainSubagent(address)
    const binding = childBinding(svc)
    const reason = new Error('pane changed')
    const rejected = expect(first.ready).rejects.toBe(reason)
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(1) })
    controller.abort(reason)
    await rejected
    expect(childBinding(svc)).toBe(binding)
    expect(api.activeFollows(child)).toBe(1)
    opening.resolve(ok({ records: [], hasMore: false }))
    await second.ready
    expect(binding.session.getSnapshot().openState).toBe('open')
    second.release()
  })

  it('aborts after readiness and detaches the external listener on release', async () => {
    const { api, svc } = await bench()
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const reference = svc.retainSubagent(address, { signal: controller.signal })
    await reference.ready
    controller.abort(new Error('pane closed'))
    expect(svc.binding(child)).toBeUndefined()
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
    reference.release()
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(0) })
  })

  it('settles ready with business open failures in the snapshot and supports a retry', async () => {
    const { api, svc } = await bench()
    const failure = new RemoteError('gateway/internal', 'history unavailable', {})
    api.onHistory = () => Promise.resolve(err(failure))
    const first = svc.retainSubagent(address)
    await first.ready
    const binding = childBinding(svc)
    expect(binding.session.getSnapshot()).toMatchObject({ openState: 'error', openError: failure })
    api.onHistory = () => Promise.resolve(ok({ records: [], hasMore: false }))
    const retry = svc.retainSubagent(address)
    await retry.ready
    expect(childBinding(svc)).toBe(binding)
    expect(binding.session.getSnapshot().openState).toBe('open')
    first.release()
    retry.release()
  })

  it('rejects a released pending reference and ignores its late opening after re-retain', async () => {
    const { api, svc } = await bench()
    const opening = deferred<Awaited<ReturnType<typeof api.onHistory>>>()
    api.onHistory = () => opening.promise
    cleanups.push(async () => { opening.resolve(ok({ records: [], hasMore: false })) })
    const first = svc.retainSubagent(address)
    const previous = childBinding(svc)
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(1) })
    const rejected = expect(first.ready).rejects.toThrow('released')
    first.release()
    await rejected
    api.onHistory = () => Promise.resolve(ok({ records: [], hasMore: false }))
    const next = svc.retainSubagent(address)
    const binding = childBinding(svc)
    expect(binding).not.toBe(previous)
    expect(svc.sessionOf(previous.ctx)).toBeUndefined()
    await next.ready
    opening.resolve(ok({ records: [{
      type: 'event', event: { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    }], hasMore: false }))
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(1) })
    first.release()
    expect(childBinding(svc)).toBe(binding)
    expect(binding.eventSource.getSnapshot().entries).toEqual([])
    expect(previous.eventSource.getSnapshot().entries).toEqual([])
    next.release()
  })

  it('allows re-retaining from an old scope cleanup without dropping the replacement', async () => {
    const { api, svc } = await bench()
    const first = svc.retainSubagent(address)
    await first.ready
    const previous = childBinding(svc)
    await previous.ctx.fiber.await()
    const replacement = deferred<SessionReference>()
    previous.ctx.effect(() => () => {
      replacement.resolve(svc.retainSubagent(address))
    }, 're-retain fixture')
    first.release()
    const next = await replacement.promise
    await next.ready
    const binding = childBinding(svc)
    expect(binding).not.toBe(previous)
    expect(svc.sessionOf(previous.ctx)).toBeUndefined()
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(1) })
    first.release()
    expect(childBinding(svc)).toBe(binding)
    next.release()
  })

  it('disposes scope effects and follows during HMR without reviving old references', async () => {
    const { api, svc } = await bench()
    const controller = new AbortController()
    const first = svc.retainSubagent(address, { signal: controller.signal })
    await first.ready
    const previous = childBinding(svc)
    await previous.ctx.fiber.await()
    const cleaned = vi.fn()
    previous.ctx.effect(() => cleaned, 'retained child fixture')
    await previous.ctx.fiber.dispose()
    expect(cleaned).toHaveBeenCalledOnce()
    expect(svc.binding(child)).toBeUndefined()
    expect(api.activeFollows(child)).toBe(0)
    const next = svc.retainSubagent(address)
    const binding = childBinding(svc)
    await next.ready
    first.release()
    controller.abort()
    expect(childBinding(svc)).toBe(binding)
    expect(svc.sessionOf(previous.ctx)).toBeUndefined()
    const consumer = binding.ctx.plugin(() => undefined)
    await consumer
    expect(svc.sessionOf(consumer.ctx)).toBe(binding.session)
    next.release()
  })

  it('rejects pending readiness on root disposal and prevents scope resurrection', async () => {
    const { api, ctx, svc } = await bench()
    const opening = deferred<Awaited<ReturnType<typeof api.onHistory>>>()
    api.onHistory = () => opening.promise
    cleanups.push(async () => { opening.resolve(ok({ records: [], hasMore: false })) })
    const reference = svc.retainSubagent(address)
    const previous = childBinding(svc)
    await vi.waitFor(() => { expect(api.activeFollows(child)).toBe(1) })
    const rejected = expect(reference.ready).rejects.toThrow('disposed')
    const disposal = ctx.fiber.dispose()
    await rejected
    expect(svc.binding(child)).toBeUndefined()
    opening.resolve(ok({ records: [], hasMore: false }))
    await disposal
    reference.release()
    expect(svc.sessionOf(previous.ctx)).toBeUndefined()
    expect(svc.binding(parent)).toBeUndefined()
    expect(api.activeFollows(child)).toBe(0)
    expect(api.activeFollows(parent)).toBe(0)
    expect(() => svc.retainSubagent(address)).toThrow('disposed')
    expect(() => svc.resolveAgentScope(child)).toThrow('disposed')
  })
})
