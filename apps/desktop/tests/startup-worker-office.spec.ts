import { EventEmitter } from 'node:events'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import type { DesktopProjectHooks } from '../src/project-manager.ts'

afterEach(() => { vi.restoreAllMocks(); vi.resetModules() })

async function prepare(primaryRuntime: string | undefined) {
  const root = resolve('fixture-office-worker')
  const completed = Promise.withResolvers<unknown>()
  const messages: unknown[] = []
  const port = Object.assign(new EventEmitter(), {
    postMessage: (message: unknown) => { messages.push(message) },
    close: () => { completed.resolve(undefined) },
  })
  const host = vi.fn()
  const probe = vi.fn(async () => {})
  vi.doMock('node:worker_threads', () => ({ parentPort: port, workerData: {
    paths: resolveDesktopPaths(root), runtime: { node: process.execPath, pnpm: join(root, 'pnpm.mjs') },
    seed: join(root, 'seed'), primaryRuntime, version: '1.0.0', cancellation: new SharedArrayBuffer(4),
  } }))
  vi.doMock('../src/host-process.ts', () => ({ DesktopHostProcess: function (...args: unknown[]) { host(...args) } }))
  vi.doMock('../src/startup-probe.ts', () => ({ checkDesktopStartupHost: probe }))
  vi.doMock('../src/project-manager.ts', () => ({ DesktopProjectManager: class {
    async applyRelease(_seed: string, _version: string, hooks: DesktopProjectHooks) {
      await hooks.healthCheck(join(root, 'staging', 'profile'))
    }
  } }))
  await import('../src/startup-worker.ts')
  await completed.promise
  return { root, host, probe, messages, port }
}

it('passes the application Office payload to the staged health-check Host', async () => {
  const primaryRuntime = resolve('resources with spaces', 'runtime', 'primary-runtime')
  const run = await prepare(primaryRuntime)
  expect(run.host).toHaveBeenCalledWith(process.execPath, join(run.root, 'staging', 'profile'), undefined, false, undefined, primaryRuntime)
  expect(run.probe).toHaveBeenCalledOnce()
  expect(run.messages).toEqual([{ type: 'done' }])
  expect(run.port.listenerCount('message')).toBe(0)
})

it.each([undefined, 'relative/runtime'])('rejects missing or relative Office resources before touching the profile: %s', async (primaryRuntime) => {
  const run = await prepare(primaryRuntime)
  expect(run.host).not.toHaveBeenCalled()
  expect(run.probe).not.toHaveBeenCalled()
  expect(run.messages).toEqual([expect.objectContaining({ type: 'error', message: 'Desktop preparation worker received invalid paths or cancellation state' })])
})
