/** Native host management over real Loader, storage, identity and authenticated Remote carriers. */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ListTargetsValue, TargetValue } from '../src/types.ts'
import { createHarness, remoteResult, success } from './harness.ts'

const TARGETS = '@deepseek-ai/dsh-execution-host-targets'
const CONTROLLER = '@deepseek-ai/dsh-api-execution-host-controller'

describe('executionHosts real Loader composition', () => {
  it.each(['web', 'security-research'] as const)('persists management through HTTP and the desktop carrier from the %s profile', async (profile) => {
    const h = await createHarness({}, profile)
    expect([...h.ctx.loader.entries()].filter(entry => entry.options.name === '@deepseek-ai/dsh-execution-host-local')).toHaveLength(1)
    expect(h.ctx.executionHostTargets).toBeDefined()
    expect(h.ctx.subprocess).toBeDefined()
    const initial = await success<ListTargetsValue>(await h.http('list'))
    expect(initial).toEqual({ targets: [], current: h.ctx.executionHost.current() })
    expect(initial.current.pid).toBe(process.pid)
    expect(initial.current.platform).toBe(process.platform)
    const { target } = await success<TargetValue>(await h.http('create', { request: { label: '  Development  ', sshAlias: 'dev-alias' } }))
    expect(target).toMatchObject({ label: 'Development', sshAlias: 'dev-alias', revision: 1, state: { phase: 'disconnected' } })
    expect(target.id).not.toBe(initial.current.hostId)
    expect(target.createdAt).toEqual(expect.any(String))
    expect(target.updatedAt).toBe(target.createdAt)
    const desktop = await success<ListTargetsValue>(await h.desktop('list'))
    expect(desktop.targets).toEqual([target])
    const { state: _transient, ...saved } = target
    expect(await h.savedDocument()).toMatchObject({ tables: { targets: { [target.id]: saved } } })
    expect(JSON.stringify(await h.savedDocument())).not.toContain('disconnected')
    const updated = await success<TargetValue>(await h.http('update', { request: {
      id: target.id, revision: 1, label: 'Build host', sshAlias: 'build-alias',
    } }))
    expect(updated.target).toMatchObject({ id: target.id, revision: 2, label: 'Build host', sshAlias: 'build-alias' })
    expect(await remoteResult(await h.http('update', { request: {
      id: target.id, revision: 1, label: 'Stale draft', sshAlias: 'stale-alias',
    } }))).toMatchObject({ ok: false, error: { code: 'execution-host/conflict', details: {} } })
    expect(await remoteResult(await h.http('removeTarget', { request: { id: target.id, revision: 1 } })))
      .toMatchObject({ ok: false, error: { code: 'execution-host/conflict' } })
    await h.setEnabled(TARGETS, false)
    await h.setEnabled(TARGETS, true)
    const reloaded = await success<ListTargetsValue>(await h.http('list'))
    expect(reloaded.targets).toEqual([updated.target])
    expect(await success(await h.http('removeTarget', { request: { id: target.id, revision: 2 } }))).toEqual({})
    expect((await success<ListTargetsValue>(await h.http('list'))).targets).toEqual([])
    expect(await h.savedDocument()).toMatchObject({ tables: { targets: {} } })
    expect(await remoteResult(await h.http('disconnect', { request: { id: target.id } })))
      .toMatchObject({ ok: false, error: { code: 'execution-host/not-found' } })
  })

  it('rejects unauthenticated management and resumes only with the actual Connection cookie', async () => {
    const h = await createHarness()
    const unauthorized = await h.http('create', { request: { label: 'Denied', sshAlias: 'denied' } }, false)
    expect(unauthorized.status).toBe(401)
    await unauthorized.text()
    expect((await success<ListTargetsValue>(await h.http('list'))).targets).toEqual([])
    await expect(h.socket(false)).rejects.toThrow('401')
    const stream = await h.socket()
    stream.follow('authenticated')
    expect((await stream.waitForSnapshot('authenticated', value => value.targets.length === 0)).current)
      .toEqual(h.ctx.executionHost.current())
  })

  it('validates target input and deployment capacity before changing durable records', async () => {
    const h = await createHarness({ maxTargets: 1 })
    for (const request of [
      { label: '', sshAlias: 'valid' },
      { label: 'No URL', sshAlias: 'ssh://server' },
      { label: 'No flags', sshAlias: '-oProxyCommand=ignored' },
      { label: 'No command', sshAlias: 'server;exit' },
      { label: 'No secret', sshAlias: 'valid', password: 'rejected-not-persisted' },
    ]) {
      expect(await remoteResult(await h.http('create', { request })))
        .toMatchObject({ ok: false, error: { code: 'execution-host/invalid-request', details: {} } })
    }
    const { target } = await success<TargetValue>(await h.http('create', { request: { label: 'Only target', sshAlias: 'only' } }))
    expect(await remoteResult(await h.http('create', { request: { label: 'Over limit', sshAlias: 'second' } })))
      .toMatchObject({ ok: false, error: { code: 'execution-host/limit-reached' } })
    for (const method of ['connect', 'removeTarget']) {
      expect(await remoteResult(await h.http(method, { request: { id: 'not-a-target-id', revision: 1 } })))
        .toMatchObject({ ok: false, error: { code: 'execution-host/invalid-request' } })
      expect(await remoteResult(await h.http(method, { request: { id: randomUUID(), revision: 1 } })))
        .toMatchObject({ ok: false, error: { code: 'execution-host/not-found' } })
    }
    expect(await remoteResult(await h.http('inspectDirectory', { request: {
      id: target.id, generation: 0, rootId: 'project', path: '',
    } }))).toMatchObject({ ok: false, error: { code: 'execution-host/invalid-request' } })
    expect(await remoteResult(await h.http('inspectDirectory', { request: {
      id: target.id, generation: 1, rootId: 'project', path: '',
    } }))).toMatchObject({ ok: false, error: { code: 'execution-host/connection-lost' } })
    expect((await success<ListTargetsValue>(await h.http('list'))).targets).toEqual([target])
    expect(JSON.stringify(await h.savedDocument())).not.toContain('rejected-not-persisted')
  })

  it('projects a real missing-executable failure and disconnects the failed target through authenticated transport', async () => {
    const h = await createHarness()
    const { target } = await success<TargetValue>(await h.http('create', { request: { label: 'Missing SSH', sshAlias: 'configured-alias' } }))
    const result = await remoteResult(await h.http('connect', { request: { id: target.id, revision: target.revision } }))
    expect(result).toMatchObject({ ok: false, error: { code: 'execution-host/ssh-unavailable', details: {} } })
    expect(JSON.stringify(result)).not.toContain(h.root)
    const observed = await success<ListTargetsValue>(await h.http('list'))
    expect(observed.targets[0]?.state).toMatchObject({ phase: 'error', generation: 1, code: 'ssh-unavailable' })
    const disconnected = await success<TargetValue>(await h.http('disconnect', { request: { id: target.id } }))
    expect(disconnected.target.state).toEqual({ phase: 'disconnected' })
    await h.setEnabled(TARGETS, false)
    await h.setEnabled(TARGETS, true)
    expect((await success<ListTargetsValue>(await h.http('list'))).targets[0]?.state).toEqual({ phase: 'disconnected' })
  })

  it('withdraws the controller endpoint during Loader disposal and restores it after reload', async () => {
    const h = await createHarness()
    await h.setEnabled(CONTROLLER, false)
    const withdrawn = await h.http('list')
    expect(withdrawn.status).toBe(404)
    expect(await withdrawn.text()).toBe('not found')
    await h.setEnabled(CONTROLLER, true)
    expect((await success<ListTargetsValue>(await h.http('list'))).targets).toEqual([])
  })
})
