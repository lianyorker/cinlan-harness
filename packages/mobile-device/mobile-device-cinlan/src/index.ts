/**
 * Cinlan IDE CLI Service Provider for local mobile-device control. Every
 * operation launches one public JSON CLI argv through `ctx.subprocess`,
 * validates the complete response, and keeps observation tokens one-use.
 * @module @deepseek-ai/dsh-mobile-device-cinlan
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  MobileDeviceError,
} from '@deepseek-ai/dsh-mobile-device'
import type {
  MobileButtonRequest,
  MobileDevice,
  MobileDeviceGeneration,
  MobileDeviceId,
  MobileDeviceProvider,
  MobileMutationRequest,
  MobileMutationResult,
  MobileObservation,
  MobileObservationId,
  MobileObserveRequest,
  MobileTouchRequest,
  MobileTypeRequest,
} from '@deepseek-ai/dsh-mobile-device'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
} from '@deepseek-ai/dsh-subprocess'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  parseAcknowledgement,
  parseCinlanMobileEnvelope,
  parseDevices,
  parseObservation,
} from './protocol.ts'
import type { CinlanMobileEnvelope } from './protocol.ts'

/** Cordis plugin name. */
export const name = 'mobile-device-cinlan'

/** Services required by the Cinlan Mobile Device Provider. */
export const inject = ['mobileDevice', 'subprocess']

/** Default Provider id registered on `ctx.mobileDevice`. */
export const CINLAN_MOBILE_DEVICE_PROVIDER_ID = 'cinlan'

const DEFAULT_COMMAND_TIMEOUT_MS = 65_000
const DEFAULT_GRACE_MS = 3_000
const DEFAULT_MAX_JSON_BYTES = 24 * 1024 * 1024
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024
const DEFAULT_MAX_TREE_BYTES = 1024 * 1024
const DEFAULT_MAX_IMAGE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_TEXT_BYTES = 256 * 1024
const DEFAULT_COMMAND = process.platform === 'linux' ? 'orca-ide' : 'orca'

/** Explicit environment tombstones that keep this Provider on the local runtime. */
export const CINLAN_MOBILE_LOCAL_ENV: NodeJS.ProcessEnv = Object.freeze({
  ORCA_PAIRING_CODE: undefined,
  ORCA_REMOTE_PAIRING: undefined,
  ORCA_ENVIRONMENT: undefined,
})

/** Cinlan CLI Provider configuration. */
export interface Config {
  /** Provider id registered on `ctx.mobileDevice`. Defaults to `cinlan`. */
  readonly providerId?: string
  /** Cinlan IDE CLI executable name or absolute path. Defaults to `orca-ide` on
   * Linux and `orca` elsewhere. */
  readonly command?: string
  /** Child-process working directory. Defaults to `process.cwd()`. */
  readonly cwd?: string
  /** Per-command deadline, including executable resolution. Defaults to 65000 ms. */
  readonly commandTimeoutMs?: number
  /** Subprocess TERM-to-KILL grace. Defaults to 3000 ms. */
  readonly graceMs?: number
  /** Complete stdout JSON byte cap. Defaults to 24 MiB. */
  readonly maxJsonBytes?: number
  /** Captured stderr byte cap. Defaults to 64 KiB. */
  readonly maxStderrBytes?: number
  /** Observation tree UTF-8 byte cap. Defaults to 1 MiB. */
  readonly maxTreeBytes?: number
  /** Decoded screenshot byte cap. Defaults to 16 MiB. */
  readonly maxImageBytes?: number
  /** Typed-text UTF-8 byte cap. Defaults to 256 KiB. */
  readonly maxTextBytes?: number
}

/** Fully validated Provider configuration. */
export interface ResolvedConfig {
  readonly providerId: string
  readonly command: string
  readonly cwd: string
  readonly commandTimeoutMs: number
  readonly graceMs: number
  readonly maxJsonBytes: number
  readonly maxStderrBytes: number
  readonly maxTreeBytes: number
  readonly maxImageBytes: number
  readonly maxTextBytes: number
}

