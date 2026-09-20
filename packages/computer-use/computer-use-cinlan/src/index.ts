/**
 * Cinlan IDE CLI Service Provider for local desktop Computer Use. Every
 * operation launches one public JSON CLI argv through `ctx.subprocess`, uses
 * one provider-instance session namespace, and validates the complete response
 * before publishing state.
 * @module @deepseek-ai/dsh-computer-use-cinlan
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ComputerObservationId,
  ComputerUseError,
} from '@deepseek-ai/dsh-computer-use'
import type {
  ComputerActionRequest,
  ComputerActionResult,
  ComputerApp,
  ComputerAppId,
  ComputerCapabilities,
  ComputerClickRequest,
  ComputerDragRequest,
  ComputerElementId,
  ComputerHotkeyRequest,
  ComputerListWindowsRequest,
  ComputerObservation,
  ComputerObserveRequest,
  ComputerPasteTextRequest,
  ComputerPressKeyRequest,
  ComputerScrollRequest,
  ComputerSecondaryActionRequest,
  ComputerSetValueRequest,
  ComputerTypeTextRequest,
  ComputerUseProvider,
  ComputerWindow,
  ComputerWindowId,
} from '@deepseek-ai/dsh-computer-use'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
} from '@deepseek-ai/dsh-subprocess'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  parseAction,
  parseCapabilities,
  parseCinlanComputerEnvelope,
  parseListApps,
  parseListWindows,
  parseObservation,
} from './protocol.ts'
import type {
  CinlanComputerEnvelope,
  ParsedActionResult,
  ParsedObservationResult,
} from './protocol.ts'
import { loadComputerScreenshot } from './screenshot.ts'

/** Cordis plugin name. */
export const name = 'computer-use-cinlan'

/** Services required by the Cinlan Computer Use provider. */
export const inject = ['computerUse', 'subprocess']

/** Default provider id registered on `ctx.computerUse`. */
export const CINLAN_COMPUTER_USE_PROVIDER_ID = 'cinlan'

const DEFAULT_COMMAND_TIMEOUT_MS = 65_000
const DEFAULT_GRACE_MS = 3_000
const DEFAULT_MAX_JSON_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024
const DEFAULT_MAX_IMAGE_BYTES = 16 * 1024 * 1024
const DEFAULT_COMMAND = process.platform === 'linux' ? 'orca-ide' : 'orca'

/** Explicit environment tombstones that keep this provider on the local runtime. */
export const CINLAN_COMPUTER_LOCAL_ENV: NodeJS.ProcessEnv = Object.freeze({
  ORCA_PAIRING_CODE: undefined,
  ORCA_REMOTE_PAIRING: undefined,
  ORCA_ENVIRONMENT: undefined,
})

/** Cinlan CLI provider configuration. */
export interface Config {
  /** Provider id registered on `ctx.computerUse`. Defaults to `cinlan`. */
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
  /** Complete stdout JSON byte cap. Defaults to 16 MiB. */
  readonly maxJsonBytes?: number
  /** Captured stderr byte cap. Defaults to 64 KiB. */
  readonly maxStderrBytes?: number
  /** Screenshot byte cap before attachment persistence. Defaults to 16 MiB. */
  readonly maxImageBytes?: number
}

/** Fully validated provider configuration. */
export interface ResolvedConfig {
  readonly providerId: string
  readonly command: string
  readonly cwd: string
  readonly commandTimeoutMs: number
  readonly graceMs: number
  readonly maxJsonBytes: number
  readonly maxStderrBytes: number
  readonly maxImageBytes: number
}

const CONFIG_KEYS = new Set([
  'providerId',
  'command',
  'cwd',
  'commandTimeoutMs',
  'graceMs',
  'maxJsonBytes',
  'maxStderrBytes',
  'maxImageBytes',
])

/** Loader schema for Cinlan Computer Use provider configuration. */
export const Config: z<Config> = z.object({
  providerId: z.string().default(CINLAN_COMPUTER_USE_PROVIDER_ID),
  command: z.string(),
  cwd: z.string(),
  commandTimeoutMs: z.number().default(DEFAULT_COMMAND_TIMEOUT_MS),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
  maxJsonBytes: z.number().default(DEFAULT_MAX_JSON_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_MAX_STDERR_BYTES),
  maxImageBytes: z.number().default(DEFAULT_MAX_IMAGE_BYTES),
})

