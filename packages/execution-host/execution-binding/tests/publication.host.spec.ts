/** Real JSONL append barriers exercise execution admission at Agent publication. */
import { symbols, type Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionId as SessionIdentity } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createHarness } from './harness.ts'

vi.mock('@deepseek-ai/dsh-ssh', async () => {
  const { FixtureSsh } = await import('./fixture-ssh.ts')
  return { default: FixtureSsh, SshConnection: FixtureSsh }
})

function persistenceOf(ctx: Context): SessionPersistence {
  const service = ctx.get('sessionPersistence')
  if (service === undefined) throw new Error('JSONL persistence missing')
  return Reflect.get(service, symbols.original) as SessionPersistence
}

function appendBarrier(persistence: SessionPersistence, id: SessionIdentity, failure?: Error) {
  const entered = Promise.withResolvers<undefined>()
  const proceed = Promise.withResolvers<undefined>()
  const originalCreate = persistence.create.bind(persistence)
  let owned: SessionHandle | undefined
  let closed = false
  let appended = false
  let nextFailure = failure
  const spy = vi.spyOn(persistence, 'create').mockImplementation(async (header, options) => {
    const handle = await originalCreate(header, options)
    if (header.id !== id) return handle
    owned = handle
    const appendFailure = nextFailure
    nextFailure = undefined
    const append = handle.append.bind(handle)
    const close = handle.close.bind(handle)
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await close()
      closed = true
    })
    vi.spyOn(handle, 'append').mockImplementationOnce(async (events, appendOptions) => {
      entered.resolve(undefined)
      await proceed.promise
      if (appendFailure !== undefined) throw appendFailure
      await append(events, appendOptions)
      appended = true
    })
    return handle
  })
  onTestFinished(() => { proceed.resolve(undefined); spy.mockRestore() })
  return { entered: entered.promise, release: () => { proceed.resolve(undefined) },
    get closed() { return closed }, get appended() { return appended }, get handle() { return owned } }
}

function publications(ctx: Context, id: SessionIdentity) {
  const seen: string[] = []
  ctx.on('session/created', (session) => { if (session.id === id) seen.push('session') })
  ctx.on('agent/created', ({ agent }) => { if (agent.id === id) seen.push('agent') })
  return seen
}

async function materializeEmpty(ctx: Context, id: SessionIdentity): Promise<void> {
  const session = ctx.sessions.prepare(id, { meta: { cwd: '/project' } })
  await using handle = await persistenceOf(ctx).create(session.header)
  await handle.flush()
}

function pauseNextObservation(ctx: Context, id: SessionIdentity) {
  const query = Reflect.get(ctx.sessionQuery, symbols.original) as typeof ctx.sessionQuery
  const observe = query.observeSession.bind(query)
  const observed = Promise.withResolvers<undefined>()
  const deliver = Promise.withResolvers<undefined>()
  const spy = vi.spyOn(query, 'observeSession').mockImplementationOnce(async (...args) => {
    const observation = await observe(...args)
    expect(args[0]).toBe(id)
    expect(observation.events).toEqual([])
    observed.resolve(undefined)
    await deliver.promise
    return observation
  })
  onTestFinished(() => { deliver.resolve(undefined); spy.mockRestore() })
  return { observed: observed.promise, release: () => { deliver.resolve(undefined) } }
}

function originalFs(ctx: Context): unknown {
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('Execution filesystem missing')
  return Reflect.get(fs, symbols.original)
}

async function refusedWhilePending(ctx: Context, id: SessionIdentity) {
  const observed = await ctx.executionBindings.forSession(id).then(async (lease) => {
    await lease.release()
    return 'lease delivered'
  }, (error: unknown) => error)
  expect(observed).toBeInstanceOf(Error)
  expect(observed).toMatchObject({ message: 'Session execution admission is not published' })
}

