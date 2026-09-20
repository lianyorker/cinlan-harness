/** Native opening uses one real Session execution lease and never dispatches remote paths locally. */
import { hostname } from 'node:os'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeFileManager } from '@deepseek-ai/dsh-native-command'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHarness } from '../../../execution-host/execution-binding/tests/harness.ts'
import { createSessionTestController, createSessionTestRemote } from './test-remote.ts'

vi.mock('@deepseek-ai/dsh-ssh', async () => {
  const { FixtureSsh } = await import('../../../execution-host/execution-binding/tests/fixture-ssh.ts')
  return { default: FixtureSsh, SshConnection: FixtureSsh }
})
afterEach(() => { vi.restoreAllMocks() })

async function fixture() {
  const h = await createHarness()
  const session = h.ctx.sessions.prepare(SessionId('path-owner'), { meta: { cwd: h.localRoot } })
  h.ctx.effect(() => h.ctx.sessions.enter(session))
  return { ...h, sessionId: session.id, defaults: { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: h.localRoot } }
}

describe('session/openWorkspacePath', () => {
  it('describes the serving desktop and reveals the canonical Session path without starting an Agent', async () => {
    const h = await fixture()
    const openPath = vi.fn(async (_path: string, _signal: AbortSignal) => {})
    const revealPath = vi.fn(async (_path: string, _signal: AbortSignal) => {})
    const controller = createSessionTestController(h.ctx, { ...h.defaults, openPath, revealPath, canOpenPath: () => true })
    expect(controller.workspaceDesktop()).toEqual({
      name: hostname(), available: nativeFileManager() !== null, fileManager: nativeFileManager(),
    })
    await expect(controller.openWorkspacePath({ sessionId: h.sessionId, path: 'shared.txt', action: 'reveal' }, new AbortController().signal))
      .resolves.toEqual({ opened: true })
    expect(revealPath).toHaveBeenCalledWith(await realpath(join(h.localRoot, 'shared.txt')), expect.any(AbortSignal))
    expect(openPath).not.toHaveBeenCalled()
    expect(h.ctx.agents.list()).toEqual([])
  })

  it('reports deployment opener capability independently of a Session', async () => {
    const h = await fixture()
    const remote = createSessionTestRemote(h.ctx, { ...h.defaults, canOpenPath: () => false })
    await expect(remote.canOpenWorkspacePath()).resolves.toEqual({ ok: true, value: false })
  })

  it.each(['configured', 'injected', 'detected'] as const)('derives %s opener availability', async (mode) => {
    const h = await fixture()
    const remote = createSessionTestRemote(h.ctx, { ...h.defaults,
      ...(mode === 'configured' ? { nativeOpen: false } : mode === 'injected' ? { openPath: async () => {} } : {}),
    })
    const result = await remote.canOpenWorkspacePath()
    expect(result).toMatchObject({ ok: true, ...(mode === 'detected' ? {} : { value: mode === 'injected' }) })
  })

  it('resolves relative and absolute paths in the real local Session filesystem', async () => {
    const h = await fixture()
    const openPath = vi.fn(async (_path: string, _signal: AbortSignal) => {})
    const remote = createSessionTestRemote(h.ctx, { ...h.defaults, openPath })
    const absolute = await realpath(join(h.localRoot, 'shared.txt'))
    for (const path of ['shared.txt', absolute]) {
      await expect(remote.openWorkspacePath({ sessionId: h.sessionId, path })).resolves.toEqual({ ok: true, value: { opened: true } })
    }
    expect(openPath.mock.calls.map(call => call[0])).toEqual([absolute, absolute])
    expect(h.ctx.agents.list()).toEqual([])
  })

  it('rejects empty paths before acquiring a lease or dispatching filesystem work', async () => {
    const h = await fixture()
    const openPath = vi.fn(async (_path: string, _signal: AbortSignal) => {})
    const remote = createSessionTestRemote(h.ctx, { ...h.defaults, openPath })
    const lease = vi.spyOn(h.ctx.executionBindings, 'forSession')
    const resolve = vi.spyOn(h.ctx.fs, 'resolve')
    await expect(remote.openWorkspacePath({ sessionId: h.sessionId, path: '' })).resolves.toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
    expect(lease).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })

  it('preserves native opener failures and admission cancellation', async () => {
    const h = await fixture()
    const openPath = vi.fn(async (_path: string, _signal: AbortSignal) => { throw new Error('desktop unavailable') })
    const remote = createSessionTestRemote(h.ctx, { ...h.defaults, openPath })
    await expect(remote.openWorkspacePath({ sessionId: h.sessionId, path: 'shared.txt' })).resolves.toMatchObject({
      ok: false, error: { code: 'gateway/internal', message: 'path open failed: desktop unavailable' },
    })
    const aborted = new AbortController()
    aborted.abort(new Error('gateway/cancelled'))
    await expect(remote.openWorkspacePath({ sessionId: h.sessionId, path: 'shared.txt' }, aborted.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/cancelled' } })
    expect(openPath).toHaveBeenCalledOnce()
  })

  it('passes caller cancellation through the combined lease signal and classifies non-Error failures', async () => {
    const h = await fixture()
    const caller = new AbortController()
    const openPath = vi.fn<(_path: string, signal: AbortSignal) => Promise<void>>()
      .mockImplementationOnce(async (_path, signal) => {
        expect(signal).not.toBe(caller.signal)
        expect(signal.aborted).toBe(false)
        caller.abort(new Error('gateway/cancelled'))
        expect(signal.aborted).toBe(true)
        signal.throwIfAborted()
      }).mockRejectedValueOnce('desktop unavailable')
    const controller = createSessionTestController(h.ctx, { ...h.defaults, openPath })
    await expect(controller.openWorkspacePath({ sessionId: h.sessionId, path: 'shared.txt' }, caller.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    await expect(controller.openWorkspacePath({ sessionId: h.sessionId, path: 'shared.txt' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/internal', message: 'path open failed: desktop unavailable' })
  })

  it('refuses a recorded remote Session before any local file or native application dispatch', async () => {
    const h = await fixture()
    const peer = await h.remote('remote contents')
    const session = h.ctx.sessions.prepare(SessionId('remote-owner'), { meta: { cwd: '/project' } })
    session.append('execution/bound', { binding: peer.binding })
    h.ctx.effect(() => h.ctx.sessions.enter(session))
    const openPath = vi.fn(async (_path: string, _signal: AbortSignal) => {})
    const revealPath = vi.fn(async (_path: string, _signal: AbortSignal) => {})
    const controller = createSessionTestController(h.ctx, { ...h.defaults, openPath, revealPath })
    const resolve = vi.spyOn(h.ctx.fs, 'resolve')
    const stat = vi.spyOn(h.ctx.fs, 'stat')
    const lstat = vi.spyOn(h.ctx.fs, 'lstat')
    for (const action of ['open', 'reveal'] as const) {
      await expect(controller.openWorkspacePath({ sessionId: session.id, path: 'shared.txt', action }, new AbortController().signal))
        .rejects.toMatchObject({ code: 'session/path-open-unavailable', message: 'Host applications cannot open remote execution paths' })
    }
    expect(resolve).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
    expect(lstat).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
    expect(revealPath).not.toHaveBeenCalled()
    expect(h.ctx.agents.list()).toEqual([])
  })
})