function cleanString(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`computer-use-cinlan: ${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function positiveSafeInteger(name: string, value: number, max?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new Error(
      `computer-use-cinlan: ${name} must be a positive safe integer`
      + (max === undefined ? '' : ` no greater than ${max}`),
    )
  }
  return value
}

/**
 * Validate and default provider configuration before executable resolution.
 * @param config - User-supplied Cinlan Computer Use provider configuration.
 * @returns Fully validated configuration with every default resolved.
 */
export function resolveCinlanComputerUseConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`computer-use-cinlan: unsupported config key '${key}'`)
  }
  return {
    providerId: cleanString('providerId', config.providerId ?? CINLAN_COMPUTER_USE_PROVIDER_ID),
    command: cleanString('command', config.command ?? DEFAULT_COMMAND),
    cwd: cleanString('cwd', config.cwd ?? process.cwd()),
    commandTimeoutMs: positiveSafeInteger(
      'commandTimeoutMs',
      config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      MAX_TIMER_DELAY_MS,
    ),
    graceMs: positiveSafeInteger('graceMs', config.graceMs ?? DEFAULT_GRACE_MS, MAX_TIMER_DELAY_MS),
    maxJsonBytes: positiveSafeInteger('maxJsonBytes', config.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES),
    maxStderrBytes: positiveSafeInteger('maxStderrBytes', config.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES),
    maxImageBytes: positiveSafeInteger('maxImageBytes', config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES),
  }
}

interface CurrentObservation {
  readonly id: ReturnType<typeof ComputerObservationId>
  readonly runtimeId: string
  readonly appId: ComputerAppId
  readonly windowId: ComputerWindowId
  readonly elements: ReadonlyMap<ComputerElementId, number>
}

interface InvokeOptions {
  readonly sessionScoped?: boolean
  readonly stableRuntime?: boolean
  readonly stdinData?: string
}

function providerCode(code: string): string {
  const suffix = code.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `COMPUTER_CINLAN_${suffix.length === 0 ? 'ERROR' : suffix}`
}

function targetKey(appId: ComputerAppId, windowId: ComputerWindowId): string {
  return `${appId}\u0000${windowId}`
}

function windowArgs(windowId: ComputerWindowId | undefined): string[] {
  if (windowId === undefined) return []
  const match = /^(id|index):(\d+)$/.exec(windowId)
  if (match === null) {
    throw new ComputerUseError(`computer window id '${windowId}' is invalid`, 'COMPUTER_WINDOW_ID_INVALID')
  }
  return [windowId.startsWith('id:') ? '--window-id' : '--window-index', windowId.slice(windowId.indexOf(':') + 1)]
}

function observeArgs(request: ComputerObserveRequest): string[] {
  return [
    '--app', request.appId,
    ...windowArgs(request.windowId),
    ...(request.restoreWindow === true ? ['--restore-window'] : []),
    ...(request.captureScreenshot === true ? [] : ['--no-screenshot']),
  ]
}

/** Cinlan CLI provider with runtime-generation and observation-freshness checks. */
export class CinlanComputerUseProvider implements ComputerUseProvider {
  readonly id: string

  private runtimeId: string | undefined
  private readonly sessionId = `dsh-${randomUUID()}`
  private readonly observations = new Map<string, CurrentObservation>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly lifecycle = new AbortController()
  private disposed = false
  private disposal: Promise<void> | undefined

  private executable: string | undefined

  /** Create one provider bound to a resolved local Cinlan executable. */
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {
    this.id = config.providerId
  }

  private async resolveExecutable(signal: AbortSignal | undefined): Promise<string> {
    const lookup = deadline(this.combinedSignal(signal), this.config.commandTimeoutMs, 'COMPUTER_CLI_TIMEOUT')
    try {
      if (lookup.signal.aborted) this.throwAbort(lookup.signal, signal)
      if (this.executable !== undefined) return this.executable
      const executable = await this.ctx.subprocess.resolveExecutable(this.config.command, {}, lookup.signal)
      lookup.signal.throwIfAborted()
      this.executable = executable
      return executable
    } catch (error) {
      if (lookup.signal.aborted) this.throwAbort(lookup.signal, signal)
      throw new ComputerUseError(
        `computer-use-cinlan could not resolve executable '${this.config.command}'`,
        'COMPUTER_CLI_UNAVAILABLE',
        { cause: error },
      )
    } finally {
      lookup[Symbol.dispose]()
    }
  }

  /** Return whether the provider still accepts operations. */
  available(): boolean {
    return !this.disposed
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ComputerUseError('computer-use-cinlan provider is disposed', 'COMPUTER_PROVIDER_DISPOSED')
    }
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
    const timeout = timeoutOf(bounded, 'COMPUTER_CLI_TIMEOUT')
    if (timeout !== undefined) {
      throw new ComputerUseError(
        `computer-use-cinlan command timed out after ${this.config.commandTimeoutMs}ms`,
        'COMPUTER_CLI_TIMEOUT',
        { cause: timeout },
      )
    }
    if (bounded.reason === this.lifecycle.signal.reason && this.lifecycle.signal.aborted) {
      throw new ComputerUseError('computer-use-cinlan provider was disposed', 'COMPUTER_PROVIDER_DISPOSED')
    }
    /* v8 ignore else -- every non-timeout, non-lifecycle deadline source is the caller signal. */
    if (caller !== undefined && bounded.reason === caller.reason && caller.aborted) caller.throwIfAborted()
    /* v8 ignore next -- deadline sources are exhausted above; this preserves a typed fallback if that utility changes. */
    throw new ComputerUseError('computer-use-cinlan command was aborted', 'COMPUTER_ABORTED')
  }

  private async execute(
    args: readonly string[],
    signal: AbortSignal | undefined,
    options: InvokeOptions,
  ): Promise<{ readonly envelope: CinlanComputerEnvelope; readonly outcome: SubprocessOutcome }> {
    const executable = await this.resolveExecutable(signal)
    const bound = deadline(this.combinedSignal(signal), this.config.commandTimeoutMs, 'COMPUTER_CLI_TIMEOUT')
    try {
      let handle: SubprocessHandle
      let outcome: SubprocessOutcome
      try {
        handle = this.ctx.subprocess.spawn({
          argv: [
            executable,
            ...args,
            ...(options.sessionScoped === true ? ['--session', this.sessionId] : []),
            '--json',
          ],
          cwd: this.config.cwd,
          stdio: {
            stdin: options.stdinData === undefined ? 'ignore' : { data: options.stdinData },
            stdout: { maxBytes: this.config.maxJsonBytes },
            stderr: { maxBytes: this.config.maxStderrBytes },
          },
          graceMs: this.config.graceMs,
          signal: bound.signal,
          env: CINLAN_COMPUTER_LOCAL_ENV,
        })
        outcome = await handle.done
      } catch (error) {
        if (bound.signal.aborted) this.throwAbort(bound.signal, signal)
        throw new ComputerUseError('computer-use-cinlan failed to launch the Cinlan CLI', 'COMPUTER_CLI_FAILED', { cause: error })
      }
      if (bound.signal.aborted) this.throwAbort(bound.signal, signal)
      const stdout = (handle.collected.stdout as SubprocessOutputReader).readFrom(0)
      if (stdout.lossy) {
        throw new ComputerUseError(
          `computer-use-cinlan stdout exceeds the configured ${this.config.maxJsonBytes}-byte limit`,
          'COMPUTER_CLI_RESPONSE_TOO_LARGE',
        )
      }
      const envelope = parseCinlanComputerEnvelope(stdout.text)
      const cleanExit = outcome.exitCode === 0 && outcome.signal === null
      if (envelope.ok !== cleanExit) {
        throw new ComputerUseError(
          'computer-use-cinlan process status does not match its JSON envelope',
          'COMPUTER_CINLAN_PROTOCOL',
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

  private staleObservation(id: string): ComputerUseError {
    return new ComputerUseError(
      `computer observation '${id}' is stale; observe the application again`,
      'COMPUTER_OBSERVATION_STALE',
    )
  }

  private mapFailure(error: { readonly code: string; readonly message: string; readonly nextSteps: readonly string[] }): ComputerUseError {
    const message = error.nextSteps.length === 0
      ? error.message
      : `${error.message}\n${error.nextSteps.map(step => `Next step: ${step}`).join('\n')}`
    const direct: Readonly<Record<string, string>> = {
      app_not_found: 'COMPUTER_APP_NOT_FOUND',
      app_blocked: 'COMPUTER_APP_BLOCKED',
      window_not_found: 'COMPUTER_WINDOW_NOT_FOUND',
      window_stale: 'COMPUTER_WINDOW_STALE',
      element_not_found: 'COMPUTER_ELEMENT_STALE',
      runtime_unavailable: 'COMPUTER_RUNTIME_UNAVAILABLE',
    }
    return new ComputerUseError(message, direct[error.code] ?? providerCode(error.code))
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
      throw new ComputerUseError('Cinlan runtime changed; observe the application again', 'COMPUTER_RUNTIME_STALE')
    }
    if (!execution.envelope.ok) throw this.mapFailure(execution.envelope.error)
    return { value: parse(execution.envelope.result), runtimeId: execution.envelope.runtimeId }
  }

  private assertTarget(parsed: ParsedObservationResult, request: ComputerObserveRequest): void {
    if (parsed.app.appId !== request.appId) {
      throw new ComputerUseError(
        `computer-use-cinlan returned app '${parsed.app.appId}' for '${request.appId}'`,
        'COMPUTER_CINLAN_PROTOCOL',
      )
    }
    if (request.windowId !== undefined && parsed.window.windowId !== request.windowId) {
      throw new ComputerUseError(
        `computer-use-cinlan returned window '${parsed.window.windowId}' for '${request.windowId}'`,
        'COMPUTER_CINLAN_PROTOCOL',
      )
    }
  }

  private async publishObservation(
    parsed: ParsedObservationResult,
    request: ComputerObserveRequest,
    runtimeId: string,
  ): Promise<ComputerObservation> {
    this.assertTarget(parsed, request)
    const observationId = ComputerObservationId(randomUUID())
    const observation: ComputerObservation = {
      observationId,
      app: parsed.app,
      window: parsed.window,
      coordinateSpace: 'window',
      tree: parsed.tree,
      elements: parsed.elements,
      focusedElementId: parsed.focusedElementId,
      ...(parsed.truncation === undefined ? {} : { truncation: parsed.truncation }),
      ...(parsed.screenshot === undefined
        ? {}
        : { screenshot: await loadComputerScreenshot(parsed.screenshot, this.config.maxImageBytes) }),
      screenshotStatus: parsed.screenshotStatus,
    }
    this.observations.set(targetKey(parsed.app.appId, parsed.window.windowId), {
      id: observationId,
      runtimeId,
      appId: parsed.app.appId,
      windowId: parsed.window.windowId,
      elements: new Map(parsed.elements.map(element => [element.elementId, element.index])),
    })
    return observation
  }

  private async publishAction(
    parsed: ParsedActionResult,
    request: ComputerActionRequest,
    runtimeId: string,
  ): Promise<ComputerActionResult> {
    const observation = await this.publishObservation(parsed, request, runtimeId)
    return { observation, ...(parsed.action === undefined ? {} : { action: parsed.action }) }
  }

  private async takeObservation(request: ComputerActionRequest, signal: AbortSignal | undefined): Promise<CurrentObservation> {
    await this.invoke(
      ['computer', 'capabilities'],
      parseCapabilities,
      signal,
      { stableRuntime: true },
    )
    const key = targetKey(request.appId, request.windowId)
    const observation = this.observations.get(key)
    if (observation === undefined
      || observation.id !== request.observationId
      || observation.runtimeId !== this.runtimeId) {
      throw this.staleObservation(request.observationId)
    }
    this.observations.delete(key)
    return observation
  }

  private element(observation: CurrentObservation, elementId: ComputerElementId): number {
    const index = observation.elements.get(elementId)
    if (index === undefined) {
      throw new ComputerUseError(
        `computer element '${elementId}' is not part of observation '${observation.id}'`,
        'COMPUTER_ELEMENT_STALE',
      )
    }
    return index
  }

  private async action(
    command: string,
    request: ComputerActionRequest,
    actionArgs: (observation: CurrentObservation) => readonly string[],
    signal: AbortSignal | undefined,
    stdinData?: string,
  ): Promise<ComputerActionResult> {
    const observation = await this.takeObservation(request, signal)
    const { value, runtimeId } = await this.invoke(
      ['computer', command, ...observeArgs(request), ...actionArgs(observation)],
      parseAction,
      signal,
      { sessionScoped: true, stableRuntime: true, ...(stdinData === undefined ? {} : { stdinData }) },
    )
    return this.publishAction(value, request, runtimeId)
  }

  /** Read current provider capabilities. */
  capabilities(signal?: AbortSignal): Promise<ComputerCapabilities> {
    return this.track(async () => {
      const { value } = await this.invoke(['computer', 'capabilities'], parseCapabilities, signal)
      return value
    })
  }

  /** List local desktop applications. */
  listApps(signal?: AbortSignal): Promise<readonly ComputerApp[]> {
    return this.track(async () => {
      const { value } = await this.invoke(['computer', 'list-apps'], parseListApps, signal)
      return value
    })
  }

  /** List local windows for one application. */
  listWindows(request: ComputerListWindowsRequest, signal?: AbortSignal): Promise<readonly ComputerWindow[]> {
    return this.track(async () => {
      const { value } = await this.invoke(
        ['computer', 'list-windows', '--app', request.appId],
        parseListWindows,
        signal,
      )
      if (value.some(window => window.appId !== request.appId)) {
        throw new ComputerUseError('computer-use-cinlan returned windows for another app', 'COMPUTER_CINLAN_PROTOCOL')
      }
      return value
    })
  }

  /** Capture one fresh accessibility observation. */
  observe(request: ComputerObserveRequest, signal?: AbortSignal): Promise<ComputerObservation> {
    return this.track(async () => {
      const { value, runtimeId } = await this.invoke(
        ['computer', 'get-app-state', ...observeArgs(request)],
        parseObservation,
        signal,
        { sessionScoped: true },
      )
      return this.publishObservation(value, request, runtimeId)
    })
  }

  /** Click an observation-bound element or point. */
  click(request: ComputerClickRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('click', request, observation => [
      ...(request.target.kind === 'element'
        ? ['--element-index', String(this.element(observation, request.target.elementId))]
        : ['--x', String(request.target.x), '--y', String(request.target.y)]),
      ...(request.clickCount === undefined ? [] : ['--click-count', String(request.clickCount)]),
      ...(request.mouseButton === undefined ? [] : ['--mouse-button', request.mouseButton]),
      ...(request.modifiers === undefined ? [] : ['--modifiers', request.modifiers]),
    ], signal))
  }

  /** Perform a provider-advertised secondary accessibility action. */
  performSecondaryAction(request: ComputerSecondaryActionRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('perform-secondary-action', request, observation => [
      '--element-index', String(this.element(observation, request.elementId)),
      '--action', request.action,
    ], signal))
  }

  /** Scroll an observation-bound element or point. */
  scroll(request: ComputerScrollRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('scroll', request, observation => [
      ...(request.target.kind === 'element'
        ? ['--element-index', String(this.element(observation, request.target.elementId))]
        : ['--x', String(request.target.x), '--y', String(request.target.y)]),
      '--direction', request.direction,
      ...(request.pages === undefined ? [] : ['--pages', String(request.pages)]),
    ], signal))
  }

  /** Drag between observation-bound elements or points. */
  drag(request: ComputerDragRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('drag', request, observation => request.target.kind === 'elements'
      ? [
        '--from-element-index', String(this.element(observation, request.target.fromElementId)),
        '--to-element-index', String(this.element(observation, request.target.toElementId)),
      ]
      : [
        '--from-x', String(request.target.fromX),
        '--from-y', String(request.target.fromY),
        '--to-x', String(request.target.toX),
        '--to-y', String(request.target.toY),
      ], signal))
  }

  /** Type literal text through batch stdin. */
  typeText(request: ComputerTypeTextRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('type-text', request, () => ['--text-stdin'], signal, request.text))
  }

  /** Press one key. */
  pressKey(request: ComputerPressKeyRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('press-key', request, () => ['--key', request.key], signal))
  }

  /** Press one platform-aware hotkey. */
  hotkey(request: ComputerHotkeyRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('hotkey', request, () => ['--key', request.key], signal))
  }

  /** Paste exact text through batch stdin. */
  pasteText(request: ComputerPasteTextRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('paste-text', request, () => ['--text-stdin'], signal, request.text))
  }

  /** Set one element value through batch stdin. */
  setValue(request: ComputerSetValueRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.track(() => this.action('set-value', request, observation => [
      '--element-index', String(this.element(observation, request.elementId)),
      '--value-stdin',
    ], signal, request.value))
  }

  /** Stop accepting calls and join every in-flight CLI process. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.lifecycle.abort(new ComputerUseError('computer-use-cinlan provider disposed', 'COMPUTER_PROVIDER_DISPOSED'))
    this.disposal = Promise.allSettled([...this.inFlight]).then(() => {
      this.observations.clear()
    })
    return this.disposal
  }
}

/** Register the provider immediately. Executable resolution, protocol probing,
 * and capability validation are deferred to the first operation call (lazy
 * connection), so a missing or unready Cinlan IDE CLI never blocks the plugin tree. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveCinlanComputerUseConfig(config)
  const provider = new CinlanComputerUseProvider(ctx, resolved)
  ctx.effect(function* () {
    yield ctx.computerUse.registerProvider(provider)
    yield () => provider.dispose()
  }, 'computer-use-cinlan.lifecycle')
}