const CONFIG_KEYS = new Set([
  'providerId', 'command', 'cwd', 'commandTimeoutMs', 'graceMs', 'maxJsonBytes',
  'maxStderrBytes', 'maxTreeBytes', 'maxImageBytes', 'maxTextBytes',
])

/** Loader schema for Cinlan Mobile Device Provider configuration. */
export const Config: z<Config> = z.object({
  providerId: z.string().default(CINLAN_MOBILE_DEVICE_PROVIDER_ID),
  command: z.string(),
  cwd: z.string(),
  commandTimeoutMs: z.number().default(DEFAULT_COMMAND_TIMEOUT_MS),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
  maxJsonBytes: z.number().default(DEFAULT_MAX_JSON_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_MAX_STDERR_BYTES),
  maxTreeBytes: z.number().default(DEFAULT_MAX_TREE_BYTES),
  maxImageBytes: z.number().default(DEFAULT_MAX_IMAGE_BYTES),
  maxTextBytes: z.number().default(DEFAULT_MAX_TEXT_BYTES),
})

function cleanString(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`mobile-device-cinlan: ${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function positiveSafeInteger(name: string, value: number, max?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new Error(
      `mobile-device-cinlan: ${name} must be a positive safe integer`
      + (max === undefined ? '' : ` no greater than ${max}`),
    )
  }
  return value
}

/**
 * Validate and default Provider configuration before executable resolution.
 * @param config User-supplied Cinlan Mobile Device Provider configuration.
 * @returns Fully validated configuration with every default resolved.
 */
export function resolveCinlanMobileDeviceConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`mobile-device-cinlan: unsupported config key '${key}'`)
  }
  return {
    providerId: cleanString('providerId', config.providerId ?? CINLAN_MOBILE_DEVICE_PROVIDER_ID),
    command: cleanString('command', config.command ?? DEFAULT_COMMAND),
    cwd: cleanString('cwd', config.cwd ?? process.cwd()),
    commandTimeoutMs: positiveSafeInteger(
      'commandTimeoutMs', config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, MAX_TIMER_DELAY_MS,
    ),
    graceMs: positiveSafeInteger('graceMs', config.graceMs ?? DEFAULT_GRACE_MS, MAX_TIMER_DELAY_MS),
    maxJsonBytes: positiveSafeInteger('maxJsonBytes', config.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES),
    maxStderrBytes: positiveSafeInteger('maxStderrBytes', config.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES),
    maxTreeBytes: positiveSafeInteger('maxTreeBytes', config.maxTreeBytes ?? DEFAULT_MAX_TREE_BYTES),
    maxImageBytes: positiveSafeInteger('maxImageBytes', config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES),
    maxTextBytes: positiveSafeInteger('maxTextBytes', config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES),
  }
}

interface CurrentObservation {
  readonly device: MobileDevice
  readonly deviceGeneration: MobileDeviceGeneration
  readonly observationId: MobileObservationId
  readonly runtimeId: string
}

interface InvokeOptions {
  readonly stableRuntime?: boolean
  readonly stdinData?: string
}

function providerCode(code: string): string {
  const suffix = code.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `MOBILE_CINLAN_${suffix.length === 0 ? 'ERROR' : suffix}`
}

/** Cinlan CLI Provider with runtime-generation and one-use observation checks. */
export class CinlanMobileDeviceProvider implements MobileDeviceProvider {
  readonly id: string

  private runtimeId: string | undefined
  private readonly observations = new Map<MobileDeviceId, CurrentObservation>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly lifecycle = new AbortController()
  private disposed = false
  private disposal: Promise<void> | undefined

  private executable: string | undefined

  /** Create one Provider bound to a resolved local Cinlan executable. */
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {
    this.id = config.providerId
  }

  private async resolveExecutable(signal: AbortSignal | undefined): Promise<string> {
    const lookup = deadline(this.combinedSignal(signal), this.config.commandTimeoutMs, 'MOBILE_CLI_TIMEOUT')
    try {
      if (lookup.signal.aborted) this.throwAbort(lookup.signal, signal)
      if (this.executable !== undefined) return this.executable
      const executable = await this.ctx.subprocess.resolveExecutable(this.config.command, {}, lookup.signal)
      lookup.signal.throwIfAborted()
      this.executable = executable
      return executable
    } catch (error) {
      if (lookup.signal.aborted) this.throwAbort(lookup.signal, signal)
      throw new MobileDeviceError(
        `mobile-device-cinlan could not resolve executable '${this.config.command}'`,
        'MOBILE_CLI_UNAVAILABLE',
        { cause: error },
      )
    } finally {
      lookup[Symbol.dispose]()
    }
  }

  /** Return whether the Provider still accepts operations. */
  available(): boolean {
    return !this.disposed
  }

  private assertActive(): void {
    if (this.disposed) throw new MobileDeviceError('mobile-device-cinlan Provider is disposed', 'MOBILE_PROVIDER_DISPOSED')
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive()
    const promise = operation()
    this.inFlight.add(promise)
    void promise.finally(() => { this.inFlight.delete(promise) }).catch(() => {})
    return promise
  }

  private combinedSignal(signal: AbortSignal | undefined): AbortSignal {
    return signal === undefined ? this.lifecycle.signal : AbortSignal.any([signal, this.lifecycle.signal])
  }

  private throwAbort(bounded: AbortSignal, caller: AbortSignal | undefined): never {
    const timeout = timeoutOf(bounded, 'MOBILE_CLI_TIMEOUT')
    if (timeout !== undefined) {
      throw new MobileDeviceError(
        `mobile-device-cinlan command timed out after ${this.config.commandTimeoutMs}ms`,
        'MOBILE_CLI_TIMEOUT',
        { cause: timeout },
      )
    }
    if (bounded.reason === this.lifecycle.signal.reason && this.lifecycle.signal.aborted) {
      throw new MobileDeviceError('mobile-device-cinlan Provider was disposed', 'MOBILE_PROVIDER_DISPOSED')
    }
    /* v8 ignore else -- every non-timeout, non-lifecycle deadline source is the caller signal. */
    if (caller !== undefined && bounded.reason === caller.reason && caller.aborted) caller.throwIfAborted()
    /* v8 ignore next -- deadline sources are exhausted above. */
    throw new MobileDeviceError('mobile-device-cinlan command was aborted', 'MOBILE_ABORTED')
  }

  private async execute(
    args: readonly string[],
    signal: AbortSignal | undefined,
    options: InvokeOptions,
  ): Promise<{ readonly envelope: CinlanMobileEnvelope; readonly outcome: SubprocessOutcome }> {
    const executable = await this.resolveExecutable(signal)
    const bound = deadline(this.combinedSignal(signal), this.config.commandTimeoutMs, 'MOBILE_CLI_TIMEOUT')
    try {
      let handle: SubprocessHandle
      let outcome: SubprocessOutcome
      try {
        handle = this.ctx.subprocess.spawn({
          argv: [executable, ...args, '--json'],
          cwd: this.config.cwd,
          stdio: {
            stdin: options.stdinData === undefined ? 'ignore' : { data: options.stdinData },
            stdout: { maxBytes: this.config.maxJsonBytes },
            stderr: { maxBytes: this.config.maxStderrBytes },
          },
          graceMs: this.config.graceMs,
          signal: bound.signal,
          env: CINLAN_MOBILE_LOCAL_ENV,
        })
        outcome = await handle.done
      } catch (error) {
        if (bound.signal.aborted) this.throwAbort(bound.signal, signal)
        throw new MobileDeviceError('mobile-device-cinlan failed to launch the Cinlan CLI', 'MOBILE_CLI_FAILED', { cause: error })
      }
      if (bound.signal.aborted) this.throwAbort(bound.signal, signal)
      const stdout = (handle.collected.stdout as SubprocessOutputReader).readFrom(0)
      if (stdout.lossy) {
        throw new MobileDeviceError(
          `mobile-device-cinlan stdout exceeds the configured ${this.config.maxJsonBytes}-byte limit`,
          'MOBILE_CLI_RESPONSE_TOO_LARGE',
        )
      }
      const envelope = parseCinlanMobileEnvelope(stdout.text)
      const cleanExit = outcome.exitCode === 0 && outcome.signal === null
      if (envelope.ok !== cleanExit) {
        throw new MobileDeviceError(
          'mobile-device-cinlan process status does not match its JSON envelope',
          'MOBILE_CINLAN_PROTOCOL',
        )
      }
      return { envelope, outcome }
    } finally {
      bound[Symbol.dispose]()
    }
  }

  private observeRuntime(runtimeId: string): boolean {
    const prior = this.runtimeId
    this.runtimeId = runtimeId
    if (prior === undefined || prior === runtimeId) return false
    this.observations.clear()
    return true
  }

  private mapFailure(error: { readonly code: string; readonly message: string; readonly nextSteps: readonly string[] }): MobileDeviceError {
    const message = error.nextSteps.length === 0
      ? error.message
      : `${error.message}\n${error.nextSteps.map(step => `Next step: ${step}`).join('\n')}`
    const direct: Readonly<Record<string, string>> = {
      device_not_found: 'MOBILE_DEVICE_NOT_FOUND',
      emulator_device_not_found: 'MOBILE_DEVICE_NOT_FOUND',
      device_unavailable: 'MOBILE_DEVICE_UNAVAILABLE',
      emulator_disabled: 'MOBILE_DEVICE_UNAVAILABLE',
      emulator_no_active: 'MOBILE_DEVICE_UNAVAILABLE',
      observation_stale: 'MOBILE_OBSERVATION_STALE',
      emulator_observation_stale: 'MOBILE_OBSERVATION_STALE',
      unsupported_capability: 'MOBILE_OPERATION_UNSUPPORTED',
      emulator_unsupported: 'MOBILE_OPERATION_UNSUPPORTED',
      runtime_unavailable: 'MOBILE_RUNTIME_UNAVAILABLE',
    }
    return new MobileDeviceError(message, direct[error.code] ?? providerCode(error.code))
  }

  private async invoke<T>(
    args: readonly string[],
    parse: (value: unknown) => T,
    signal: AbortSignal | undefined,
    options: InvokeOptions = {},
  ): Promise<{ readonly value: T; readonly runtimeId: string }> {
    const execution = await this.execute(args, signal, options)
    const changed = this.observeRuntime(execution.envelope.runtimeId)
    if (changed && options.stableRuntime === true) {
      throw new MobileDeviceError('Cinlan runtime changed; observe the device again', 'MOBILE_RUNTIME_STALE')
    }
    if (!execution.envelope.ok) throw this.mapFailure(execution.envelope.error)
    return { value: parse(execution.envelope.result), runtimeId: execution.envelope.runtimeId }
  }

  private assertDevice(device: MobileDevice, requested: MobileDeviceId): void {
    if (device.id !== requested) {
      throw new MobileDeviceError(
        `mobile-device-cinlan returned device '${device.id}' for '${requested}'`,
        'MOBILE_CINLAN_PROTOCOL',
      )
    }
  }

  private publishObservation(value: MobileObservation, request: MobileObserveRequest, runtimeId: string): MobileObservation {
    this.assertDevice(value.device, request.deviceId)
    this.observations.set(value.device.id, {
      device: value.device,
      deviceGeneration: value.deviceGeneration,
      observationId: value.observationId,
      runtimeId,
    })
    return value
  }

  private async takeObservation(request: MobileMutationRequest, signal: AbortSignal | undefined): Promise<CurrentObservation> {
    const observation = this.observations.get(request.deviceId)
    if (observation === undefined
      || observation.observationId !== request.observationId
      || observation.runtimeId !== this.runtimeId) {
      throw new MobileDeviceError(
        `mobile observation '${request.observationId}' is stale; observe '${request.deviceId}' again`,
        'MOBILE_OBSERVATION_STALE',
      )
    }
    this.observations.delete(request.deviceId)
    await this.invoke(['emulator', 'devices'], parseDevices, signal, { stableRuntime: true })
    return observation
  }

  private async mutate(
    request: MobileMutationRequest,
    args: readonly string[],
    signal: AbortSignal | undefined,
    stdinData?: string,
  ): Promise<MobileMutationResult> {
    const observation = await this.takeObservation(request, signal)
    await this.invoke(
      [...args, '--device', request.deviceId, '--observation-id', request.observationId],
      parseAcknowledgement,
      signal,
      { stableRuntime: true, ...(stdinData === undefined ? {} : { stdinData }) },
    )
    return {
      device: observation.device,
      deviceGeneration: observation.deviceGeneration,
      observationId: observation.observationId,
    }
  }

  /** List canonical devices from every Cinlan emulator backend. */
  listDevices(signal?: AbortSignal): Promise<readonly MobileDevice[]> {
    return this.track(async () => {
      const { value } = await this.invoke(['emulator', 'devices'], parseDevices, signal)
      return value
    })
  }

  /** Capture one fresh tree and optional PNG for an exact device. */
  observe(request: MobileObserveRequest, signal?: AbortSignal): Promise<MobileObservation> {
    return this.track(async () => {
      const { value, runtimeId } = await this.invoke(
        [
          'emulator', 'observe', '--device', request.deviceId,
          ...(request.captureScreenshot === true ? [] : ['--no-screenshot']),
        ],
        result => parseObservation(result, this.config.maxTreeBytes, this.config.maxImageBytes),
        signal,
      )
      return this.publishObservation(value, request, runtimeId)
    })
  }

  /** Perform one normalized tap or swipe. */
  touch(request: MobileTouchRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.track(() => this.mutate(
      request,
      request.kind === 'tap'
        ? ['emulator', 'tap', String(request.x), String(request.y)]
        : ['emulator', 'gesture', JSON.stringify([
          { type: 'begin', x: request.fromX, y: request.fromY },
          { type: 'end', x: request.toX, y: request.toY },
        ])],
      signal,
    ))
  }

  /** Type literal text through subprocess stdin, never argv. */
  typeText(request: MobileTypeRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.track(() => {
      if (Buffer.byteLength(request.text, 'utf8') > this.config.maxTextBytes) {
        throw new MobileDeviceError(
          `mobile typed text exceeds the configured ${this.config.maxTextBytes}-byte limit`,
          'MOBILE_TEXT_TOO_LARGE',
        )
      }
      return this.mutate(request, ['emulator', 'type', '--text-stdin'], signal, request.text)
    })
  }

  /** Press one provider-supported device button. */
  pressButton(request: MobileButtonRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.track(() => this.mutate(request, ['emulator', 'button', request.button], signal))
  }

  /** Stop accepting calls and join every in-flight CLI process. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.lifecycle.abort(new MobileDeviceError('mobile-device-cinlan Provider disposed', 'MOBILE_PROVIDER_DISPOSED'))
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => {
      this.observations.clear()
    })
    return this.disposal
  }
}

/** Register the Provider immediately. Executable resolution and device
 * inventory probing are deferred to the first operation call (lazy
 * connection), so a missing or unready Cinlan IDE CLI never blocks the plugin tree. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveCinlanMobileDeviceConfig(config)
  const provider = new CinlanMobileDeviceProvider(ctx, resolved)
  ctx.effect(function* () {
    const unregister = ctx.mobileDevice.registerProvider(provider)
    yield async () => {
      unregister()
      await provider.dispose()
    }
  }, 'mobile-device-cinlan.lifecycle')
}
