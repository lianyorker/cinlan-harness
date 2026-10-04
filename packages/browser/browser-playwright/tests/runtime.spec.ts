/** Native runtime transactions use real private files and controlled installer settlement. */
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Runtime, { type Config } from '../src/runtime.ts'
import { runtimeMetadata } from '../src/runtime-metadata.ts'
import type { BrowserRuntimeTaskId } from '../src/types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}
const contexts: Context[] = []
const roots: string[] = []
const releases: (() => Promise<void>)[] = []
const unblock: (() => void)[] = []
afterEach(async () => {
  for (const done of unblock.splice(0)) done()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const release of releases.splice(0)) await release()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-runtime-unit-'))
  roots.push(root)
  return root
}
type Spawn = (spec: SubprocessSpawnSpec) => SubprocessHandle
function managerWith(
  RuntimeClass: typeof Runtime,
  root: string,
  spawn: Spawn = vi.fn<Spawn>(() => { throw new Error('Unexpected installer') }),
  config: Config = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('subprocess', { spawn } as unknown as Context['subprocess'])
  const runtime = new RuntimeClass(ctx, { storageDir: root, ...config })
  return { runtime, ctx, spawn }
}
function manager(root: string, spawn?: Spawn, config: Config = {}) {
  return managerWith(Runtime, root, spawn, config)
}
/** Import a fresh manager module whose filesystem raises one injected fault.
 * The real filesystem cannot produce these failures portably: Windows reports a
 * path through a file as ENOENT, and permission failures need POSIX modes.
 */
