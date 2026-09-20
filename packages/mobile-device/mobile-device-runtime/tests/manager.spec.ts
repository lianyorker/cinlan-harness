/** Host task ownership with real managed storage and controlled external transport/process responses. */
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MobileRuntime from '../src/index.ts'
import { MobileResourceStore } from '../src/store.ts'
import { catalog } from '../src/catalog.ts'
import { downloadArchive } from '../src/download.ts'
import { extractArchive } from '../src/archive.ts'
import { probe } from '../src/process.ts'
import type { MobileResourceRevision, MobileResourceTaskId } from '../src/types.ts'
vi.mock('../src/download.ts', () => ({ downloadArchive: vi.fn() }))
vi.mock('../src/archive.ts', () => ({ extractArchive: vi.fn() }))
vi.mock('../src/process.ts', () => ({ probe: vi.fn() }))
const roots: { ctx: Context; path: string }[] = []
const signal = new AbortController().signal
const hostPlatform = process.platform
const hostArch = process.arch
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true })
  vi.mocked(downloadArchive).mockImplementation(async (_definition, file) => { await writeFile(file, 'archive') })
  vi.mocked(extractArchive).mockImplementation(async (_archive, stage) => { await writeFile(join(stage, 'adb.exe'), 'verified binary') })
  vi.mocked(probe).mockImplementation(async (_ctx, _config, _executable, args) => args[0] === 'devices' ? 'List of devices attached\n' : 'Android Debug Bridge version 37.0.1')
})
afterEach(async () => {
  for (const root of roots.splice(0)) { await root.ctx.fiber.dispose(); await rm(root.path, { recursive: true, force: true }) }
  vi.restoreAllMocks(); vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: hostPlatform, configurable: true })
  Object.defineProperty(process, 'arch', { value: hostArch, configurable: true })
})
async function bench() {
  const path = await mkdtemp(join(tmpdir(), 'dsh-mobile-manager-'))
  const ctx = new Context(); roots.push({ ctx, path })
  let sdk = ''
  ctx.provide('mobileDevice', { getPreferences: () => ({ androidSdkPath: sdk }) } as never)
  const runtime = new MobileRuntime(ctx, { storageDir: path })
  const store = new MobileResourceStore(path, 3000)
  return { ctx, path, runtime, store, setSdk(value: string) { sdk = value } }
}
async function settled(runtime: MobileRuntime) {
  let result = await runtime.status(signal)
  await vi.waitFor(async () => { result = await runtime.status(signal); expect(result.task?.state).not.toBe('running') })
  return result
}
it('publishes installed version after verified commit and rejects stale revision overwrite', async () => {
  const b = await bench()
  const before = await b.store.inspect(catalog['platform-tools'], signal)
  const request = { resourceId: 'platform-tools', operation: 'install', expectedRevision: before.revision, acceptLicense: true } as const
  b.runtime.start(request, signal)
  const installed = await settled(b.runtime)
  expect(installed.task?.state).toBe('succeeded')
  expect(installed.resources[0]).toMatchObject({ installedVersion: '37.0.1', integrity: 'verified' })
  expect(installed.adb.source).toBe('managed')
  b.runtime.start({ ...request, operation: 'reinstall' }, signal)
  expect((await settled(b.runtime)).task?.state).toBe('failed')
  expect(vi.mocked(downloadArchive)).toHaveBeenCalledTimes(1)
})
it('cancels a pending replacement without losing old generation and cleans both staging directories', async () => {
  const b = await bench()
  const oldStage = await b.store.stage(catalog['platform-tools'], signal)
  await writeFile(join(oldStage, 'adb.exe'), 'old valid binary')
  await b.store.commit(catalog['platform-tools'], oldStage, 'missing' as MobileResourceRevision, signal)
  const old = await b.store.inspect(catalog['platform-tools'], signal)
  vi.mocked(downloadArchive).mockImplementation(async (_definition, _file, _proxy, abort) => {
    await new Promise<void>((_resolve, reject) => { abort.addEventListener('abort', () => { reject(new Error('Controlled download cancelled')) }, { once: true }) })
  })
  const receipt = b.runtime.start({ resourceId: 'platform-tools', operation: 'reinstall', expectedRevision: old.revision, acceptLicense: true }, signal)
  await vi.waitFor(() => { expect(downloadArchive).toHaveBeenCalledOnce() })
  await expect(b.runtime.cancel('different' as MobileResourceTaskId)).rejects.toThrow('changed')
  expect((await b.runtime.cancel(receipt.id)).state).toBe('cancelled')
  expect((await b.store.inspect(catalog['platform-tools'], signal)).revision).toBe(old.revision)
  expect((await readdir(b.path)).some(name => name.startsWith('download-'))).toBe(false)
  expect((await readdir(join(b.path, 'platform-tools'))).some(name => name.startsWith('stage-'))).toBe(false)
})
it('preserves an installed resource after checksum transport failure', async () => {
  const b = await bench()
  const stage = await b.store.stage(catalog['platform-tools'], signal)
  await writeFile(join(stage, 'adb.exe'), 'old binary')
  await b.store.commit(catalog['platform-tools'], stage, 'missing' as MobileResourceRevision, signal)
  const before = await b.store.inspect(catalog['platform-tools'], signal)
  vi.mocked(downloadArchive).mockRejectedValue(new Error('private transport detail'))
  b.runtime.start({ resourceId: 'platform-tools', operation: 'reinstall', expectedRevision: before.revision, acceptLicense: true }, signal)
  const after = await settled(b.runtime)
  expect(after.task?.state).toBe('failed')
  expect(JSON.stringify(after.task)).not.toContain('private transport')
  expect(after.resources[0]?.revision).toBe(before.revision)
})
it('rejects removal while executable bytes are leased and preserves custom SDK selection', async () => {
  const b = await bench()
  const stage = await b.store.stage(catalog['platform-tools'], signal)
  await writeFile(join(stage, 'adb.exe'), 'old binary')
  await b.store.commit(catalog['platform-tools'], stage, 'missing' as MobileResourceRevision, signal)
  const before = await b.store.inspect(catalog['platform-tools'], signal)
  const lease = await b.runtime.acquireAdb({}, signal)
  try {
    b.runtime.start({ resourceId: 'platform-tools', operation: 'remove', expectedRevision: before.revision, acceptLicense: false }, signal)
    expect((await settled(b.runtime)).task?.state).toBe('failed')
    b.setSdk(resolve('user-sdk'))
    const custom = await b.runtime.acquireAdb({}, signal)
    expect(custom.executable).toBe(join(resolve('user-sdk'), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))
    await custom.release()
    const explicit = await b.runtime.acquireAdb({ command: 'explicit-adb' }, signal)
    expect(explicit.executable).toBe('explicit-adb'); await explicit.release()
  } finally { await lease.release() }
})
it('pins both mirror executables and releases them only after exact close joins the owned process', async () => {
  const b = await bench()
  const stage = await b.store.stage(catalog.scrcpy, signal)
  await writeFile(join(stage, 'scrcpy.exe'), 'helper'); await writeFile(join(stage, 'scrcpy-server'), 'server')
  await b.store.commit(catalog.scrcpy, stage, 'missing' as MobileResourceRevision, signal)
  b.setSdk(resolve('custom-sdk/adb.exe'))
  vi.mocked(probe).mockImplementation(async (_ctx, _config, _exe, args) => args[0] === 'devices'
    ? 'List of devices attached\nphone device transport_id:7\n' : '11111111-2222-4333-8444-555555555555')
  let finish: (() => void) | undefined
  const done = new Promise<{ exitCode: number; signal: null }>((resolveOutcome) => {
    finish = () => { resolveOutcome({ exitCode: 0, signal: null }) }
  })
  const waitForExit = vi.fn(async () => true)
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    spec.signal?.addEventListener('abort', () => { finish?.() }, { once: true })
    return { done, terminate: () => { finish?.() }, waitForExit }
  })
  b.ctx.provide('subprocess', { resolveExecutable: async (executable: string) => executable, spawn } as never)
  const receipt = b.runtime.startMirror('android:phone', signal)
  await vi.waitFor(() => { expect(spawn).toHaveBeenCalledOnce() })
  const launched = spawn.mock.calls[0]?.[0]
  expect(launched?.argv.slice(1)).toEqual(['--serial', 'phone', '--no-audio', '--no-control'])
  expect(launched?.env?.ADB).toBe(resolve('custom-sdk/adb.exe'))
  expect((await b.store.inspect(catalog.scrcpy, signal)).leased).toBe(true)
  expect(await b.runtime.closeMirror(receipt.id)).toMatchObject({ id: receipt.id, state: 'closed' })
  expect(waitForExit).toHaveBeenCalledOnce()
  expect((await b.store.inspect(catalog.scrcpy, signal)).leased).toBe(false)
})
it('rejects unaccepted licenses before download and does not spawn a mirror for absent devices', async () => {
  const b = await bench()
  expect(() => b.runtime.start({ resourceId: 'scrcpy', operation: 'install', expectedRevision: 'missing' as MobileResourceRevision, acceptLicense: false }, signal)).toThrow('license')
  expect(downloadArchive).not.toHaveBeenCalled()
  const mirror = b.runtime.startMirror('android:missing', signal)
  await expect(b.runtime.closeMirror(mirror.id)).resolves.toMatchObject({ id: mirror.id, state: 'closed' })
})
