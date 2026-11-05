/** Execution binding edge coverage: acquire validation, setup guards, projection folding, teardown failures. */
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-scope'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ExecutionBinding } from '../src/types.ts'
import { executionBindingProjection, foldExecutionBinding } from '../src/session.ts'
import { createHarness } from './harness.ts'
import { remoteFixture } from './fixture-ssh.ts'

vi.mock('@deepseek-ai/dsh-ssh', async () => {
  const { FixtureSsh } = await import('./fixture-ssh.ts')
  return { default: FixtureSsh, SshConnection: FixtureSsh }
})

const localBinding: ExecutionBinding = { kind: 'local' }

/** Minimal session event; fold only reads type and data.binding. */
function boundEvent(binding: ExecutionBinding, seq: number): SessionEvent {
  return { type: 'execution/bound', seq, data: { binding } } as unknown as SessionEvent
}

describe('execution binding durable fold and projection', () => {
  it('rejects a changed recorded selection while an identical rebind folds', async () => {
    const h = await createHarness()
    const left = await h.remote('fold left')
    const right = await h.remote('fold right')
    expect(() => foldExecutionBinding([boundEvent(left.binding, 1), boundEvent(right.binding, 2)]))
      .toThrow('cannot change')
    expect(foldExecutionBinding([boundEvent(localBinding, 1), boundEvent(localBinding, 2)])).toEqual(localBinding)
    expect(foldExecutionBinding([{ type: 'session/opened', seq: 0, data: {} } as unknown as SessionEvent])).toBeNull()
  })

  it('exposes the projection view as the stored selection', () => {
    expect(executionBindingProjection.wire.view(localBinding)).toBe(localBinding)
    expect(executionBindingProjection.wire.view(null)).toBeNull()
    expect(executionBindingProjection.init()).toBeNull()
  })
})

describe('execution binding acquire validation', () => {
  it('rejects a relative local directory before touching the filesystem', async () => {
    const h = await createHarness()
    await expect(h.ctx.executionBindings.acquire(localBinding, 'relative/dir'))
      .rejects.toThrow('must be absolute')
  })

  it('rejects a local execution path that is not a directory', async () => {
    const h = await createHarness()
    await expect(h.ctx.executionBindings.acquire(localBinding, join(h.localRoot, 'shared.txt')))
      .rejects.toThrow('not a directory')
  })

  it('rejects a non-POSIX remote directory and out-of-root or file targets', async () => {
    const h = await createHarness()
    const remote = await h.remote('edge remote')
    await expect(h.ctx.executionBindings.acquire(remote.binding, 'relative/dir'))
      .rejects.toThrow('absolute POSIX')
    await expect(h.ctx.executionBindings.acquire(remote.binding, '/elsewhere'))
      .rejects.toThrow('outside its captured remote root')
    await expect(h.ctx.executionBindings.acquire(remote.binding, '/project/shared.txt'))
      .rejects.toThrow('not a directory')
  })

  it('opens a fresh world when the registered endpoint has been unregistered', async () => {
    const h = await createHarness()
    const fixture = remoteFixture('gone remote')
    const { target } = await h.ctx.executionHostTargets.create({
      label: 'gone remote', sshAlias: 'inspection', execution: {
        endpoint: { host: fixture.world.host, port: 22, username: 'fixture',
          privateKeyFile: join(h.root, 'unused-key'), hostKeySHA256: 'a'.repeat(64) },
        node: '/usr/bin/node', helper: '/opt/helper.mjs', helperHash: 'b'.repeat(64), workspace: '/project',
        bootstrapPath: '/opt/bootstrap.mjs', bootstrapHash: 'c'.repeat(64),
      },
    })
    const binding = h.ctx.executionHostTargets.snapshotExecution({ id: target.id, revision: target.revision })
    fixture.unregister()
    await expect(h.ctx.executionBindings.acquire(binding, '/project'))
      .rejects.toThrow('Unknown test SSH endpoint')
    await expect(h.ctx.executionBindings.acquire(binding, '/project'))
      .rejects.toThrow('Unknown test SSH endpoint')
  })

  it('releases a local lease idempotently', async () => {
    const h = await createHarness()
    const lease = await h.ctx.executionBindings.acquire(localBinding, h.localRoot)
    await lease.release()
    await lease.release()
    expect(() => { lease.assertCurrent() }).toThrow('released')
  })

  it('disposes the remote scope when its last lease releases', async () => {
    const h = await createHarness()
    const remote = await h.remote('scoped remote')
    const lease = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    await lease.release()
    expect(remote.world.disposed).toBe(1)
  })
})

