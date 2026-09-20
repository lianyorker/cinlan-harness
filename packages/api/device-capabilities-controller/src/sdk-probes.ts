/** Managed, bounded SDK checks for existing local platform tools; detection does not install SDKs. */
import { homedir, platform } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { AndroidSdkAvailability, Config, IosSimulatorAvailability, MobileSdkSnapshot } from './types.ts'

interface ProbeConfig {
  readonly timeoutMs: number
  readonly graceMs: number
  readonly maxOutputBytes: number
}

/** Loader configuration for the complete SDK-check deadline and process bounds. */
export const SdkProbeConfig: z<Config> = z.object({
  probeTimeoutMs: z.number().default(5_000),
  probeGraceMs: z.number().default(1_000),
  maxProbeOutputBytes: z.number().default(64 * 1024),
})

function resolveConfig(config: Config): ProbeConfig {
  const keys = new Set(['probeTimeoutMs', 'probeGraceMs', 'maxProbeOutputBytes'])
  for (const key of Object.keys(config)) {
    if (!keys.has(key)) throw new TypeError(`device-capabilities-controller: unsupported config key '${key}'`)
  }
  const resolved = {
    timeoutMs: config.probeTimeoutMs ?? 5_000,
    graceMs: config.probeGraceMs ?? 1_000,
    maxOutputBytes: config.maxProbeOutputBytes ?? 64 * 1024,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
      throw new TypeError(`device-capabilities-controller: ${key} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
    }
  }
  return resolved
}

function androidRoots(configured: string): readonly string[] {
  if (configured !== '') return [configured]
  const home = homedir()
  return [...new Set([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(home, 'Library', 'Android', 'sdk'),
    join(home, 'AppData', 'Local', 'Android', 'Sdk'),
    join(home, 'Android', 'Sdk'),
    join(home, '.android', 'sdk'),
  ].filter((value): value is string => value !== undefined && value !== ''))]
}

/** Own SDK request cancellation and every process range until it is empty. */
export class SdkProbes {
  private readonly config: ProbeConfig
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<MobileSdkSnapshot>>()

  /**
   * @param ctx - Host services; mobile preferences and subprocess execution are optional.
   * @param config - Deployment bounds for read-only probes.
   */
  constructor(private readonly ctx: Context, config: Config) {
    this.config = resolveConfig(config)
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('SDK readiness controller disposed'))
      await Promise.allSettled([...this.pending])
    }, 'device-capabilities: SDK probes')
  }

  /**
   * Probe configured SDK executables and retain ownership until process cleanup ends.
   * @param signal - Caller cancellation, propagated after owned processes settle.
   * @returns Existing SDK readiness fields with no process output or installation side effects.
   */
  check(signal: AbortSignal): Promise<MobileSdkSnapshot> {
    const task = this.perform(signal)
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }

  private async perform(caller: AbortSignal): Promise<MobileSdkSnapshot> {
    const upstream = AbortSignal.any([caller, this.lifetime.signal])
    upstream.throwIfAborted()
    const osPlatform = platform()
    const configured = this.ctx.get('mobileDevice')?.getPreferences().androidSdkPath ?? ''
    const subprocess = this.ctx.get('subprocess')
    const bound = deadline(upstream, this.config.timeoutMs, 'MOBILE_SDK_PROBE_TIMEOUT')
    try {
      const results = await Promise.allSettled([
        this.android(subprocess, configured, osPlatform, bound.signal),
        osPlatform === 'darwin' ? this.ios(subprocess, bound.signal) : Promise.resolve(null),
      ] as const)
      upstream.throwIfAborted()
      const [android, ios] = results
      if (android.status === 'rejected') throw android.reason
      if (ios.status === 'rejected') throw ios.reason
      return { platform: osPlatform, android: android.value, ios: ios.value }
    } finally {
      bound[Symbol.dispose]()
    }
  }

  private async android(
    subprocess: SubprocessRuntime | undefined,
    configured: string,
    osPlatform: string,
    signal: AbortSignal,
  ): Promise<AndroidSdkAvailability> {
    if (subprocess === undefined) return { found: false, sdkPath: null, message: 'Subprocess provider unavailable.' }
    const runtime = this.ctx.get('mobileRuntime')
    if (runtime) {
      const lease = await runtime.acquireAdb({ sdkPath: configured }, signal)
      try {
        const found = await this.execute(subprocess, lease.executable, ['version'], signal)
        return { found, sdkPath: found ? lease.executable : null, message: found ? 'Android ADB version check succeeded.' : 'Android ADB version check failed.' }
      } finally { await lease.release() }
    }
    for (const root of androidRoots(configured)) {
      if (signal.aborted) break
      if (!isAbsolute(root) || root.trim() !== root) continue
      const adb = osPlatform === 'win32' ? 'adb.exe' : 'adb'
      const leaf = basename(root).toLowerCase()
      const executable = leaf === adb ? root : leaf === 'platform-tools' ? join(root, adb) : join(root, 'platform-tools', adb)
      if (await this.execute(subprocess, executable, ['version'], signal)) {
        return { found: true, sdkPath: root, message: 'Android SDK adb version check succeeded.' }
      }
    }
    return {
      found: false, sdkPath: null,
      message: signal.aborted ? 'Android SDK check timed out.' : configured !== ''
        ? 'Configured Android SDK executable check failed.' : 'No usable Android SDK executable was found.',
    }
  }

  private async ios(subprocess: SubprocessRuntime | undefined, signal: AbortSignal): Promise<IosSimulatorAvailability> {
    if (subprocess === undefined) return { simctlOk: false, message: 'Subprocess provider unavailable.' }
    const simctlOk = await this.execute(subprocess, 'xcrun', ['simctl', 'help'], signal)
    return {
      simctlOk,
      message: simctlOk ? 'simctl help check succeeded.' : signal.aborted
        ? 'iOS Simulator check timed out.' : 'iOS Simulator executable check failed.',
    }
  }

  private async execute(
    subprocess: SubprocessRuntime,
    command: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<boolean> {
    let handle: SubprocessHandle | undefined
    let succeeded = false
    try {
      signal.throwIfAborted()
      const executable = await subprocess.resolveExecutable(command, {}, signal)
      signal.throwIfAborted()
      handle = subprocess.spawn({
        argv: [executable, ...args], cwd: dirname(executable),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.config.maxOutputBytes },
          stderr: { maxBytes: this.config.maxOutputBytes },
        },
        graceMs: this.config.graceMs, signal,
      })
      const outcome = await handle.done
      if (!signal.aborted && outcome.exitCode === 0 && outcome.signal === null) {
        const stdout = handle.collected.stdout?.readFrom(0)
        const stderr = handle.collected.stderr?.readFrom(0)
        succeeded = stdout?.lossy === false && stderr?.lossy === false
      }
    } catch (_lookupOrProcessFailure) {
      succeeded = false
    } finally {
      if (handle !== undefined) {
        handle.terminate()
        await handle.done.catch(() => undefined)
        await handle.waitForExit()
      }
    }
    return !signal.aborted && succeeded
  }
}
