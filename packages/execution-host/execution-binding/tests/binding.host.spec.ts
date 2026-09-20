/** Execution worlds through real Loader, official providers and Agent publication. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { symbols, type Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SshFileSystem } from '@deepseek-ai/dsh-fs-ssh'
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh'
import { SshSandboxProvider } from '@deepseek-ai/dsh-sandbox-ssh'
import { createHarness } from './harness.ts'

vi.mock('@deepseek-ai/dsh-ssh', async () => {
  const { FixtureSsh } = await import('./fixture-ssh.ts')
  return { default: FixtureSsh, SshConnection: FixtureSsh }
})

function service<K extends 'fs' | 'subprocess' | 'sandbox' | 'sandboxPolicy'>(ctx: Context, key: K) {
  const value = ctx.get(key)
  if (value === undefined) throw new Error('Execution provider missing: ' + key)
  return value
}

function sameProvider(a: Context, b: Context, key: 'fs' | 'subprocess') {
  return Reflect.get(service(a, key), symbols.original) === Reflect.get(service(b, key), symbols.original)
}

describe('execution bindings in a Loader-owned Host', () => {
  it('routes filesystem, confinement and process work to distinct remote worlds while local files stay local', async () => {
    const h = await createHarness()
    const left = await h.remote('left remote')
    const right = await h.remote('right remote')
    const local = await h.ctx.executionBindings.acquire({ kind: 'local' }, h.localRoot)
    const a = await h.ctx.executionBindings.acquire(left.binding, '/project')
    const b = await h.ctx.executionBindings.acquire(right.binding, '/project')
    expect(service(a.ctx, 'fs')).toBeInstanceOf(SshFileSystem)
    expect(service(a.ctx, 'subprocess')).toBeInstanceOf(SshSubprocessRuntime)
    expect(service(a.ctx, 'sandbox')).toBeInstanceOf(SshSandboxProvider)
    expect(sameProvider(a.ctx, b.ctx, 'fs')).toBe(false)
    expect(sameProvider(local.ctx, h.ctx, 'fs')).toBe(true)
    expect(await service(local.ctx, 'fs').readText(await service(local.ctx, 'fs').resolve('shared.txt', { cwd: local.cwd }))).toBe('local')
    expect(await service(a.ctx, 'fs').readText(await service(a.ctx, 'fs').resolve('shared.txt', { cwd: a.cwd }))).toBe('left remote')
    expect(await service(b.ctx, 'fs').readText(await service(b.ctx, 'fs').resolve('shared.txt', { cwd: b.cwd }))).toBe('right remote')
    await service(a.ctx, 'fs').writeText(await service(a.ctx, 'fs').resolve('shared.txt', { cwd: a.cwd }), 'left changed')
    await service(local.ctx, 'fs').writeText(await service(local.ctx, 'fs').resolve('shared.txt', { cwd: local.cwd }), 'local changed')
    expect(left.world.files.get('/project/shared.txt')).toBe('left changed')
    expect(right.world.files.get('/project/shared.txt')).toBe('right remote')
    expect(await readFile(join(h.localRoot, 'shared.txt'), 'utf8')).toBe('local changed')
    const executable = await service(a.ctx, 'subprocess').resolveExecutable('touch')
    const confined = await service(a.ctx, 'sandbox').confine([executable, 'command-marker'], {
      mode: 'workspace-write', workspaceRoot: a.cwd,
    })
    const child = service(a.ctx, 'subprocess').spawn({ argv: confined.argv, cwd: a.cwd, graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } } })
    expect(await child.done).toEqual({ exitCode: 0, signal: null })
    expect(await child.waitForExit()).toBe(true)
    expect(child.collected.stdout?.readFrom(0).text).toBe('')
    expect(child.collected.stderr?.readFrom(0).text).toBe('')
    expect(left.world.commands).toEqual([['/usr/bin/touch', 'command-marker']])
    expect(left.world.files.has('/project/command-marker')).toBe(true)
    expect(right.world.files.has('/project/command-marker')).toBe(false)
    await expect(readFile(join(h.localRoot, 'command-marker'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(left.world.requests.find(value => value.method === 'sandbox')?.params).toEqual({
      argv: ['/usr/bin/touch', 'command-marker'], policy: { mode: 'workspace-write', workspaceRoot: '/project' },
    })
    await Promise.all([local.release(), a.release(), b.release()])
  })

  it('shares one incarnation until its last lease releases and fails closed after connection loss', async () => {
    const h = await createHarness()
    const remote = await h.remote('remote')
    const [a, b] = await Promise.all([
      h.ctx.executionBindings.acquire(remote.binding, '/project'),
      h.ctx.executionBindings.acquire(remote.binding, '/project'),
    ])
    expect(remote.world.connections).toHaveLength(1)
    expect(a.incarnation).toBe(b.incarnation)
    expect(sameProvider(a.ctx, b.ctx, 'fs')).toBe(true)
    await a.release()
    await a.release()
    expect(() => { a.assertCurrent() }).toThrow('released')
    expect(() => { b.assertCurrent() }).not.toThrow()
    expect(remote.world.disposed).toBe(0)
    const marker = await service(b.ctx, 'fs').resolve('/project/no-local-marker')
    remote.world.connections[0]!.drop()
    expect(b.signal.aborted).toBe(true)
    expect(() => { b.assertCurrent() }).toThrow('connection lost')
    await expect(service(b.ctx, 'fs').writeText(marker, 'must not reach local')).rejects.toThrow('connection lost')
    await expect(h.ctx.executionBindings.acquire(remote.binding, '/project')).rejects.toThrow('connection lost')
    expect(remote.world.connections).toHaveLength(1)
    expect(remote.world.files.has('/project/no-local-marker')).toBe(false)
    await expect(readFile(join(h.localRoot, 'no-local-marker'))).rejects.toMatchObject({ code: 'ENOENT' })
    await b.release()
    expect(remote.world.disposed).toBe(1)
    const c = await h.ctx.executionBindings.acquire(remote.binding, '/project')
    expect(remote.world.connections).toHaveLength(2)
    expect(c.incarnation).not.toBe(b.incarnation)
    await c.release()
    expect(remote.world.disposed).toBe(2)
  })

  it('records Agent execution before publication and retains its captured world after target edits', async () => {
    const h = await createHarness()
    const remote = await h.remote('original remote')
    const id = SessionId('remote-session')
    let publishedBinding: unknown
    h.ctx.on('agent/created', ({ agent }) => {
      if (agent.id === id) publishedBinding = h.ctx.executionBindings.executionForAgent(agent).binding
    })
    const handle = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    expect(publishedBinding).toEqual(remote.binding)
    expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'execution/bound'))
      .toMatchObject([{ data: { binding: remote.binding } }])
    expect(h.ctx.sessionProjections.stateOf(handle.agent.session, 'executionBinding')).toEqual(remote.binding)
    expect(await h.ctx.executionBindings.bindingForSession(id)).toEqual(remote.binding)
    const before = await h.ctx.executionBindings.forSession(id)
    const scoped = h.ctx.executionBindings.executionForAgent(handle.agent)
    expect(sameProvider(scoped.ctx, before.ctx, 'fs')).toBe(true)
    const otherId = SessionId('nested-remote-session')
    const other = await h.ctx.agents.create({ sessionId: otherId, meta: { cwd: '/project/nested' },
      setup: (agentCtx, agent) => h.ctx.executionBindings.setup(agentCtx, agent, remote.binding) })
    const otherLease = await h.ctx.executionBindings.forSession(otherId)
    expect(otherLease.incarnation).toBe(before.incarnation)
    expect(sameProvider(otherLease.ctx, before.ctx, 'subprocess')).toBe(true)
    expect(sameProvider(otherLease.ctx, before.ctx, 'fs')).toBe(false)
    handle.agent.session.append('sandbox/mode', { mode: 'read-only' })
    expect(service(before.ctx, 'sandboxPolicy').resolve()).toEqual({ mode: 'read-only', workspaceRoot: '/project', sessionId: id })
    expect(service(otherLease.ctx, 'sandboxPolicy').resolve()).toEqual({
      mode: 'workspace-write', workspaceRoot: '/project/nested', sessionId: otherId,
    })
    expect(h.ctx.sessionProjections.stateOf(handle.agent.session, 'sandboxMode')).toBe('read-only')
    expect(h.ctx.sessionProjections.stateOf(other.agent.session, 'sandboxMode')).toBeNull()
    await other.dispose()
    await otherLease.release()
    const { target } = remote
    await h.ctx.executionHostTargets.update({ id: target.id, revision: target.revision,
      label: 'Edited deployment', sshAlias: target.sshAlias,
      execution: { ...target.execution!, endpoint: { ...target.execution!.endpoint, host: 'new.example' } } })
    await expect(h.ctx.executionBindings.acquire(remote.binding, '/project')).rejects.toMatchObject({ code: 'conflict' })
    const retained = await h.ctx.executionBindings.forSession(id)
    expect(retained.incarnation).toBe(before.incarnation)
    expect(sameProvider(retained.ctx, before.ctx, 'fs')).toBe(true)
    expect(await service(retained.ctx, 'fs').readText(await service(retained.ctx, 'fs').resolve('/project/shared.txt'))).toBe('original remote')
    expect(await h.ctx.executionBindings.bindingForSession(id)).toEqual(remote.binding)
    await handle.dispose()
    expect(() => { retained.assertCurrent() }).toThrow()
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(h.ctx.sessions.get(id)).toBeUndefined()
    expect(remote.world.disposed).toBe(0)
    await before.release()
    expect(remote.world.disposed).toBe(0)
    await retained.release()
    expect(remote.world.disposed).toBe(1)
  })

  it('resolves cold Session policy and releases its private consumers without driving an Agent', async () => {
    const h = await createHarness()
    const remote = await h.remote('cold remote')
    const session = h.ctx.sessions.create(SessionId('cold-remote'), { meta: { cwd: '/project/nested' } })
    session.append('execution/bound', { binding: remote.binding })
    session.append('sandbox/mode', { mode: 'workspace-write' })
    const lease = await h.ctx.executionBindings.forSession(session.id)
    expect(h.ctx.agents.get(session.id)).toBeUndefined()
    expect(service(lease.ctx, 'sandboxPolicy').resolve()).toEqual({
      mode: 'workspace-write', workspaceRoot: '/project/nested', sessionId: session.id,
    })
    session.append('sandbox/mode', { mode: 'read-only' })
    const next = await h.ctx.executionBindings.forSession(session.id)
    expect(service(next.ctx, 'sandboxPolicy').resolve().mode).toBe('read-only')
    expect(service(lease.ctx, 'sandboxPolicy').resolve().mode).toBe('workspace-write')
    expect(sameProvider(lease.ctx, next.ctx, 'fs')).toBe(false)
    expect(lease.incarnation).toBe(next.incarnation)
    await lease.release()
    await lease.release()
    expect(lease.signal.aborted).toBe(true)
    expect(() => { next.assertCurrent() }).not.toThrow()
    expect(remote.world.disposed).toBe(0)
    await next.release()
    expect(remote.world.disposed).toBe(1)
  })

  it('keeps legacy Sessions local and unregisters the execution projection on service unload', async () => {
    const h = await createHarness()
    const session = h.ctx.sessions.create(SessionId('legacy-local'), { meta: { cwd: h.localRoot } })
    expect(await h.ctx.executionBindings.bindingForSession(session.id)).toEqual({ kind: 'local' })
    const lease = await h.ctx.executionBindings.forSession(session.id)
    expect(sameProvider(lease.ctx, h.ctx, 'fs')).toBe(true)
    expect(h.ctx.sessionProjections.stateOf(session, 'executionBinding')).toBeNull()
    const fiber = [...h.ctx.loader.entries()].find(entry => entry.options.name === 'execution-binding')?.fiber
    if (fiber === undefined) throw new Error('Binding Loader entry missing')
    await fiber.dispose()
    expect(h.ctx.sessionProjections.stateOf(session, 'executionBinding')).toBeUndefined()
    expect(lease.signal.aborted).toBe(true)
    expect(() => { lease.assertCurrent() }).toThrow('disposed')
    await lease.release()
  })

  it('rejects a durable binding with no admitted provider world at Agent publication', async () => {
    const h = await createHarness()
    const remote = await h.remote('forged remote')
    const id = SessionId('unadmitted-binding')
    await expect(h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: (_agentCtx, agent) => { agent.session.append('execution/bound', { binding: remote.binding }) },
    })).rejects.toThrow('Session execution selection has no admitted Agent provider world')
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(h.ctx.sessions.get(id)).toBeUndefined()
    expect(remote.world.connections).toEqual([])
  })

  it('reserves target authorization until setup commit and lets the edit caller retry', async () => {
    const h = await createHarness()
    const remote = await h.remote('unpublished remote')
    const id = SessionId('reserved-setup')
    const entered = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const created: string[] = []
    h.ctx.on('session/created', (session) => { if (session.id === id) created.push('session') })
    h.ctx.on('agent/created', ({ agent }) => { if (agent.id === id) created.push('agent') })
    const creating = h.ctx.agents.create({ sessionId: id, meta: { cwd: '/project' },
      setup: async (agentCtx, agent) => {
        const commit = await h.ctx.executionBindings.setup(agentCtx, agent, remote.binding)
        entered.resolve(undefined)
        await proceed.promise
        return commit
      } })
    const outcome = creating.then(value => ({ value }), (error: unknown) => ({ error }))
    const { target } = remote
    const edit = { id: target.id, revision: target.revision,
      label: 'Revision changed', sshAlias: target.sshAlias, execution: target.execution }
    try {
      await Promise.race([entered.promise, creating])
      expect(h.ctx.agents.get(id)).toBeUndefined()
      expect(h.ctx.sessions.get(id)).toBeUndefined()
      await expect(h.ctx.executionBindings.forSession(id)).rejects.toThrow('admission is not published')
      await expect(h.ctx.executionHostTargets.update(edit)).rejects.toMatchObject({ code: 'conflict' })
    } finally { proceed.resolve(undefined) }
    const settled = await outcome
    if (!('value' in settled)) throw settled.error
    expect(created).toEqual(['session', 'agent'])
    expect(h.ctx.agents.get(id)).toBe(settled.value.agent)
    expect((await h.ctx.executionHostTargets.update(edit)).target.revision).toBe(target.revision + 1)
    await settled.value.dispose()
    expect(remote.world.disposed).toBe(1)
  })
})