describe('execution binding setup guards', () => {
  it('rejects a second execution setup on an already prepared Agent', async () => {
    const h = await createHarness()
    const remote = await h.remote('guarded remote')
    const id = SessionId('double-setup')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (agentCtx, agent) => {
        const prepared = await h.ctx.executionBindings.setup(agentCtx, agent, remote.binding)
        await expect(h.ctx.executionBindings.setup(agentCtx, agent, remote.binding))
          .rejects.toThrow('already prepared')
        return prepared
      } })
    await created.dispose()
  })

  it('rejects a second setup that requests a different selection', async () => {
    const h = await createHarness()
    const left = await h.remote('recorded remote')
    const right = await h.remote('conflicting remote')
    const id = SessionId('conflict-setup')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (agentCtx, agent) => {
        const prepared = await h.ctx.executionBindings.setup(agentCtx, agent, left.binding)
        await expect(h.ctx.executionBindings.setup(agentCtx, agent, right.binding))
          .rejects.toThrow('already prepared')
        return prepared
      } })
    await created.dispose()
  })

  it('rejects moving a session with conversation history onto SSH', async () => {
    const h = await createHarness()
    const remote = await h.remote('late remote')
    const id = SessionId('moved-setup')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (agentCtx, agent) => {
        agent.session.append('user/message', { id: 'm1', role: 'user',
          content: [], source: { kind: 'user' } } as never, { surfaceOp: 'append' } as never)
        await expect(h.ctx.executionBindings.setup(agentCtx, agent, remote.binding))
          .rejects.toThrow('cannot be moved to SSH')
        return undefined
      } })
    await created.dispose()
  })

  it('rejects moving a session with a request header onto SSH', async () => {
    const h = await createHarness()
    const remote = await h.remote('header remote')
    const id = SessionId('header-moved')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (agentCtx, agent) => {
        agent.session.append('request/header', { header: {}, reason: 'init' } as never)
        await expect(h.ctx.executionBindings.setup(agentCtx, agent, remote.binding))
          .rejects.toThrow('cannot be moved to SSH')
        return undefined
      } })
    await created.dispose()
  })

  it('rejects a setup without a working directory', async () => {
    const h = await createHarness()
    const remote = await h.remote('cwd remote')
    const id = SessionId('no-cwd-setup')
    const setupSawError = vi.fn()
    const created = await h.ctx.agents.create({ sessionId: id, meta: {},
      setup: async (agentCtx, agent) => {
        await expect(h.ctx.executionBindings.setup(agentCtx, agent, remote.binding))
          .rejects.toThrow('working directory')
        setupSawError()
        return undefined
      } })
    expect(setupSawError).toHaveBeenCalled()
    await created.dispose()
  })
})

describe('cold session observation', () => {
  it('rejects forSession when the session has no working directory', async () => {
    const h = await createHarness()
    const id = SessionId('observe-no-cwd')
    h.ctx.sessions.create(id, { meta: {} })
    await expect(h.ctx.executionBindings.forSession(id)).rejects.toThrow('working directory')
  })

  it('returns a local lease for a session without a binding', async () => {
    const h = await createHarness()
    const id = SessionId('observe-local')
    h.ctx.sessions.create(id, { meta: { cwd: h.localRoot } })
    const lease = await h.ctx.executionBindings.forSession(id)
    expect(lease.binding).toEqual(localBinding)
    await lease.release()
  })

  it('observes a recorded remote binding through a cold session lease', async () => {
    const h = await createHarness()
    const remote = await h.remote('cold remote')
    const id = SessionId('observe-remote')
    const session = h.ctx.sessions.create(id, { meta: { cwd: '/project' } })
    session.append('execution/bound', { binding: remote.binding })
    const lease = await h.ctx.executionBindings.forSession(id)
    expect(lease.binding).toEqual(remote.binding)
    expect(remote.world.connections).toHaveLength(1)
    await lease.release()
    expect(remote.world.disposed).toBe(1)
  })
})

