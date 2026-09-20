import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SubprocessRuntime, { type SubprocessHandle, type SubprocessOutcome, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeviceCapabilitiesController from '../src/index.ts'
import type { Config } from '../src/types.ts'

const host = vi.hoisted(() => ({ platform: 'linux' }))
vi.mock('node:os', () => ({ platform: () => host.platform, homedir: () => '/fixture/home' }))

const roots: Context[] = []
beforeEach(() => { host.platform = 'linux' })
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
})

function handle(done = Promise.resolve<SubprocessOutcome>({ exitCode: 0, signal: null })) {
  const output = { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }
  return {
    stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
    collected: { stdout: output, stderr: output }, done,
    terminate: vi.fn(), waitForExit: vi.fn(async () => true),
  } satisfies SubprocessHandle
}

class FixtureSubprocess extends SubprocessRuntime {
  resolveExecutable = vi.fn(async (command: string, _env?: Readonly<Record<string, string>>, _signal?: AbortSignal) => (
    command === 'xcrun' ? resolve('fixture-bin/xcrun') : command
  ))

  spawn = vi.fn((_spec: SubprocessSpawnSpec) => handle())

  async terminalEnvironment(): Promise<never> {
    throw new Error('SDK probes do not use terminal subprocesses')
  }

  async spawnTerminal(): Promise<never> {
    throw new Error('SDK probes do not use terminal subprocesses')
  }
}

function bench(config: Config = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const preferences = { enabled: false, defaultDeviceId: '', androidSdkPath: resolve('fixture-sdk') }
  const subprocess = new FixtureSubprocess(ctx)
  ctx.provide('mobileDevice', { getPreferences: () => preferences } as never)
  return { ctx, preferences, subprocess, controller: new DeviceCapabilitiesController(ctx, config) }
}

const signal = () => new AbortController().signal

