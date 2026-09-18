import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import MobileDeviceRuntime from '@deepseek-ai/dsh-mobile-device'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeviceCapabilitiesController from '../src/index.ts'

interface Fixture {
  root: string
  ctx?: Context
}
const fixtures: Fixture[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.ctx?.fiber.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
}, 30_000)

async function boot(state: { exitCode?: number; output?: string; pending?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-process-'))
  const fixture: Fixture = { root }
  fixtures.push(fixture)
  const sdkPath = join(root, 'custom sdk')
  const bin = join(sdkPath, 'platform-tools')
  const executable = join(bin, process.platform === 'win32' ? 'adb.exe' : 'adb')
  const journal = join(root, 'calls.jsonl')
  const ready = join(root, 'ready')
  await mkdir(bin, { recursive: true, mode: 0o700 })
  try {
    await link(process.execPath, executable)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM') throw error
    await copyFile(process.execPath, executable)
  }
  await copyFile(new URL('./fixtures/sdk-version.mjs', import.meta.url), join(bin, 'version'))
  await writeFile(join(bin, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(bin, 'state.json'), JSON.stringify({ ...state, journal, ready }))
  await writeFile(journal, '')
  const settingsPath = join(root, 'settings.json')
  await writeFile(settingsPath, JSON.stringify({ 'mobile-device': { androidSdkPath: sdkPath, enabled: false } }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath, watch: false } },
    { name: '@deepseek-ai/dsh-mobile-device' },
    { name: '@deepseek-ai/dsh-subprocess-local' },
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-api-device-capabilities-controller', config: {
      probeTimeoutMs: 30_000, probeGraceMs: 100, maxProbeOutputBytes: 64,
    } },
  ]))
  const ctx = new Context()
  fixture.ctx = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-mobile-device', MobileDeviceRuntime],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-api-device-capabilities-controller', DeviceCapabilitiesController],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected SDK fixture plugin: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const lookup = ctx.subprocess.resolveExecutable.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'resolveExecutable').mockImplementation((command, env, abort) => (
    command === 'xcrun' ? Promise.reject(new Error('iOS SDK absent in Android fixture')) : lookup(command, env, abort)
  ))
  return { ctx, root, sdkPath, executable, journal, ready }
}

async function calls(path: string): Promise<{ executable: string; entry: string; cwd: string }[]> {
  const text = await readFile(path, 'utf8')
  return text.trim() === '' ? [] : text.trim().split('\n').map(line => JSON.parse(line) as {
    executable: string
    entry: string
    cwd: string
  })
}

const signal = () => new AbortController().signal

describe('SDK readiness through Loader and local subprocess', { timeout: 30_000 }, () => {
  it('executes the SDK path loaded from durable settings through a real managed child', async () => {
    const { ctx, sdkPath, executable, journal } = await boot()
    expect(ctx.mobileDevice.getPreferences().enabled).toBe(false)
    expect((await ctx.deviceCapabilitiesController.checkSdk(signal())).android).toMatchObject({ found: true, sdkPath })
    expect(await calls(journal)).toEqual([{
      executable, entry: join(sdkPath, 'platform-tools', 'version'), cwd: join(sdkPath, 'platform-tools'),
    }])
  })

  it.each([{ exitCode: 7 }, { output: '龙'.repeat(32) }])('rejects failed exit or oversized process output %j', async (state) => {
    const { ctx, journal } = await boot(state)
    expect((await ctx.deviceCapabilitiesController.checkSdk(signal())).android.found).toBe(false)
    expect(await calls(journal)).toHaveLength(1)
  })

  it.each(['missing', 'relative'] as const)('does not execute another SDK for a %s configured root', async (kind) => {
    const { ctx, root, journal } = await boot()
    await ctx.settings.update('mobile-device', { androidSdkPath: kind === 'missing' ? join(root, 'missing-sdk') : 'relative-sdk' })
    expect((await ctx.deviceCapabilitiesController.checkSdk(signal())).android.found).toBe(false)
    expect(await calls(journal)).toEqual([])
  })

  it('reports executable permission refusal without launching a child', async () => {
    const { ctx, journal } = await boot()
    const lookup = vi.spyOn(ctx.subprocess, 'resolveExecutable').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
    expect((await ctx.deviceCapabilitiesController.checkSdk(signal())).android.found).toBe(false)
    expect(lookup.mock.calls.filter(([command]) => command !== 'xcrun')).toHaveLength(1)
    expect(await calls(journal)).toEqual([])
  })

  it('cancels and joins a real pending SDK process before returning the caller reason', async () => {
    const { ctx, ready, journal } = await boot({ pending: true })
    const spawned = vi.spyOn(ctx.subprocess, 'spawn')
    const abort = new AbortController()
    const reason = new Error('SDK fixture caller cancelled')
    const rejected = expect(ctx.deviceCapabilitiesController.checkSdk(abort.signal)).rejects.toBe(reason)
    await vi.waitFor(async () => { expect(await readFile(ready, 'utf8')).toBe('ready') }, { timeout: 15_000 })
    abort.abort(reason)
    await rejected
    expect(await calls(journal)).toHaveLength(1)
    const result = spawned.mock.results[0]
    expect(result?.type).toBe('return')
    if (result?.type !== 'return') throw new Error('SDK fixture did not spawn a process')
    expect(await result.value.waitForExit()).toBe(true)
  })
})