describe('admission and retain transitions', () => {
  it('retains a published local-bound agent lease through forSession', async () => {
    const h = await createHarness()
    const id = SessionId('retain-local')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: h.localRoot },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent) })
    const lease = await h.ctx.executionBindings.forSession(id)
    expect(lease.binding).toEqual(localBinding)
    await lease.release()
    await created.dispose()
  })

  it('rejects retaining a published lease after the remote connection drops', async () => {
    const h = await createHarness()
    const remote = await h.remote('dropped remote')
    const id = SessionId('retain-dropped')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    remote.world.connections[0]!.drop()
    await expect(h.ctx.executionBindings.forSession(id)).rejects.toThrow()
    await created.dispose()
  })
})

describe('provider realm and capability teardown', () => {
  it('mounts capabilities without a node executable or bootstrap path', async () => {
    const h = await createHarness()
    const remote = await h.remote('bare remote')
    remote.world.hideNode = true
    remote.world.hideBootstrap = true
    const lease = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    await lease.release()
    expect(remote.world.disposed).toBe(1)
  })

  it('falls back to the binding lifetime when the provider exposes no signal', async () => {
    const h = await createHarness()
    const remote = await h.remote('signal-less remote')
    remote.world.hideSignal = true
    const lease = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    lease.assertCurrent()
    await lease.release()
  })

  it('tolerates a failing remote disposal during lease release', async () => {
    const h = await createHarness()
    const remote = await h.remote('failing remote')
    const lease = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    remote.world.failDispose = true
    await lease.release()
    expect(remote.world.disposed).toBe(1)
  })

  it('keeps a shared world alive until its last lease releases', async () => {
    const h = await createHarness()
    const remote = await h.remote('shared remote')
    const first = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    const second = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    await first.release()
    expect(remote.world.disposed).toBe(0)
    await second.release()
    await second.release()
    expect(remote.world.disposed).toBe(1)
  })
})

interface BindingInternals {
  admissions: Map<SessionId, unknown>
  agents: Map<SessionId, { agent: unknown; lease: { binding: ExecutionBinding } }>
  worlds: Map<string, { ready: Promise<unknown>; holders: number }>
  admissionChanged: (id: SessionId) => void
}

function internals(bindings: unknown): BindingInternals {
  return bindings as BindingInternals
}

function bumpAdmission(bindings: unknown, id: SessionId): void {
  internals(bindings).admissionChanged.call(bindings, id)
}