describe('SDK process readiness', () => {
  it.each(['platform-tools', 'adb'])('probes a configured %s selection without appending another platform-tools directory', async (kind) => {
    const { controller, subprocess, preferences } = bench()
    preferences.androidSdkPath = kind === 'adb' ? resolve('custom-platform-tools/adb') : resolve('custom-sdk/platform-tools')
    const executable = kind === 'adb' ? preferences.androidSdkPath : join(preferences.androidSdkPath, 'adb')
    expect((await controller.checkSdk(signal())).android.found).toBe(true)
    expect(subprocess.resolveExecutable).toHaveBeenCalledWith(executable, {}, expect.any(AbortSignal))
  })

  it('does not report simctl ready when its command exits unsuccessfully', async () => {
    host.platform = 'darwin'
    const { controller, subprocess } = bench()
    subprocess.spawn.mockImplementation(() => handle(Promise.resolve({ exitCode: 1, signal: null })))
    const result = await controller.checkSdk(signal())
    expect(result.ios?.simctlOk).toBe(false)
    expect(subprocess.spawn.mock.calls.map(([spec]) => spec.argv)).toContainEqual([
      resolve('fixture-bin/xcrun'), 'simctl', 'help',
    ])
  })

  it.each(['linux', 'win32'])('executes the current configured SDK path on %s without enabling automatic checks', async (osPlatform) => {
    host.platform = osPlatform
    const { controller, subprocess, preferences } = bench({ maxProbeOutputBytes: 9, probeGraceMs: 17 })
    const result = await controller.checkSdk(signal())
    const executable = join(preferences.androidSdkPath, 'platform-tools', osPlatform === 'win32' ? 'adb.exe' : 'adb')
    expect(result).toMatchObject({ android: { found: true, sdkPath: preferences.androidSdkPath }, ios: null })
    expect(subprocess.resolveExecutable).toHaveBeenCalledWith(executable, {}, expect.any(AbortSignal))
    expect(subprocess.spawn).toHaveBeenCalledWith(expect.objectContaining({
      argv: [executable, 'version'], cwd: join(preferences.androidSdkPath, 'platform-tools'),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 9 }, stderr: { maxBytes: 9 } }, graceMs: 17,
    }))
    preferences.androidSdkPath = resolve('second-sdk')
    await controller.checkSdk(signal())
    expect(subprocess.spawn.mock.calls[1]?.[0].argv[0]).toBe(join(preferences.androidSdkPath, 'platform-tools', osPlatform === 'win32' ? 'adb.exe' : 'adb'))
  })

  it.each(['ENOENT', 'EACCES', 'ENOEXEC'])('does not fall back after a configured executable fails with %s', async (code) => {
    const { controller, subprocess } = bench()
    subprocess.resolveExecutable.mockRejectedValue(Object.assign(new Error('private path detail'), { code }))
    const result = await controller.checkSdk(signal())
    expect(result.android.found).toBe(false)
    expect(result.android.message).not.toContain('private path detail')
    expect(subprocess.resolveExecutable).toHaveBeenCalledTimes(1)
    expect(subprocess.spawn).not.toHaveBeenCalled()
  })

  it.each(['relative-sdk', ' /invalid-sdk '])('rejects configured path %s before launching a command', async (path) => {
    const { controller, subprocess, preferences } = bench()
    preferences.androidSdkPath = path
    expect((await controller.checkSdk(signal())).android.found).toBe(false)
    expect(subprocess.resolveExecutable).not.toHaveBeenCalled()
    expect(subprocess.spawn).not.toHaveBeenCalled()
  })

  it('uses ambient discovery only when the configured path is empty', async () => {
    const { controller, preferences, subprocess } = bench()
    const sdkPath = resolve('ambient-sdk')
    vi.stubEnv('ANDROID_HOME', sdkPath)
    preferences.androidSdkPath = ''
    expect((await controller.checkSdk(signal())).android).toMatchObject({ found: true, sdkPath })
    expect(subprocess.resolveExecutable.mock.calls[0]?.[0]).toBe(join(sdkPath, 'platform-tools', 'adb'))
  })

  it.each(['throw', 'reject', 'exit', 'signal', 'stdout-limit', 'stderr-limit'] as const)('reports %s failure without publishing process output', async (failure) => {
    const { controller, subprocess } = bench()
    subprocess.spawn.mockImplementation(() => {
      if (failure === 'throw') throw new Error('private spawn failure')
      const result = handle(failure === 'reject' ? Promise.reject(new Error('async ENOENT')) : Promise.resolve({
        exitCode: failure === 'exit' ? 7 : failure === 'signal' ? null : 0,
        signal: failure === 'signal' ? 'SIGTERM' : null,
      }))
      if (failure === 'stdout-limit' || failure === 'stderr-limit') {
        const stream = failure === 'stdout-limit' ? result.collected.stdout : result.collected.stderr
        vi.spyOn(stream, 'readFrom').mockReturnValue({ text: 'private oversized text', nextOffset: 900, lossy: true })
      }
      return result
    })
    expect((await controller.checkSdk(signal())).android).toMatchObject({ found: false, sdkPath: null })
  })

  it('waits for command outcome and managed-range cleanup before reporting readiness', async () => {
    const { controller, subprocess } = bench()
    const outcome = Promise.withResolvers<SubprocessOutcome>()
    const cleanup = Promise.withResolvers<boolean>()
    const cleaning = Promise.withResolvers<undefined>()
    const child = handle(outcome.promise)
    vi.mocked(child.waitForExit).mockImplementation(() => { cleaning.resolve(undefined); return cleanup.promise })
    subprocess.spawn.mockReturnValue(child)
    let settled = false
    const result = controller.checkSdk(signal()).then((value) => { settled = true; return value })
    expect(settled).toBe(false)
    outcome.resolve({ exitCode: 0, signal: null })
    await cleaning.promise
    expect(settled).toBe(false)
    expect(child.terminate).toHaveBeenCalledOnce()
    cleanup.resolve(true)
    expect((await result).android.found).toBe(true)
  })

  it('propagates caller cancellation during executable lookup', async () => {
    const { controller, subprocess } = bench()
    const entered = Promise.withResolvers<undefined>()
    subprocess.resolveExecutable.mockImplementation((_command, _env, abort) => new Promise((_resolve, reject) => {
      abort!.addEventListener('abort', () => {
        const reason: unknown = abort!.reason
        reject(reason instanceof Error ? reason : new Error('SDK fixture lookup aborted'))
      }, { once: true })
      entered.resolve(undefined)
    }))
    const abort = new AbortController()
    const reason = new Error('caller cancelled SDK lookup')
    const rejected = expect(controller.checkSdk(abort.signal)).rejects.toBe(reason)
    await entered.promise
    abort.abort(reason)
    await rejected
    expect(subprocess.spawn).not.toHaveBeenCalled()
  })

  it('preserves cancellation while successful command cleanup is still pending', async () => {
    const { controller, subprocess } = bench()
    const cleanup = Promise.withResolvers<boolean>()
    const cleaning = Promise.withResolvers<undefined>()
    const child = handle()
    vi.mocked(child.waitForExit).mockImplementation(() => { cleaning.resolve(undefined); return cleanup.promise })
    subprocess.spawn.mockReturnValue(child)
    const abort = new AbortController()
    const reason = new Error('caller cancelled SDK cleanup')
    const rejected = expect(controller.checkSdk(abort.signal)).rejects.toBe(reason)
    await cleaning.promise
    abort.abort(reason)
    cleanup.resolve(true)
    await rejected
  })

  it('reports deadline expiry even when the terminated command exits zero', async () => {
    vi.useFakeTimers()
    const { controller, subprocess } = bench({ probeTimeoutMs: 20 })
    const entered = Promise.withResolvers<undefined>()
    subprocess.spawn.mockImplementation((spec) => {
      const done = new Promise<SubprocessOutcome>((resolveDone) => {
        spec.signal!.addEventListener('abort', () => { resolveDone({ exitCode: 0, signal: null }) }, { once: true })
      })
      entered.resolve(undefined)
      return handle(done)
    })
    const result = controller.checkSdk(signal())
    await entered.promise
    await vi.advanceTimersByTimeAsync(20)
    expect((await result).android).toMatchObject({ found: false, message: 'Android SDK check timed out.' })
  })

  it('drains an active command during controller disposal and refuses later checks', async () => {
    const { ctx, controller, subprocess } = bench()
    const entered = Promise.withResolvers<undefined>()
    const cleanup = Promise.withResolvers<boolean>()
    const cleaning = Promise.withResolvers<undefined>()
    subprocess.spawn.mockImplementation((spec) => {
      const child = handle(new Promise<SubprocessOutcome>((resolveDone) => {
        spec.signal!.addEventListener('abort', () => { resolveDone({ exitCode: 0, signal: null }) }, { once: true })
      }))
      vi.mocked(child.waitForExit).mockImplementation(() => { cleaning.resolve(undefined); return cleanup.promise })
      entered.resolve(undefined)
      return child
    })
    const rejected = expect(controller.checkSdk(signal())).rejects.toThrow('disposed')
    await entered.promise
    let disposed = false
    const disposing = ctx.fiber.dispose().then(() => { disposed = true })
    await cleaning.promise
    expect(disposed).toBe(false)
    cleanup.resolve(true)
    await Promise.all([disposing, rejected])
    await expect(controller.checkSdk(signal())).rejects.toThrow('disposed')
    expect(subprocess.spawn).toHaveBeenCalledOnce()
  })

  it('reports unavailable when no subprocess provider is mounted', async () => {
    host.platform = 'darwin'
    const ctx = new Context()
    roots.push(ctx)
    const controller = new DeviceCapabilitiesController(ctx)
    expect(await controller.checkSdk(signal())).toMatchObject({ android: { found: false }, ios: { simctlOk: false } })
  })

  it.each([
    { probeTimeoutMs: 0 }, { probeGraceMs: Infinity }, { maxProbeOutputBytes: 1.5 },
  ])('rejects invalid deployment bounds %j', (config) => {
    expect(() => bench(config)).toThrow('positive integer')
  })
})
