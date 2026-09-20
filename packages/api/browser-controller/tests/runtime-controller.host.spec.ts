/** Loader composition proves component lifetime is independent from Remote cancellation. */
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import Runtime from '../../../browser/browser-playwright/src/runtime.ts'
import { runtimeMetadata } from '../../../browser/browser-playwright/src/runtime-metadata.ts'
import BrowserController from '../src/index.ts'

const fixtures: { ctx: Context; root: string }[] = []
afterEach(async () => {
  for (const { ctx, root } of fixtures.splice(0)) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-runtime-'))
  const ctx = new Context()
  fixtures.push({ ctx, root })
  let finish!: (value: { exitCode: number; signal: null }) => void
  let joined!: () => void
  let spec: SubprocessSpawnSpec | undefined
  const spawn = vi.fn((input: SubprocessSpawnSpec): SubprocessHandle => {
    spec = input
    const done = new Promise<{ exitCode: number; signal: null }>((resolve) => { finish = resolve })
    const exited = new Promise<boolean>((resolve) => { joined = () =>{  resolve(true) } })
    input.signal?.addEventListener('abort', () => { finish({ exitCode: 1, signal: null }) }, { once: true })
    return { stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
      collected: { stdout: { readFrom: () => ({ text: '| 40%', nextOffset: 5, lossy: false }) } },
      done, terminate: () => {}, waitForExit: () => exited,
    }
  })
  const subprocess = { name: 'fixture-installer', apply(context: Context) { context.provide('subprocess', { spawn } as never) } }
  const modules = new Map<string, unknown>([['subprocess', subprocess], ['runtime', Runtime], ['typert', TypertRegistry], ['controller', BrowserController]])
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { name: 'subprocess' }, { name: 'runtime', config: { storageDir: join(root, 'runtime') } },
    { name: 'typert' }, { name: 'controller' },
  ]))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // Loader only consumes import here; the test module map does not implement the production module registry.
  ctx.loader.internal = { version: 'v2', async import(name: string) { return modules.get(name) } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  async function finishInstall(success = true) {
    if (!spec) throw new Error('Installer not spawned')
    if (success) {
      for (const path of [runtimeMetadata.executableRelative, runtimeMetadata.markerRelative]) {
        const target = join(spec.cwd, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, 'fixture-installed')
      }
    }
    finish({ exitCode: success ? 0 : 1, signal: null })
    joined()
    await vi.waitFor(() =>{  expect(ctx.browserRuntime.task()?.state).not.toBe('running') })
    await vi.waitFor(async () =>{  expect(await import('node:fs').then(fs => fs.existsSync(join(root, 'runtime', 'operation.lock')))).toBe(false) })
  }
  return { ctx, root, spawn, get spec() { return spec }, finishInstall, join: () =>{  joined() } }
}
const signal = () => new AbortController().signal

it('detects without spawning, installs through Loader, and preserves a good generation after failed repair', async () => {
  const b = await boot()
  expect(b.ctx.browserController.runtimeStatus(signal())).toMatchObject({ providerActive: false, managedInstalled: false, browserState: 'stopped', playwrightVersion: '1.61.1' })
  expect(b.spawn).not.toHaveBeenCalled()
  const caller = new AbortController()
  const task = b.ctx.browserController.installRuntime(caller.signal)
  caller.abort()
  await vi.waitFor(() =>{  expect(b.spawn).toHaveBeenCalledTimes(1) })
  expect(b.spec?.signal?.aborted).toBe(false)
  expect(b.spec?.argv).toEqual([process.execPath, runtimeMetadata.cliPath, 'install', 'chromium', '--no-shell'])
  expect(b.spec?.env?.PLAYWRIGHT_BROWSERS_PATH).toBe(b.spec?.cwd)
  expect(b.ctx.browserController.runtimeTask(signal())).toMatchObject({ taskId: task.taskId, progressPercent: 40 })
  await b.finishInstall()
  const oldExecutable = b.ctx.browserRuntime.executablePath()
  expect(await readFile(oldExecutable, 'utf8')).toBe('fixture-installed')
  const next = b.ctx.browserController.reinstallRuntime(signal())
  await vi.waitFor(() =>{  expect(b.spawn).toHaveBeenCalledTimes(2) })
  await expect(b.ctx.browserController.cancelRuntime({ taskId: task.taskId }, signal())).rejects.toThrow('does not match')
  await b.finishInstall(false)
  expect(b.ctx.browserRuntime.task()).toMatchObject({ taskId: next.taskId, state: 'failed', errorCode: 'download-failed' })
  expect(b.ctx.browserRuntime.executablePath()).toBe(oldExecutable)
  expect(await readFile(oldExecutable, 'utf8')).toBe('fixture-installed')
})

it('cancels the exact task and waits for managed process quiescence before settlement', async () => {
  const b = await boot()
  const task = b.ctx.browserController.installRuntime(signal())
  await vi.waitFor(() =>{  expect(b.spawn).toHaveBeenCalledOnce() })
  let settled = false
  const cancel = b.ctx.browserController.cancelRuntime({ taskId: task.taskId }, signal()).then((result) => {
    settled = true
    return result
  })
  await vi.waitFor(() =>{  expect(b.spec?.signal?.aborted).toBe(true) })
  expect(settled).toBe(false)
  b.join()
  expect(await cancel).toMatchObject({ state: 'cancelled' })
  expect(b.ctx.browserRuntime.status().managedInstalled).toBe(false)
})

it('refuses component removal or repair while a native context runs and keeps activation separate', async () => {
  const b = await boot()
  const detach = b.ctx.browserRuntime.attach({ channel: 'chromium', state: () => 'running' })
  expect(b.ctx.browserRuntime.status()).toMatchObject({ providerActive: true, installed: false, browserState: 'running' })
  expect(() => b.ctx.browserController.removeRuntime(signal())).toThrow('Close the native browser')
  expect(() => b.ctx.browserController.reinstallRuntime(signal())).toThrow('Close the native browser')
  detach()
  expect(b.ctx.browserRuntime.status().providerActive).toBe(false)
  const aborted = new AbortController(); aborted.abort()
  expect(() => b.ctx.browserController.installRuntime(aborted.signal)).toThrow()
  expect(b.spawn).not.toHaveBeenCalled()
})