describe('admission observation invalidation', () => {
  it('retries bindingForSession when the admission changes during observation', async () => {
    const h = await createHarness()
    const remote = await h.remote('observed remote')
    const id = SessionId('observe-retry')
    h.ctx.sessions.create(id, { meta: { cwd: '/project' } }).append('execution/bound', { binding: remote.binding })
    const original = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
    let calls = 0
    vi.spyOn(h.ctx.sessionQuery, 'observeSession').mockImplementation(async (sid, options) => {
      if (++calls === 1 && sid === id) bumpAdmission(h.ctx.executionBindings, id)
      return original(sid, options)
    })
    expect(await h.ctx.executionBindings.bindingForSession(id, new AbortController().signal)).toEqual(remote.binding)
  })

  it('retries forSession when the admission changes during observation', async () => {
    const h = await createHarness()
    const remote = await h.remote('for-session retry')
    const id = SessionId('for-session-retry')
    h.ctx.sessions.create(id, { meta: { cwd: '/project' } }).append('execution/bound', { binding: remote.binding })
    const original = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
    let calls = 0
    vi.spyOn(h.ctx.sessionQuery, 'observeSession').mockImplementation(async (sid, options) => {
      if (++calls === 1 && sid === id) bumpAdmission(h.ctx.executionBindings, id)
      return original(sid, options)
    })
    const controller = new AbortController()
    const lease = await h.ctx.executionBindings.forSession(id, controller.signal)
    expect(lease.binding).toEqual(remote.binding)
    lease.assertCurrent()
    await lease.release()
    expect(() => { lease.assertCurrent() }).toThrow()
  })

  it('reads the recorded sandbox mode while folding a cold lease', async () => {
    const h = await createHarness()
    const remote = await h.remote('mode remote')
    const id = SessionId('mode-session')
    const session = h.ctx.sessions.create(id, { meta: { cwd: '/project' } })
    session.append('execution/bound', { binding: remote.binding })
    setSandboxMode(session, 'danger-full-access')
    const lease = await h.ctx.executionBindings.forSession(id)
    expect(lease.binding).toEqual(remote.binding)
    await lease.release()
  })

  it('falls back to the local binding when the session recorded none', async () => {
    const h = await createHarness()
    const id = SessionId('unbound-session')
    h.ctx.sessions.create(id, { meta: { cwd: h.localRoot } })
    expect(await h.ctx.executionBindings.bindingForSession(id)).toEqual(localBinding)
    const lease = await h.ctx.executionBindings.forSession(id)
    expect(lease.binding).toEqual(localBinding)
    await lease.release()
  })

  it('releases and retries forSession when the admission changes during acquisition', async () => {
    const h = await createHarness()
    const remote = await h.remote('acquire retry')
    const id = SessionId('acquire-retry')
    h.ctx.sessions.create(id, { meta: { cwd: '/project' } }).append('execution/bound', { binding: remote.binding })
    const bindings = h.ctx.executionBindings
    const original = bindings.acquire.bind(bindings)
    let calls = 0
    vi.spyOn(bindings, 'acquire').mockImplementation(async (binding, cwd, signal) => {
      const lease = await original(binding, cwd, signal)
      if (++calls === 1) bumpAdmission(bindings, id)
      return lease
    })
    const lease = await bindings.forSession(id)
    expect(lease.binding).toEqual(remote.binding)
    await lease.release()
    // The invalidated acquisition disposes the first world; the retry opens and disposes a second.
    expect(remote.world.disposed).toBe(2)
  })

  it('releases and retries forSession when the admission changes during cold mount', async () => {
    const h = await createHarness()
    const remote = await h.remote('cold retry')
    const id = SessionId('cold-retry')
    h.ctx.sessions.create(id, { meta: { cwd: '/project' } }).append('execution/bound', { binding: remote.binding })
    const bindings = h.ctx.executionBindings
    const mount = Reflect.get(bindings, 'coldSessionLease') as (...args: unknown[]) => Promise<unknown>
    let calls = 0
    const spied = vi.spyOn(bindings as unknown as { coldSessionLease: (...args: unknown[]) => Promise<unknown> }, 'coldSessionLease')
    spied.mockImplementation(async function (...args: unknown[]) {
      const lease = await mount.apply(bindings, args)
      if (++calls === 1) bumpAdmission(bindings, id)
      return lease
    })
    const lease = await bindings.forSession(id)
    expect(lease.binding).toEqual(remote.binding)
    await lease.release()
    // The invalidated cold lease disposes the first world; the retry opens and disposes a second.
    expect(remote.world.disposed).toBe(2)
  })

  it('rejects forSession when the caller signal aborts inside the cold mount', async () => {
    const h = await createHarness()
    const remote = await h.remote('aborted cold')
    const id = SessionId('aborted-cold')
    h.ctx.sessions.create(id, { meta: { cwd: '/project' } }).append('execution/bound', { binding: remote.binding })
    const bindings = h.ctx.executionBindings
    const controller = new AbortController()
    const mount = Reflect.get(bindings, 'mountCapabilities') as (...args: unknown[]) => Promise<unknown>
    let calls = 0
    const spied = vi.spyOn(bindings as unknown as { mountCapabilities: (...args: unknown[]) => Promise<unknown> }, 'mountCapabilities')
    spied.mockImplementation(async function (...args: unknown[]) {
      const result = await mount.apply(bindings, args)
      if (++calls === 2) controller.abort(new Error('Cold observation cancelled'))
      return result
    })
    await expect(bindings.forSession(id, controller.signal)).rejects.toThrow('cancelled')
    expect(remote.world.disposed).toBe(1)
  })

  it('retries forSession when a published execution appears during observation', async () => {
    const h = await createHarness()
    const remote = await h.remote('late publish')
    const id = SessionId('late-publish')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    const maps = internals(h.ctx.executionBindings)
    const execution = maps.agents.get(id)
    if (execution === undefined) throw new Error('Published execution missing')
    maps.admissions.delete(id)
    maps.agents.delete(id)
    const original = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
    vi.spyOn(h.ctx.sessionQuery, 'observeSession').mockImplementation(async (sid, options) => {
      const observation = await original(sid, options)
      if (sid === id && maps.agents.get(id) === undefined) maps.agents.set(id, execution)
      return observation
    })
    const lease = await h.ctx.executionBindings.forSession(id)
    expect(lease.binding).toEqual(remote.binding)
    await lease.release()
    await created.dispose()
  })

  it('returns the published binding when an execution appears during bindingForSession observation', async () => {
    const h = await createHarness()
    const remote = await h.remote('late binding')
    const id = SessionId('late-binding')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    const maps = internals(h.ctx.executionBindings)
    const execution = maps.agents.get(id)
    if (execution === undefined) throw new Error('Published execution missing')
    maps.admissions.delete(id)
    maps.agents.delete(id)
    const original = h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
    vi.spyOn(h.ctx.sessionQuery, 'observeSession').mockImplementation(async (sid, options) => {
      const observation = await original(sid, options)
      if (sid === id && maps.agents.get(id) === undefined) maps.agents.set(id, execution)
      return observation
    })
    expect(await h.ctx.executionBindings.bindingForSession(id)).toEqual(remote.binding)
    await created.dispose()
  })

  it('releases and retries forSession when the admission changes while retaining', async () => {
    const h = await createHarness()
    const remote = await h.remote('retain retry')
    const id = SessionId('retain-retry')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    const bindings = h.ctx.executionBindings
    const retain = Reflect.get(bindings, 'retain') as (...args: unknown[]) => Promise<unknown>
    let calls = 0
    const spied = vi.spyOn(bindings as unknown as { retain: (...args: unknown[]) => Promise<unknown> }, 'retain')
    spied.mockImplementation(async function (...args: unknown[]) {
      const retained = await retain.apply(bindings, args)
      if (++calls === 1) bumpAdmission(bindings, id)
      return retained
    })
    const lease = await bindings.forSession(id)
    expect(lease.binding).toEqual(remote.binding)
    lease.assertCurrent()
    await lease.release()
    expect(() => { lease.assertCurrent() }).toThrow()
    await created.dispose()
  })
})