async function faultedRuntime(faults: {
  readonly statSync?: (path: string) => never
  readonly writeFile?: (path: unknown, data: unknown, options: unknown) => Promise<void>
  readonly rm?: (path: unknown, options: unknown) => Promise<void>
}): Promise<typeof Runtime> {
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>()
    return faults.statSync === undefined
      ? actual
      : { ...actual, statSync: faults.statSync as unknown as typeof actual.statSync }
  })
  vi.doMock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>()
    return {
      ...actual,
      ...faults.writeFile === undefined ? {} : { writeFile: faults.writeFile as unknown as typeof actual.writeFile },
      ...faults.rm === undefined ? {} : { rm: faults.rm as unknown as typeof actual.rm },
    }
  })
  vi.resetModules()
  return (await import('../src/runtime.ts')).default
}
async function releaseFaults(): Promise<void> {
  vi.doUnmock('node:fs')
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
}
/** A spawn fake whose child settles when the test, or an abort, says so. */
function controllable(options: {
  readonly collected?: SubprocessHandle['collected']
  readonly onSpawn?: (spec: SubprocessSpawnSpec, settle: (outcome: SubprocessOutcome) => void) => void
} = {}) {
  const started = deferred<SubprocessSpawnSpec>()
  const outcome = deferred<SubprocessOutcome>()
  const settle = (value: SubprocessOutcome): void => { outcome.resolve(value) }
  unblock.push(() => { settle({ exitCode: null, signal: 'SIGTERM' }) })
  const spawn = vi.fn((spec: SubprocessSpawnSpec): SubprocessHandle => {
    spec.signal?.addEventListener('abort', () => { settle({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
    started.resolve(spec)
    options.onSpawn?.(spec, settle)
    return {
      stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
      collected: options.collected ?? { stdout: { readFrom: () => ({ text: '40%', nextOffset: 3, lossy: false }) } },
      done: outcome.promise, terminate: vi.fn(), waitForExit: vi.fn(async () => true),
    }
  })
  return { spawn, started: started.promise, outcome }
}
const pointerPath = (root: string) => join(root, 'active-' + runtimeMetadata.revision + '.json')
async function generation(root: string, name: string, contents = 'fixture executable') {
  const directory = join(root, name)
  const executable = join(directory, runtimeMetadata.executableRelative)
  const marker = join(directory, runtimeMetadata.markerRelative)
  await mkdir(dirname(executable), { recursive: true })
  await mkdir(dirname(marker), { recursive: true })
  await writeFile(executable, contents)
  await writeFile(marker, '')
  return { directory, executable }
}
async function installed(root: string) {
  const old = await generation(root, 'generation-original')
  await writeFile(pointerPath(root), JSON.stringify(basename(old.directory)))
  return old
}
async function settled(runtime: Runtime) {
  await vi.waitFor(() => {
    expect(runtime.task()).not.toBeNull()
    expect(runtime.task()?.state).not.toBe('running')
  })
  return runtime.task()!
}
function installer() {
  const started = deferred<SubprocessSpawnSpec>()
  const outcome = deferred<SubprocessOutcome>()
  const rangeExited = deferred<boolean>()
  let holdExit = false
  unblock.push(() => { outcome.resolve({ exitCode: null, signal: 'SIGTERM' }); rangeExited.resolve(true) })
  const waitForExit = vi.fn(async () => holdExit ? rangeExited.promise : true)
  const terminate = vi.fn()
  const spawn = vi.fn((spec: SubprocessSpawnSpec): SubprocessHandle => {
    spec.signal?.addEventListener('abort', () => { outcome.resolve({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
    started.resolve(spec)
    return { stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
      collected: { stdout: { readFrom: () => ({ text: '40%', nextOffset: 3, lossy: false }) } },
      done: outcome.promise, terminate, waitForExit }
  })
  return { spawn, started: started.promise, outcome, rangeExited, terminate, waitForExit,
    holdRange() { holdExit = true },
    async succeed(spec: SubprocessSpawnSpec) {
      await generation(dirname(spec.cwd), basename(spec.cwd), 'new executable')
      outcome.resolve({ exitCode: 0, signal: null })
    } }
}

describe('Native runtime storage and lifecycle', () => {
  it.each(['remove', 'reinstall'] as const)('a second manager cannot %s a leased runtime and succeeds after release', async (operation) => {
    const root = await temporaryRoot()
    const old = await installed(root)
    const first = manager(root)
    const fake = installer()
    const second = manager(root, fake.spawn)
    const release = await first.runtime.acquireBrowserLease()
    releases.push(release)
    second.runtime.start(operation)
    expect(await settled(second.runtime)).toMatchObject({ state: 'failed', errorCode: 'filesystem-failed' })
    expect(await readFile(old.executable, 'utf8')).toBe('fixture executable')
    expect(existsSync(join(root, 'operation.lock'))).toBe(true)
    expect(fake.spawn).not.toHaveBeenCalled()
    await expect(second.runtime.acquireBrowserLease()).rejects.toMatchObject({ code: 'EEXIST' })
    await release()
    second.runtime.start(operation)
    if (operation === 'reinstall') await fake.succeed(await fake.started)
    expect(await settled(second.runtime)).toMatchObject({ state: 'succeeded' })
    expect(existsSync(join(root, 'operation.lock'))).toBe(false)
    expect(second.runtime.status().managedInstalled).toBe(operation === 'reinstall')
    await release()
  })

  it('keeps the old executable selected until installer exit and commit complete', async () => {
    const root = await temporaryRoot()
    const old = await installed(root)
    const fake = installer()
    fake.holdRange()
    const b = manager(root, fake.spawn)
    b.runtime.attach({ channel: 'chromium', state: () => 'stopped' })
    const task = b.runtime.start('reinstall')
    const spec = await fake.started
    expect(spec.argv).toEqual([process.execPath, runtimeMetadata.cliPath, 'install', 'chromium', '--no-shell'])
    expect(spec.env?.PLAYWRIGHT_BROWSERS_PATH).toBe(spec.cwd)
    expect(b.runtime.status()).toMatchObject({ installed: true, executablePath: old.executable })
    expect(b.runtime.task()).toMatchObject({ taskId: task.taskId, state: 'running', progressPercent: 40 })
    expect(() => b.runtime.start('remove')).toThrow('in progress')
    await expect(b.runtime.acquireBrowserLease()).rejects.toThrow('in progress')
    expect(() => b.runtime.executablePath()).toThrow('in progress')
    await fake.succeed(spec)
    await vi.waitFor(() => { expect(fake.waitForExit).toHaveBeenCalledOnce() })
    expect(b.runtime.task()?.state).toBe('running')
    expect(await readFile(pointerPath(root), 'utf8')).toBe(JSON.stringify('generation-original'))
    expect(existsSync(join(root, 'operation.lock'))).toBe(true)
    fake.rangeExited.resolve(true)
    expect(await settled(b.runtime)).toMatchObject({ state: 'succeeded', phase: 'complete', progressPercent: 100 })
    expect(b.runtime.executablePath()).toBe(join(spec.cwd, runtimeMetadata.executableRelative))
    expect(await readFile(old.executable, 'utf8')).toBe('fixture executable')
    expect(existsSync(join(root, 'operation.lock'))).toBe(false)
    expect(fake.terminate).toHaveBeenCalledOnce()
  })

  it('removes all managed generations without deleting profiles or linked external files', async () => {
    const root = await temporaryRoot()
    await installed(root)
    await generation(root, 'generation-obsolete')
    const profile = join(root, 'profiles', 'default')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'cookies.json'), 'preserve profile')
    const external = await temporaryRoot()
    await writeFile(join(external, 'user-file'), 'preserve external')
    await symlink(external, join(root, 'generation-linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const b = manager(root)
    b.runtime.start('remove')
    expect(await settled(b.runtime)).toMatchObject({ state: 'succeeded' })
    expect(await readdir(root)).toEqual(['profiles'])
    expect(await readFile(join(profile, 'cookies.json'), 'utf8')).toBe('preserve profile')
    expect(await readFile(join(external, 'user-file'), 'utf8')).toBe('preserve external')
    expect(b.runtime.status().managedInstalled).toBe(false)
    expect(b.spawn).not.toHaveBeenCalled()
  })

  it('detects missing runtime files without creating storage or launching a subprocess', async () => {
    const root = join(await temporaryRoot(), 'absent-runtime')
    const b = manager(root)
    b.runtime.attach({ channel: 'chromium', state: () => 'stopped' })
    expect(b.runtime.status()).toMatchObject({ installed: false, managedInstalled: false, browserState: 'stopped', task: null })
    expect(() => b.runtime.executablePath()).toThrow('Managed Chromium is missing')
    expect(existsSync(root)).toBe(false)
    expect(b.spawn).not.toHaveBeenCalled()
    await mkdir(root)
    await writeFile(pointerPath(root), JSON.stringify('generation-absent'))
    expect(b.runtime.status().managedInstalled).toBe(false)
    expect(() => b.runtime.executablePath()).toThrow('Managed Chromium is missing')
  })

  it.each(['{', JSON.stringify('../outside'), JSON.stringify({ generation: 'generation-original' })])('rejects corrupt active pointer %s without reading a substitute installation', async (pointer) => {
    const root = await temporaryRoot()
    await installed(root)
    await writeFile(pointerPath(root), pointer)
    const b = manager(root)
    expect(() => b.runtime.status()).toThrow()
    expect(() => b.runtime.executablePath()).toThrow()
    expect(b.spawn).not.toHaveBeenCalled()
    b.runtime.start('remove')
    expect(await settled(b.runtime)).toMatchObject({ state: 'succeeded' })
    expect(b.runtime.status().managedInstalled).toBe(false)
  })

  it('does not accept an incomplete generation as installed', async () => {
    const root = await temporaryRoot()
    const old = await installed(root)
    await rm(join(old.directory, runtimeMetadata.markerRelative))
    const b = manager(root)
    expect(b.runtime.status().managedInstalled).toBe(false)
    expect(() => b.runtime.executablePath()).toThrow('Managed Chromium is missing')
  })

  it('cancels only the exact task and publishes cancellation after staging and lock cleanup', async () => {
    const root = await temporaryRoot()
    const fake = installer()
    fake.holdRange()
    const b = manager(root, fake.spawn)
    const task = b.runtime.start('install')
    const spec = await fake.started
    await expect(b.runtime.cancel('other-task' as BrowserRuntimeTaskId)).rejects.toThrow('does not match')
    expect(spec.signal?.aborted).toBe(false)
    const cancellation = b.runtime.cancel(task.taskId)
    await vi.waitFor(() => { expect(fake.waitForExit).toHaveBeenCalledOnce() })
    expect(b.runtime.task()?.state).toBe('running')
    expect(existsSync(spec.cwd)).toBe(true)
    fake.rangeExited.resolve(true)
    expect(await cancellation).toMatchObject({ taskId: task.taskId, state: 'cancelled', errorCode: null })
    expect(await readdir(root)).toEqual([])
    expect(fake.terminate).toHaveBeenCalledOnce()
  })

  it('keeps committed files after installer failure and removes its staging directory', async () => {
    const root = await temporaryRoot()
    const old = await installed(root)
    const fake = installer()
    const b = manager(root, fake.spawn)
    b.runtime.start('reinstall')
    const spec = await fake.started
    fake.outcome.resolve({ exitCode: 1, signal: null })
    expect(await settled(b.runtime)).toMatchObject({ state: 'failed', errorCode: 'download-failed' })
    expect(b.runtime.executablePath()).toBe(old.executable)
    expect(existsSync(spec.cwd)).toBe(false)
    expect(existsSync(join(root, 'operation.lock'))).toBe(false)
  })

  it('reuses an installed pin without spawning an installer', async () => {
    const root = await temporaryRoot()
    const old = await installed(root)
    const b = manager(root)
    b.runtime.start('install')
    expect(await settled(b.runtime)).toMatchObject({ state: 'succeeded' })
    expect(b.runtime.executablePath()).toBe(old.executable)
    expect(b.spawn).not.toHaveBeenCalled()
  })

  it.each(['starting', 'running'] as const)('rejects mutations while attached browser state is %s', async (state) => {
    const b = manager(await temporaryRoot())
    const close = vi.fn(async () => {})
    const detach = b.runtime.attach({ channel: 'chromium', state: () => state, close })
    for (const operation of ['install', 'reinstall', 'remove'] as const) expect(() => b.runtime.start(operation)).toThrow('Close the native browser')
    expect(() => b.runtime.attach({ channel: 'chrome', state: () => 'stopped' })).toThrow('already attached')
    await b.runtime.closeBrowser()
    expect(close).toHaveBeenCalledOnce()
    detach(); detach()
    expect(b.runtime.status().providerActive).toBe(false)
  })

  it.each([
    { installTimeoutMs: 0 }, { installTimeoutMs: 1.5 }, { installTimeoutMs: 2_147_483_648 },
    { processGraceMs: 0 }, { processGraceMs: 60_001 }, { maxOutputBytes: 1023 }, { maxOutputBytes: 1_048_577 },
  ])('rejects invalid runtime configuration %j before filesystem effects', async (config) => {
    const root = join(await temporaryRoot(), 'not-created')
    expect(() => Runtime.Config({ storageDir: root, ...config })).toThrow()
    expect(existsSync(root)).toBe(false)
  })

  it('reports a configured custom executable without probing managed storage', async () => {
    const root = await temporaryRoot()
    const custom = join(root, 'custom', 'chrome.exe')
    const b = manager(root)
    b.runtime.attach({ channel: 'chrome', executablePath: custom, state: () => 'stopped' })
    expect(b.runtime.status()).toMatchObject({
      providerActive: true, channel: 'chrome', source: 'custom', executablePath: custom,
      installed: false, managedInstalled: false, browserState: 'stopped', attached: false, task: null,
    })
  })

  it('propagates a filesystem probe failure instead of reporting a missing installation', async () => {
    const root = await temporaryRoot()
    const RuntimeUnderFault = await faultedRuntime({
      statSync: (path) => { throw Object.assign(new Error('EIO: i/o error, stat ' + path), { code: 'EIO' }) },
    })
    try {
      const b = managerWith(RuntimeUnderFault, root)
      b.runtime.attach({ channel: 'chrome', executablePath: join(root, 'chrome.exe'), state: () => 'stopped' })
      expect(() => b.runtime.status()).toThrow('EIO: i/o error')
    } finally {
      await releaseFaults()
    }
  })

  it('refuses to start work after the runtime service is disposed', async () => {
    const root = await temporaryRoot()
    const b = manager(root)
    await b.ctx.fiber.dispose()
    expect(() => b.runtime.start('install')).toThrow('Browser runtime is disposed')
    expect(b.runtime.task()).toBeNull()
    expect(await readdir(root)).toEqual([])
  })

  it('fails an installer that outlives its deadline and releases the lock', async () => {
    // The deadline timer is advanced explicitly so the installer is always
    // spawned before it fires, however slow the machine is.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const root = await temporaryRoot()
      const fake = installer()
      const b = manager(root, fake.spawn, { installTimeoutMs: 600_000 })
      const task = b.runtime.start('install')
      const spec = await fake.started
      expect(b.runtime.task()).toMatchObject({ taskId: task.taskId, state: 'running' })
      vi.advanceTimersByTime(600_001)
      expect(spec.signal?.aborted).toBe(true)
      expect(await settled(b.runtime)).toMatchObject({
        taskId: task.taskId, state: 'failed', phase: 'complete', errorCode: 'download-failed',
      })
      expect(existsSync(spec.cwd)).toBe(false)
      expect(existsSync(join(root, 'operation.lock'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an installer that exits without the pinned browser files', async () => {
    const root = await temporaryRoot()
    const fake = installer()
    const b = manager(root, fake.spawn)
    b.runtime.start('install')
    const spec = await fake.started
    fake.outcome.resolve({ exitCode: 0, signal: null })
    expect(await settled(b.runtime)).toMatchObject({ state: 'failed', errorCode: 'download-failed' })
    expect(existsSync(spec.cwd)).toBe(false)
    expect(b.runtime.status().managedInstalled).toBe(false)
  })

  it('reports no installer progress when the subprocess captures no output', async () => {
    const root = await temporaryRoot()
    const fake = controllable({ collected: {} })
    const b = manager(root, fake.spawn)
    const task = b.runtime.start('install')
    const spec = await fake.started
    expect(b.runtime.task()).toMatchObject({ taskId: task.taskId, state: 'running', progressPercent: null })
    await generation(dirname(spec.cwd), basename(spec.cwd), 'new executable')
    fake.outcome.resolve({ exitCode: 0, signal: null })
    expect(await settled(b.runtime)).toMatchObject({ state: 'succeeded', phase: 'complete', progressPercent: 100 })
  })

  it('removes its staged pointer when the commit rename fails', async () => {
    const root = await temporaryRoot()
    await mkdir(pointerPath(root))
    const fake = installer()
    const b = manager(root, fake.spawn)
    b.runtime.start('reinstall')
    await fake.succeed(await fake.started)
    expect(await settled(b.runtime)).toMatchObject({ state: 'failed', phase: 'complete', errorCode: 'filesystem-failed' })
    expect(await readdir(root)).toEqual([basename(pointerPath(root))])
  })

  it('reports a filesystem failure when failed-install staging is already gone', async () => {
    const root = await temporaryRoot()
    const fake = controllable({
      onSpawn: (spec, settle) => {
        void rm(spec.cwd, { recursive: true, force: true }).then(() => { settle({ exitCode: 1, signal: null }) })
      },
    })
    const b = manager(root, fake.spawn)
    b.runtime.start('install')
    const spec = await fake.started
    expect(await settled(b.runtime)).toMatchObject({ state: 'failed', phase: 'complete', errorCode: 'filesystem-failed' })
    expect(existsSync(spec.cwd)).toBe(false)
    expect(await readdir(root)).toEqual([])
  })

  it('refuses to cancel a task that is committing its generation', async () => {
    const root = await temporaryRoot()
    const fake = installer()
    const commitGate = deferred<undefined>()
    const RuntimeUnderFault = await faultedRuntime({
      writeFile: async (path, data, options) => {
        await commitGate.promise
        await writeFile(path as never, data as never, options as never)
      },
    })
    try {
      const b = managerWith(RuntimeUnderFault, root, fake.spawn)
      const task = b.runtime.start('reinstall')
      const spec = await fake.started
      await fake.succeed(spec)
      await vi.waitFor(() => { expect(b.runtime.task()?.phase).toBe('committing') })
      expect(spec.signal?.aborted).toBe(false)
      await expect(b.runtime.cancel(task.taskId)).rejects.toThrow('Browser runtime commit cannot be cancelled')
      commitGate.resolve(undefined)
      expect(await settled(b.runtime)).toMatchObject({ state: 'succeeded', phase: 'complete', progressPercent: 100 })
      expect(b.runtime.executablePath()).toBe(join(spec.cwd, runtimeMetadata.executableRelative))
    } finally {
      commitGate.resolve(undefined)
      await releaseFaults()
    }
  })

  it('reports a filesystem failure when the operation lock cannot be released', async () => {
    const root = await temporaryRoot()
    const fake = installer()
    const RuntimeUnderFault = await faultedRuntime({
      rm: async (path, options) => {
        if (typeof path === 'string' && basename(path) === 'operation.lock') throw new Error('lock is busy')
        await rm(path as never, options as never)
      },
    })
    try {
      const b = managerWith(RuntimeUnderFault, root, fake.spawn)
      b.runtime.start('install')
      await fake.succeed(await fake.started)
      expect(await settled(b.runtime)).toMatchObject({ state: 'failed', phase: 'complete', errorCode: 'filesystem-failed' })
      expect(existsSync(join(root, 'operation.lock'))).toBe(true)
    } finally {
      await releaseFaults()
    }
  })
})

describe('pinned runtime metadata', () => {
  const bundlePath = createRequire(import.meta.url).resolve('playwright-core/lib/coreBundle')

  /** Import the metadata module against a stubbed pinned Playwright bundle. */
  async function importWithBundle(bundle: unknown): Promise<typeof import('../src/runtime-metadata.ts')> {
    const require = createRequire(import.meta.url)
    const original = require.cache[bundlePath]
    require.cache[bundlePath] = {
      id: bundlePath, filename: bundlePath, loaded: true, exports: bundle,
    } as unknown as NodeJS.Module
    try {
      vi.resetModules()
      return await import('../src/runtime-metadata.ts')
    } finally {
      if (original === undefined) Reflect.deleteProperty(require.cache, bundlePath)
      else require.cache[bundlePath] = original
      vi.resetModules()
    }
  }

  it('fails loud when the pinned bundle cannot supply a managed Chromium', async () => {
    await expect(importWithBundle({
      registry: {
        registry: { findExecutable: () => ({ executablePath: () => undefined }) },
        registryDirectory: join(tmpdir(), 'pinned-registry'),
      },
    })).rejects.toThrow('Pinned Playwright does not support managed Chromium on this platform')
  })

  it('derives generation paths from the pinned registry and reports no origins without download URLs', async () => {
    const registryDirectory = join(tmpdir(), 'pinned-registry')
    const directory = join(registryDirectory, 'chromium-1234')
    const executable = join(directory, 'chrome-win', 'chrome.exe')
    const metadata = await importWithBundle({
      registry: {
        registry: {
          findExecutable: () => ({
            executablePath: () => executable, directory, revision: '1234', browserVersion: '140.0.0.0',
          }),
        },
        registryDirectory,
      },
    })
    expect(metadata.runtimeMetadata).toMatchObject({
      revision: '1234',
      browserVersion: '140.0.0.0',
      executableRelative: relative(registryDirectory, executable),
      markerRelative: relative(registryDirectory, join(directory, 'INSTALLATION_COMPLETE')),
      downloadOrigins: [],
    })
    expect(metadata.runtimeMetadata.playwrightVersion).toMatch(/^\d+\./u)
    expect(metadata.runtimeMetadata.cliPath.endsWith('cli.js')).toBe(true)
  })
})