describe('execution publication through real JSONL persistence', () => {
  it('refuses Session execution during the unpublished append and publishes only after it settles', async () => {
    const h = await createHarness({ persistence: true })
    const remote = await h.remote('pending publication')
    const id = SessionId('append-pending')
    const persistence = persistenceOf(h.ctx)
    const barrier = appendBarrier(persistence, id)
    const seen = publications(h.ctx, id)
    const commit = vi.fn()
    const creating = h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (ctx, agent) => {
        const prepared = await h.ctx.executionBindings.setup(ctx, agent, remote.binding)
        return { commit: () => { commit(); prepared.commit() } }
      } })
    const result = creating.then(value => ({ value }), (error: unknown) => ({ error }))
    try {
      await Promise.race([barrier.entered, creating])
      expect(h.ctx.agents.get(id)).toBeUndefined()
      expect(h.ctx.sessions.get(id)).toBeUndefined()
      expect(seen).toEqual([])
      await refusedWhilePending(h.ctx, id)
    } finally { barrier.release() }
    const settled = await result
    if (!('value' in settled)) throw settled.error
    expect(barrier.appended).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['session', 'agent'])
    const lease = await h.ctx.executionBindings.forSession(id)
    expect(lease.binding).toEqual(remote.binding)
    await lease.release()
    await settled.value.dispose()
    expect(barrier.closed).toBe(true)
    await using stored = await persistence.open(id, 'read')
    expect((await stored.read()).events.filter(event => event.type === 'execution/bound'))
      .toMatchObject([{ data: { binding: remote.binding } }])
  })

  it('reserves target authorization through append and lets the edit caller retry after publication', async () => {
    const h = await createHarness({ persistence: true })
    const remote = await h.remote('reserved append')
    const id = SessionId('append-reserved')
    const persistence = persistenceOf(h.ctx)
    const barrier = appendBarrier(persistence, id)
    const seen = publications(h.ctx, id)
    const commit = vi.fn()
    const creating = h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (ctx, agent) => {
        const prepared = await h.ctx.executionBindings.setup(ctx, agent, remote.binding)
        return { commit: () => { commit(); prepared.commit() } }
      } })
    const result = creating.then(value => ({ value }), (error: unknown) => ({ error }))
    const { target } = remote
    const edit = { id: target.id, revision: target.revision,
      label: 'Changed during append', sshAlias: target.sshAlias, execution: target.execution }
    try {
      await Promise.race([barrier.entered, creating])
      await expect(h.ctx.executionHostTargets.update(edit)).rejects.toMatchObject({ code: 'conflict' })
    } finally { barrier.release() }
    const settled = await result
    if (!('value' in settled)) throw settled.error
    expect(barrier.appended).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['session', 'agent'])
    expect(h.ctx.agents.get(id)).toBe(settled.value.agent)
    expect((await h.ctx.executionHostTargets.update(edit)).target.revision).toBe(target.revision + 1)
    await settled.value.dispose()
    expect(barrier.closed).toBe(true)
    expect(remote.world.disposed).toBe(1)
    await using reopened = await persistence.open(id, 'read')
    expect((await reopened.read()).events.filter(event => event.type === 'execution/bound')).toHaveLength(1)
  })

  it('joins execution cleanup and releases real write ownership after an append failure', async () => {
    const h = await createHarness({ persistence: true })
    const remote = await h.remote('failed append')
    const id = SessionId('append-failed')
    const persistence = persistenceOf(h.ctx)
    const failure = new Error('Fixture append failure')
    const barrier = appendBarrier(persistence, id, failure)
    const seen = publications(h.ctx, id)
    const commit = vi.fn()
    const creating = h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (ctx, agent) => {
        const prepared = await h.ctx.executionBindings.setup(ctx, agent, remote.binding)
        return { commit: () => { commit(); prepared.commit() } }
      } })
    const result = creating.then(value => ({ value }), (error: unknown) => ({ error }))
    try {
      await Promise.race([barrier.entered, creating])
      await refusedWhilePending(h.ctx, id)
    } finally { barrier.release() }
    expect(await result).toEqual({ error: failure })
    expect(barrier.appended).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(barrier.closed).toBe(true)
    expect(remote.world.disposed).toBe(1)
    expect(seen).toEqual([])
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(h.ctx.sessions.get(id)).toBeUndefined()
    const header = barrier.handle?.header
    if (header === undefined) throw new Error('Persistence handle was not created')
    {
      await using recreated = await persistence.create(header)
      expect((await recreated.read()).events).toEqual([])
    }
    const retried = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (ctx, agent) => h.ctx.executionBindings.setup(ctx, agent, remote.binding) })
    expect(retried.agent.session.snapshotEvents().filter(event => event.type === 'execution/bound')).toHaveLength(1)
    await retried.dispose()
    expect(remote.world.disposed).toBe(2)
  })

  it('does not invoke the setup commit when creation is cancelled before append settles', async () => {
    const h = await createHarness({ persistence: true })
    const remote = await h.remote('cancelled append')
    const id = SessionId('append-cancelled')
    const persistence = persistenceOf(h.ctx)
    const barrier = appendBarrier(persistence, id)
    const seen = publications(h.ctx, id)
    const commit = vi.fn()
    const controller = new AbortController()
    const creating = h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' }, signal: controller.signal,
      setup: async (ctx, agent) => {
        const prepared = await h.ctx.executionBindings.setup(ctx, agent, remote.binding)
        return { commit: () => { commit(); prepared.commit() } }
      } })
    const result = creating.then(value => ({ value }), (error: unknown) => ({ error }))
    try {
      await Promise.race([barrier.entered, creating])
      controller.abort(new Error('Cancel unpublished Agent'))
    } finally { barrier.release() }
    const settled = await result
    if ('value' in settled) await settled.value.dispose()
    expect(settled).toHaveProperty('error')
    expect(commit).not.toHaveBeenCalled()
    expect(seen).toEqual([])
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(h.ctx.sessions.get(id)).toBeUndefined()
    expect(barrier.closed).toBe(true)
    expect(remote.world.disposed).toBe(1)
  })

  it('bindingForSession replaces a captured empty observation with the published remote admission', async () => {
    const h = await createHarness({ persistence: true })
    const remote = await h.remote('binding lookup resume')
    const id = SessionId('empty-binding-lookup')
    await materializeEmpty(h.ctx, id)
    const paused = pauseNextObservation(h.ctx, id)
    const lookup = h.ctx.executionBindings.bindingForSession(id)
    await paused.observed
    const resumed = await h.ctx.agents.resume({ resumeSessionId: id,
      setup: (ctx, agent) => h.ctx.executionBindings.setup(ctx, agent, remote.binding) })
    paused.release()
    expect(await lookup).toEqual(remote.binding)
    await resumed.dispose()
  })

  it('forSession replaces a captured empty observation with the published Agent lease', async () => {
    const h = await createHarness({ persistence: true })
    const remote = await h.remote('lease lookup resume')
    const id = SessionId('empty-lease-lookup')
    await materializeEmpty(h.ctx, id)
    const paused = pauseNextObservation(h.ctx, id)
    const lookup = h.ctx.executionBindings.forSession(id)
    await paused.observed
    const resumed = await h.ctx.agents.resume({ resumeSessionId: id,
      setup: (ctx, agent) => h.ctx.executionBindings.setup(ctx, agent, remote.binding) })
    const active = h.ctx.executionBindings.executionForAgent(resumed.agent)
    paused.release()
    const lease = await lookup
    expect(lease.binding).toEqual(remote.binding)
    expect(originalFs(lease.ctx)).toBe(originalFs(active.ctx))
    await lease.release()
    await resumed.dispose()
  })

  it('does not fall back to a stored Session while its resume setup is unpublished', async () => {
    const h = await createHarness({ persistence: true })
    const remote = await h.remote('stored resume')
    const id = SessionId('resume-pending')
    const first = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (ctx, agent) => h.ctx.executionBindings.setup(ctx, agent, remote.binding) })
    await first.dispose()
    const query = Reflect.get(h.ctx.sessionQuery, symbols.original) as typeof h.ctx.sessionQuery
    const observe = query.observeSession.bind(query)
    const observed = Promise.withResolvers<undefined>()
    const deliver = Promise.withResolvers<undefined>()
    const querySpy = vi.spyOn(query, 'observeSession').mockImplementationOnce(async (...args) => {
      const observation = await observe(...args)
      observed.resolve(undefined)
      await deliver.promise
      return observation
    })
    onTestFinished(() => { deliver.resolve(undefined); querySpy.mockRestore() })
    const cold = h.ctx.executionBindings.forSession(id).then(async (lease) => {
      await lease.release()
      return 'lease delivered'
    }, (error: unknown) => error)
    await observed.promise
    const entered = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const seen = publications(h.ctx, id)
    const resuming = h.ctx.agents.resume({ resumeSessionId: id, setup: async (ctx, agent) => {
      const commit = await h.ctx.executionBindings.setup(ctx, agent)
      entered.resolve(undefined)
      await proceed.promise
      return commit
    } })
    const result = resuming.then(value => ({ value }), (error: unknown) => ({ error }))
    try {
      await Promise.race([entered.promise, resuming])
      expect(h.ctx.agents.get(id)).toBeUndefined()
      expect(h.ctx.sessions.get(id)).toBeUndefined()
      expect(seen).toEqual([])
      const count = remote.world.connections.length
      deliver.resolve(undefined)
      expect(await cold).toMatchObject({ message: 'Session execution admission is not published' })
      await refusedWhilePending(h.ctx, id)
      expect(remote.world.connections).toHaveLength(count)
    } finally { proceed.resolve(undefined) }
    const settled = await result
    if (!('value' in settled)) throw settled.error
    expect(seen).toEqual(['session', 'agent'])
    await settled.value.dispose()
  })
})