describe('published execution integrity', () => {
  it('rejects forSession when the published lease is not in the Agent registry', async () => {
    const h = await createHarness()
    const remote = await h.remote('unpublished lease')
    const id = SessionId('unpublished-lease')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    const store = Reflect.get(h.ctx.agents, 'store') as Map<SessionId, unknown>
    const entry = store.get(id)
    internals(h.ctx.executionBindings).admissions.delete(id)
    store.delete(id)
    try {
      await expect(h.ctx.executionBindings.forSession(id)).rejects.toThrow('lease is not published')
    } finally {
      if (entry !== undefined) store.set(id, entry)
    }
    await created.dispose()
  })

  it('rejects bindingForSession when the recorded admission is not the published Agent', async () => {
    const h = await createHarness()
    const id = SessionId('fake-admission')
    h.ctx.sessions.create(id, { meta: { cwd: '/project' } })
    const maps = internals(h.ctx.executionBindings)
    maps.admissions.set(id, { id })
    try {
      await expect(h.ctx.executionBindings.bindingForSession(id)).rejects.toThrow('admission is not published')
    } finally {
      maps.admissions.delete(id)
    }
  })

  it('rejects forSession when the published admission lost its provider lease', async () => {
    const h = await createHarness()
    const remote = await h.remote('lost lease')
    const id = SessionId('lost-lease')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    const maps = internals(h.ctx.executionBindings)
    const execution = maps.agents.get(id)
    maps.agents.delete(id)
    try {
      await expect(h.ctx.executionBindings.forSession(id)).rejects.toThrow('no provider lease')
    } finally {
      if (execution !== undefined) maps.agents.set(id, execution)
    }
    await created.dispose()
  })
})

describe('lease retain and world replacement', () => {
  it('rejects forSession when the execution incarnation was released', async () => {
    const h = await createHarness()
    const remote = await h.remote('evicted world')
    const id = SessionId('evicted-world')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    internals(h.ctx.executionBindings).worlds.clear()
    await expect(h.ctx.executionBindings.forSession(id)).rejects.toThrow('no longer available')
    await created.dispose()
  })

  it('rejects forSession when the incarnation was replaced underneath the lease', async () => {
    const h = await createHarness()
    const remote = await h.remote('replaced world')
    const id = SessionId('replaced-world')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    const worlds = internals(h.ctx.executionBindings).worlds
    worlds.clear()
    const replacement = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    await expect(h.ctx.executionBindings.forSession(id)).rejects.toThrow('incarnation changed')
    await replacement.release()
    await created.dispose()
  })
})

describe('setup authorization edge cases', () => {
  it('reuses the recorded binding when setup omits the selection', async () => {
    const h = await createHarness()
    const remote = await h.remote('reuse remote')
    const id = SessionId('reuse-prior')
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (agentCtx, agent) => {
        agent.session.append('execution/bound', { binding: remote.binding })
        return h.ctx.executionBindings.setup(agentCtx, agent)
      } })
    expect(await h.ctx.executionBindings.bindingForSession(id)).toEqual(remote.binding)
    await created.dispose()
  })

  it('releases the reserved authorization when the setup scope is already disposed', async () => {
    const h = await createHarness()
    const remote = await h.remote('disposed scope')
    const id = SessionId('disposed-scope')
    let savedAgent: unknown
    const created = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (_agentCtx, agent) => { savedAgent = agent; return undefined } })
    const scope = createScope(h.ctx, { name: 'detached' })
    await scope.dispose()
    await expect(h.ctx.executionBindings.setup(scope.ctx, savedAgent as never, remote.binding))
      .rejects.toThrow()
    await created.dispose()
  })

  it('releases the acquisition when the endpoint is unregistered during setup', async () => {
    const h = await createHarness()
    const fixture = remoteFixture('setup ghost')
    const { target } = await h.ctx.executionHostTargets.create({
      label: 'setup ghost', sshAlias: 'inspection', execution: {
        endpoint: { host: fixture.world.host, port: 22, username: 'fixture',
          privateKeyFile: join(h.root, 'unused-key'), hostKeySHA256: 'a'.repeat(64) },
        node: '/usr/bin/node', helper: '/opt/helper.mjs', helperHash: 'b'.repeat(64), workspace: '/project',
        bootstrapPath: '/opt/bootstrap.mjs', bootstrapHash: 'c'.repeat(64),
      },
    })
    const binding = h.ctx.executionHostTargets.snapshotExecution({ id: target.id, revision: target.revision })
    fixture.unregister()
    const id = SessionId('setup-ghost')
    await expect(h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, binding) }))
      .rejects.toThrow('Unknown test SSH endpoint')
  })

  it('releases the acquired world when capability mounting fails during setup', async () => {
    const h = await createHarness()
    const remote = await h.remote('mount failure')
    const bindings = h.ctx.executionBindings
    const id = SessionId('mount-failure')
    // The world realm mounts capabilities internally; only the setup-side mount rejects.
    const mount = Reflect.get(bindings, 'mountCapabilities') as (...args: unknown[]) => Promise<unknown>
    const spied = vi.spyOn(bindings as unknown as { mountCapabilities: (...args: unknown[]) => Promise<unknown> }, 'mountCapabilities')
    spied.mockImplementation(async function (...args: unknown[]) {
      if (args[3] !== undefined) throw new Error('capability mount failed')
      return mount.apply(bindings, args)
    })
    await expect(h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => bindings.setup(agentCtx, agent, remote.binding) }))
      .rejects.toThrow('capability mount failed')
    expect(remote.world.disposed).toBe(1)
  })

  it('disposes held remote worlds when the binding service unloads', async () => {
    const h = await createHarness()
    const remote = await h.remote('unload remote')
    const lease = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    const fiber = [...h.ctx.loader.entries()].find(entry => entry.options.name === 'execution-binding')?.fiber
    if (fiber === undefined) throw new Error('Binding Loader entry missing')
    await fiber.dispose()
    expect(remote.world.disposed).toBe(1)
    expect(() => { lease.assertCurrent() }).toThrow()
    await lease.release()
  })

  it('mounts capabilities with a bootstrap but no node executable', async () => {
    const h = await createHarness()
    const remote = await h.remote('node-less remote')
    remote.world.hideNode = true
    const lease = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    await lease.release()
    expect(remote.world.disposed).toBe(1)
  })

  it('mounts capabilities with a node executable but no bootstrap', async () => {
    const h = await createHarness()
    const remote = await h.remote('bootstrap-less remote')
    remote.world.hideBootstrap = true
    const lease = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    await lease.release()
    expect(remote.world.disposed).toBe(1)
  })
})
