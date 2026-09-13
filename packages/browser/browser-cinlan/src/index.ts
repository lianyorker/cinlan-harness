/**
 * Cinlan IDE CLI Service Provider for persistent browser tabs. Every operation
 * launches one public JSON CLI argv through `ctx.subprocess`, binds it to the
 * local runtime, and validates the complete response before publishing state.
 * OS Computer Use commands are intentionally absent.
 * @module @deepseek-ai/dsh-browser-cinlan
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  BrowserElementId,
  BrowserElementSelectionId,
  BrowserError,
  BrowserObservationId,
} from '@deepseek-ai/dsh-browser'
import type {
  BrowserClickRequest,
  BrowserClickResult,
  BrowserCloseRequest,
  BrowserElementCaptureProvider,
  BrowserElementCaptureRequest,
  BrowserElementScreenshot,
  BrowserElementSelection,
  BrowserElementSelectionRequest,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserObservation,
  BrowserOpenRequest,
  BrowserOpenResult,
  BrowserPage,
  BrowserPageId,
  BrowserRect,
  BrowserScreenshot,
  BrowserScreenshotRequest,
  BrowserSnapshotRequest,
} from '@deepseek-ai/dsh-browser'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
} from '@deepseek-ai/dsh-subprocess'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { boundedElementRect, cropElementScreenshot } from './crop.ts'
import {
  parseCinlanEnvelope,
  parseClickResult,
  parseElementCapturePayload,
  parseEvalResult,
  parseNavigateResult,
  parseScreenshotResult,
  parseSnapshotResult,
  parseTabCloseResult,
  parseTabCreateResult,
  parseTabListResult,
} from './protocol.ts'
import type { CinlanEnvelope, RawElementCapture, RawElementFingerprint } from './protocol.ts'
import { clearOverlayScript, overlaySelectionScript, removeElementMarkerScript, verifyElementScript } from './scripts.ts'

/** Cordis plugin name. */
export const name = 'browser-cinlan'

/** Services required by the Cinlan browser provider. */
export const inject = ['browser', 'subprocess']

/** Default provider id registered on `ctx.browser`. */
export const CINLAN_BROWSER_PROVIDER_ID = 'cinlan'

const DEFAULT_COMMAND_TIMEOUT_MS = 65_000
const DEFAULT_CLEANUP_TIMEOUT_MS = 15_000
const DEFAULT_GRACE_MS = 3_000
const DEFAULT_MAX_JSON_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const DEFAULT_SELECTION_TIMEOUT_MS = 60_000
const DEFAULT_MAX_CAPTURE_PIXELS = 4_000_000
const DEFAULT_COMMAND = process.platform === 'linux' ? 'orca-ide' : 'orca'

/** Explicit environment tombstones that keep this provider on the local runtime. */
export const CINLAN_LOCAL_ENV: NodeJS.ProcessEnv = Object.freeze({
  ORCA_PAIRING_CODE: undefined,
  ORCA_REMOTE_PAIRING: undefined,
  ORCA_ENVIRONMENT: undefined,
})

/** Cinlan CLI provider configuration. */
export interface Config {
  /** Provider id registered on `ctx.browser`. Defaults to `cinlan`. */
  readonly providerId?: string
  /** Cinlan IDE CLI executable name or absolute path. Defaults to `orca-ide` on
   * Linux and `orca` elsewhere. */
  readonly command?: string
  /** Child-process working directory. Defaults to `process.cwd()`. */
  readonly cwd?: string
  /** Cinlan browser worktree selector. Defaults to `active`. */
  readonly worktree?: string
  /** Per-command deadline, including executable resolution. Defaults to 65000 ms. */
  readonly commandTimeoutMs?: number
  /** Per-command deadline for overlay, marker, and owned-tab cleanup. Defaults to 15000 ms. */
  readonly cleanupTimeoutMs?: number
  /** Subprocess TERM-to-KILL grace. Defaults to 3000 ms. */
  readonly graceMs?: number
  /** Complete stdout JSON byte cap. Defaults to 16 MiB. */
  readonly maxJsonBytes?: number
  /** Captured stderr byte cap. Defaults to 64 KiB. */
  readonly maxStderrBytes?: number
  /** Image-file byte cap after base64 decoding and crop encoding. Defaults to 10 MiB. */
  readonly maxImageBytes?: number
  /** Maximum time waiting for a human element selection. Defaults to 60000 ms. */
  readonly selectionTimeoutMs?: number
  /** Maximum visible CSS-pixel area (width × height) captured by one element operation. Defaults to 4,000,000. */
  readonly maxCapturePixels?: number
}

/** Fully validated provider configuration. */
export interface ResolvedConfig {
  readonly providerId: string
  readonly command: string
  readonly cwd: string
  readonly worktree: string
  readonly commandTimeoutMs: number
  readonly cleanupTimeoutMs: number
  readonly graceMs: number
  readonly maxJsonBytes: number
  readonly maxStderrBytes: number
  readonly maxImageBytes: number
  readonly selectionTimeoutMs: number
  readonly maxCapturePixels: number
}

const CONFIG_KEYS = new Set([
  'providerId',
  'command',
  'cwd',
  'worktree',
  'commandTimeoutMs',
  'cleanupTimeoutMs',
  'graceMs',
  'maxJsonBytes',
  'maxStderrBytes',
  'maxImageBytes',
  'selectionTimeoutMs',
  'maxCapturePixels',
])

/** Loader schema for Cinlan browser provider configuration. */
export const Config: z<Config> = z.object({
  providerId: z.string().default(CINLAN_BROWSER_PROVIDER_ID),
  command: z.string(),
  cwd: z.string(),
  worktree: z.string().default('active'),
  commandTimeoutMs: z.number().default(DEFAULT_COMMAND_TIMEOUT_MS),
  cleanupTimeoutMs: z.number().default(DEFAULT_CLEANUP_TIMEOUT_MS),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
  maxJsonBytes: z.number().default(DEFAULT_MAX_JSON_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_MAX_STDERR_BYTES),
  maxImageBytes: z.number().default(DEFAULT_MAX_IMAGE_BYTES),
  selectionTimeoutMs: z.number().default(DEFAULT_SELECTION_TIMEOUT_MS),
  maxCapturePixels: z.number().default(DEFAULT_MAX_CAPTURE_PIXELS),
})

function cleanString(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`browser-cinlan: ${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function positiveSafeInteger(name: string, value: number, max?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw new Error(
      `browser-cinlan: ${name} must be a positive safe integer`
      + (max === undefined ? '' : ` no greater than ${max}`),
    )
  }
  return value
}

/**
 * Validate and default provider config before executable resolution.
 * @param config - Loader or direct-plugin config.
 * @returns Complete provider config.
 */
export function resolveCinlanBrowserConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`browser-cinlan: unsupported config key '${key}'`)
  }
  return {
    providerId: cleanString('providerId', config.providerId ?? CINLAN_BROWSER_PROVIDER_ID),
    command: cleanString('command', config.command ?? DEFAULT_COMMAND),
    cwd: cleanString('cwd', config.cwd ?? process.cwd()),
    worktree: cleanString('worktree', config.worktree ?? 'active'),
    commandTimeoutMs: positiveSafeInteger(
      'commandTimeoutMs',
      config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      MAX_TIMER_DELAY_MS,
    ),
    cleanupTimeoutMs: positiveSafeInteger(
      'cleanupTimeoutMs',
      config.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
      MAX_TIMER_DELAY_MS,
    ),
    graceMs: positiveSafeInteger('graceMs', config.graceMs ?? DEFAULT_GRACE_MS, MAX_TIMER_DELAY_MS),
    maxJsonBytes: positiveSafeInteger('maxJsonBytes', config.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES),
    maxStderrBytes: positiveSafeInteger(
      'maxStderrBytes',
      config.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
    ),
    maxImageBytes: positiveSafeInteger('maxImageBytes', config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES),
    selectionTimeoutMs: positiveSafeInteger(
      'selectionTimeoutMs',
      config.selectionTimeoutMs ?? DEFAULT_SELECTION_TIMEOUT_MS,
      MAX_TIMER_DELAY_MS,
    ),
    maxCapturePixels: positiveSafeInteger('maxCapturePixels', config.maxCapturePixels ?? DEFAULT_MAX_CAPTURE_PIXELS),
  }
}

interface CurrentObservation {
  readonly id: BrowserObservationId
  readonly runtimeId: string
  readonly elements: ReadonlyMap<BrowserElementId, string>
}

/** Temporary human selection: the runtime generation it belongs to and the
 * private DOM marker used to re-locate the element for capture. */
interface SelectionState {
  readonly pageId: BrowserPageId
  readonly runtimeId: string
  readonly key: string
  readonly fingerprint: RawElementFingerprint
}

interface InvokeOptions {
  readonly pageId?: BrowserPageId
  readonly timeoutMs?: number
  readonly cleanup?: boolean
}

function providerCode(code: string): string {
  const suffix = code.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `BROWSER_CINLAN_${suffix.length === 0 ? 'ERROR' : suffix}`
}

function sameFingerprint(left: RawElementFingerprint, right: RawElementFingerprint): boolean {
  return left.tagName === right.tagName
    && left.role === right.role
    && left.name === right.name
    && left.text === right.text
}

function sameRect(left: BrowserRect, right: BrowserRect): boolean {
  return Math.abs(left.x - right.x) <= 0.5
    && Math.abs(left.y - right.y) <= 0.5
    && Math.abs(left.width - right.width) <= 0.5
    && Math.abs(left.height - right.height) <= 0.5
}

function sameViewport(
  left: { readonly width: number; readonly height: number },
  right: { readonly width: number; readonly height: number },
): boolean {
  return left.width === right.width && left.height === right.height
}

/** Cinlan CLI provider with runtime-generation and observation freshness checks. */
export class CinlanBrowserProvider implements BrowserElementCaptureProvider {
  readonly id: string

  private runtimeId: string | undefined
  private readonly pageRuntimes = new Map<BrowserPageId, string>()
  private readonly observations = new Map<BrowserPageId, CurrentObservation>()
  private readonly selections = new Map<ReturnType<typeof BrowserElementSelectionId>, SelectionState>()
  private readonly ownedPages = new Map<BrowserPageId, string>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly lifecycle = new AbortController()
  private disposed = false
  private disposal: Promise<void> | undefined

  private executable: string | undefined

  /**
   * @param ctx - Context carrying the subprocess service.
   * @param config - Fully validated provider config.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {
    this.id = config.providerId
  }

  private async resolveExecutable(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    if (this.executable !== undefined) return this.executable
    let executable: string
    try {
      executable = await this.ctx.subprocess.resolveExecutable(this.config.command, {}, signal)
    } catch (error) {
      signal.throwIfAborted()
      throw new BrowserError(
        `browser-cinlan could not resolve executable '${this.config.command}'`,
        'BROWSER_CLI_UNAVAILABLE',
        { cause: error },
      )
    }
    signal.throwIfAborted()
    this.executable = executable
    return executable
  }

  /** @returns Whether the provider still accepts operations. */
  available(): boolean {
    return !this.disposed
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new BrowserError('browser-cinlan provider is disposed', 'BROWSER_PROVIDER_DISPOSED')
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
    return signal === undefined
      ? this.lifecycle.signal
      : AbortSignal.any([signal, this.lifecycle.signal])
  }

  private throwAbort(
    bounded: AbortSignal,
    caller: AbortSignal | undefined,
    timeoutCode: string,
    timeoutMs: number,
  ): void {
    const timeout = timeoutOf(bounded, timeoutCode)
    if (timeout !== undefined) {
      throw new BrowserError(
        `browser-cinlan command timed out after ${timeoutMs}ms`,
        'BROWSER_CLI_TIMEOUT',
        { cause: timeout },
      )
    }
    if (bounded.reason === this.lifecycle.signal.reason && this.lifecycle.signal.aborted) {
      throw new BrowserError('browser-cinlan provider was disposed', 'BROWSER_PROVIDER_DISPOSED')
    }
    /* v8 ignore else -- every non-timeout, non-lifecycle bound source is the caller signal. */
    if (caller !== undefined && bounded.reason === caller.reason && caller.aborted) caller.throwIfAborted()
    /* v8 ignore next -- deadline sources are exhausted above; this preserves a typed fallback if that utility changes. */
    throw new BrowserError('browser-cinlan command was aborted', 'BROWSER_ABORTED')
  }

  private async execute(
    args: readonly string[],
    signal: AbortSignal | undefined,
    timeoutMs: number,
    cleanup: boolean,
  ): Promise<{ readonly envelope: CinlanEnvelope; readonly outcome: SubprocessOutcome }> {
    const upstream = cleanup ? signal : this.combinedSignal(signal)
    const timeoutCode = cleanup ? 'BROWSER_CLI_CLEANUP_TIMEOUT' : 'BROWSER_CLI_TIMEOUT'
    const bound = deadline(upstream, timeoutMs, timeoutCode)
    try {
      let executable: string
      try {
        executable = await this.resolveExecutable(bound.signal)
      } catch (error) {
        if (bound.signal.aborted) this.throwAbort(bound.signal, signal, timeoutCode, timeoutMs)
        throw error
      }
      if (bound.signal.aborted) this.throwAbort(bound.signal, signal, timeoutCode, timeoutMs)
      let handle: SubprocessHandle
      let outcome: SubprocessOutcome
      try {
        handle = this.ctx.subprocess.spawn({
          argv: [
            executable,
            ...args,
            '--worktree',
            this.config.worktree,
            '--json',
          ],
          cwd: this.config.cwd,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: this.config.maxJsonBytes },
            stderr: { maxBytes: this.config.maxStderrBytes },
          },
          graceMs: this.config.graceMs,
          signal: bound.signal,
          env: CINLAN_LOCAL_ENV,
        })
        outcome = await handle.done
      } catch (error) {
        if (bound.signal.aborted) this.throwAbort(bound.signal, signal, timeoutCode, timeoutMs)
        throw new BrowserError('browser-cinlan failed to launch the Cinlan CLI', 'BROWSER_CLI_FAILED', { cause: error })
      }
      if (bound.signal.aborted) this.throwAbort(bound.signal, signal, timeoutCode, timeoutMs)
      const stdoutReader = handle.collected.stdout as SubprocessOutputReader
      const stdout = stdoutReader.readFrom(0)
      if (stdout.lossy) {
        throw new BrowserError(
          `browser-cinlan stdout exceeds the configured ${this.config.maxJsonBytes}-byte limit`,
          'BROWSER_CLI_RESPONSE_TOO_LARGE',
        )
      }
      const envelope = parseCinlanEnvelope(stdout.text)
      const cleanExit = outcome.exitCode === 0 && outcome.signal === null
      if (envelope.ok !== cleanExit) {
        throw new BrowserError(
          'browser-cinlan process status does not match its JSON envelope',
          'BROWSER_CINLAN_PROTOCOL',
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
    this.selections.clear()
    return true
  }

  /** Drop the observation and any selections recorded against one page. */
  private invalidatePage(pageId: BrowserPageId): void {
    this.observations.delete(pageId)
    for (const [selectionId, selection] of this.selections) {
      if (selection.pageId === pageId) this.selections.delete(selectionId)
    }
  }

  private staleRuntime(pageId: BrowserPageId): BrowserError {
    return new BrowserError(
      `browser page '${pageId}' belongs to a stale Cinlan runtime; list pages again`,
      'BROWSER_RUNTIME_STALE',
    )
  }

  private assertPageRuntime(pageId: BrowserPageId): void {
    const seen = this.pageRuntimes.get(pageId)
    if (seen !== undefined && this.runtimeId !== undefined && seen !== this.runtimeId) {
      throw this.staleRuntime(pageId)
    }
  }

  private mapFailure(
    error: { readonly code: string; readonly message: string },
    pageId: BrowserPageId | undefined,
  ): BrowserError {
    if (error.code === 'browser_tab_not_found') {
      if (pageId !== undefined) {
        this.invalidatePage(pageId)
        this.ownedPages.delete(pageId)
        this.pageRuntimes.delete(pageId)
      }
      return new BrowserError(error.message, 'BROWSER_PAGE_NOT_FOUND')
    }
    if (error.code === 'browser_stale_ref') {
      if (pageId !== undefined) this.invalidatePage(pageId)
      return new BrowserError(error.message, 'BROWSER_ELEMENT_STALE')
    }
    return new BrowserError(error.message, providerCode(error.code))
  }

  private async invoke<T>(
    args: readonly string[],
    parse: (value: unknown) => T,
    signal: AbortSignal | undefined,
    options: InvokeOptions = {},
  ): Promise<{ readonly value: T; readonly runtimeId: string }> {
    const execution = await this.execute(
      args,
      signal,
      options.timeoutMs ?? this.config.commandTimeoutMs,
      options.cleanup ?? false,
    )
    const runtimeChanged = execution.envelope.runtimeId === null
      ? false
      : this.observeRuntime(execution.envelope.runtimeId)
    if (runtimeChanged && options.pageId !== undefined) throw this.staleRuntime(options.pageId)
    if (!execution.envelope.ok) throw this.mapFailure(execution.envelope.error, options.pageId)
    return {
      value: parse(execution.envelope.result),
      runtimeId: execution.envelope.runtimeId,
    }
  }

  /** @inheritdoc */
  async listPages(signal?: AbortSignal): Promise<readonly BrowserPage[]> {
    return this.track(async () => {
      const { value: pages, runtimeId } = await this.invoke(['tab', 'list'], parseTabListResult, signal)
      for (const page of pages) this.pageRuntimes.set(page.pageId, runtimeId)
      return pages
    })
  }

  /** @inheritdoc */
  async openPage(request: BrowserOpenRequest, signal?: AbortSignal): Promise<BrowserOpenResult> {
    return this.track(async () => {
      const { value: pageId, runtimeId } = await this.invoke(
        ['tab', 'create', '--url', request.url],
        parseTabCreateResult,
        signal,
      )
      this.pageRuntimes.set(pageId, runtimeId)
      this.ownedPages.set(pageId, runtimeId)
      return { pageId }
    })
  }

  /** @inheritdoc */
  async navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigateResult> {
    return this.track(async () => {
      this.assertPageRuntime(request.pageId)
      this.invalidatePage(request.pageId)
      const { value: result, runtimeId } = await this.invoke(
        ['goto', '--page', request.pageId, '--url', request.url],
        parseNavigateResult,
        signal,
        { pageId: request.pageId },
      )
      this.pageRuntimes.set(request.pageId, runtimeId)
      return { pageId: request.pageId, ...result }
    })
  }

  /** @inheritdoc */
  async snapshot(request: BrowserSnapshotRequest, signal?: AbortSignal): Promise<BrowserObservation> {
    return this.track(async () => {
      this.assertPageRuntime(request.pageId)
      const { value: result, runtimeId } = await this.invoke(
        ['snapshot', '--page', request.pageId],
        parseSnapshotResult,
        signal,
        { pageId: request.pageId },
      )
      if (result.pageId !== request.pageId) {
        throw new BrowserError(
          `browser-cinlan snapshot returned page '${result.pageId}' for '${request.pageId}'`,
          'BROWSER_CINLAN_PROTOCOL',
        )
      }
      const observationId = BrowserObservationId(randomUUID())
      const elements = new Map(result.elements.map(element => [element.elementId, element.elementId]))
      this.pageRuntimes.set(request.pageId, runtimeId)
      this.observations.set(request.pageId, {
        id: observationId,
        runtimeId,
        elements,
      })
      return {
        observationId,
        pageId: request.pageId,
        url: result.url,
        title: result.title,
        tree: result.tree,
        elements: result.elements,
      }
    })
  }

  /** @inheritdoc */
  async click(request: BrowserClickRequest, signal?: AbortSignal): Promise<BrowserClickResult> {
    return this.track(async () => {
      this.assertPageRuntime(request.pageId)
      const observation = this.observations.get(request.pageId)
      if (observation === undefined
        || observation.id !== request.observationId
        || observation.runtimeId !== this.runtimeId) {
        throw new BrowserError(
          `browser observation '${request.observationId}' is stale; snapshot the page again`,
          'BROWSER_OBSERVATION_STALE',
        )
      }
      const element = observation.elements.get(request.elementId)
      if (element === undefined) {
        throw new BrowserError(
          `browser element '${request.elementId}' is not part of observation '${request.observationId}'`,
          'BROWSER_ELEMENT_STALE',
        )
      }
      this.observations.delete(request.pageId)
      const { value: clicked } = await this.invoke(
        ['click', '--page', request.pageId, '--element', element],
        parseClickResult,
        signal,
        { pageId: request.pageId },
      )
      if (clicked !== element) {
        throw new BrowserError(
          `browser-cinlan click confirmed '${clicked}' instead of '${element}'`,
          'BROWSER_CINLAN_PROTOCOL',
        )
      }
      return request
    })
  }


  /** @inheritdoc */
  async selectElement(
    request: BrowserElementSelectionRequest,
    signal?: AbortSignal,
  ): Promise<BrowserElementSelection> {
    return this.track(async () => {
      this.assertPageRuntime(request.pageId)
      const key = `dsh-${randomUUID()}`
      let retained = false
      try {
        let raw: RawElementCapture | null
        try {
          const { value: evaluation, runtimeId } = await this.invoke(
            ['eval', '--page', request.pageId, '--expression', overlaySelectionScript(key)],
            parseEvalResult,
            signal,
            { pageId: request.pageId, timeoutMs: this.config.selectionTimeoutMs },
          )
          this.pageRuntimes.set(request.pageId, runtimeId)
          raw = parseElementCapturePayload(evaluation.result)
        } catch (error) {
          if (error instanceof BrowserError && error.code === 'BROWSER_CLI_TIMEOUT') {
            throw new BrowserError(
              `browser-cinlan element selection timed out after ${this.config.selectionTimeoutMs}ms`,
              'BROWSER_SELECTION_TIMEOUT',
              { cause: error },
            )
          }
          throw error
        }
        if (raw === null) {
          throw new BrowserError(
            'browser-cinlan element selection was cancelled',
            'BROWSER_SELECTION_CANCELLED',
          )
        }
        const rect = boundedElementRect(raw.rect, raw.viewport, this.config.maxCapturePixels)
        const selectionId = BrowserElementSelectionId(randomUUID())
        const runtimeId = this.runtimeId
        if (runtimeId === undefined) {
          throw new BrowserError(
            'browser-cinlan did not return a runtime generation for element selection',
            'BROWSER_CINLAN_PROTOCOL',
          )
        }
        this.selections.set(selectionId, {
          pageId: request.pageId,
          runtimeId,
          key,
          fingerprint: raw,
        })
        retained = true
        return {
          selectionId,
          pageId: request.pageId,
          tagName: raw.tagName,
          role: raw.role,
          name: raw.name,
          text: raw.text,
          rect,
        }
      } finally {
        await this.cleanupExpression(request.pageId, clearOverlayScript(key))
        if (!retained) await this.cleanupExpression(request.pageId, removeElementMarkerScript(key))
      }
    })
  }

  /** @inheritdoc */
  async captureElement(
    request: BrowserElementCaptureRequest,
    signal?: AbortSignal,
  ): Promise<BrowserElementScreenshot> {
    return this.track(async () => {
      this.assertPageRuntime(request.pageId)
      if (request.target.kind === 'observation') {
        const observation = this.observations.get(request.pageId)
        if (observation === undefined
          || observation.id !== request.target.observationId
          || observation.runtimeId !== this.runtimeId) {
          throw new BrowserError(
            `browser observation '${request.target.observationId}' is stale; snapshot the page again`,
            'BROWSER_OBSERVATION_STALE',
          )
        }
        if (!observation.elements.has(request.target.elementId)) {
          throw new BrowserError(
            `browser element '${request.target.elementId}' is not part of observation '${request.target.observationId}'`,
            'BROWSER_ELEMENT_STALE',
          )
        }
        throw new BrowserError(
          'browser-cinlan cannot safely crop an observation ref because Orca refs are opaque runtime handles',
          'BROWSER_FEATURE_UNSUPPORTED',
        )
      }

      const selectionId = request.target.selectionId
      const selection = this.selections.get(selectionId)
      if (selection === undefined
        || selection.pageId !== request.pageId
        || selection.runtimeId !== this.runtimeId) {
        throw new BrowserError(
          'browser element selection is stale; select the element again',
          'BROWSER_ELEMENT_STALE',
        )
      }
      this.selections.delete(selectionId)
      try {
        const { value: beforeEvaluation, runtimeId: beforeRuntimeId } = await this.invoke(
          ['eval', '--page', request.pageId, '--expression', verifyElementScript(selection.key, false)],
          parseEvalResult,
          signal,
          { pageId: request.pageId },
        )
        this.pageRuntimes.set(request.pageId, beforeRuntimeId)
        const before = parseElementCapturePayload(beforeEvaluation.result)
        if (before === null) {
          throw new BrowserError(
            'browser element selection is no longer available; select the element again',
            'BROWSER_ELEMENT_STALE',
          )
        }
        if (!sameFingerprint(selection.fingerprint, before)) {
          throw new BrowserError(
            'browser element changed after selection; select it again',
            'BROWSER_ELEMENT_CHANGED',
          )
        }
        const beforeRect = boundedElementRect(before.rect, before.viewport, this.config.maxCapturePixels)
        const { value: screenshot, runtimeId: screenshotRuntimeId } = await this.invoke(
          ['screenshot', '--page', request.pageId, '--format', request.format],
          value => parseScreenshotResult(value, this.config.maxImageBytes),
          signal,
          { pageId: request.pageId },
        )
        this.pageRuntimes.set(request.pageId, screenshotRuntimeId)
        if (screenshot.format !== request.format) {
          throw new BrowserError(
            `browser-cinlan screenshot returned '${screenshot.format}' instead of '${request.format}'`,
            'BROWSER_CINLAN_PROTOCOL',
          )
        }
        const data = await cropElementScreenshot(
          screenshot.data,
          request.format,
          beforeRect,
          before.viewport,
          this.config.maxImageBytes,
        )
        const { value: afterEvaluation, runtimeId: afterRuntimeId } = await this.invoke(
          ['eval', '--page', request.pageId, '--expression', verifyElementScript(selection.key, true)],
          parseEvalResult,
          signal,
          { pageId: request.pageId },
        )
        this.pageRuntimes.set(request.pageId, afterRuntimeId)
        const after = parseElementCapturePayload(afterEvaluation.result)
        if (after === null) {
          throw new BrowserError(
            'browser element changed during capture; select it again',
            'BROWSER_ELEMENT_CHANGED',
          )
        }
        const afterRect = boundedElementRect(after.rect, after.viewport, this.config.maxCapturePixels)
        if (!sameFingerprint(before, after)
          || !sameRect(beforeRect, afterRect)
          || !sameViewport(before.viewport, after.viewport)) {
          throw new BrowserError(
            'browser element changed during capture; select it again',
            'BROWSER_ELEMENT_CHANGED',
          )
        }
        return {
          pageId: request.pageId,
          format: request.format,
          mediaType: request.format === 'png' ? 'image/png' : 'image/jpeg',
          data,
          target: request.target,
          rect: afterRect,
          viewport: after.viewport,
          verified: true,
          tagName: after.tagName,
          role: after.role,
          name: after.name,
        }
      } finally {
        await this.cleanupExpression(request.pageId, removeElementMarkerScript(selection.key))
      }
    })
  }

  /**
   * Run a cleanup expression without allowing cleanup failure to replace the
   * result of the primary Browser operation.
   * @param pageId - Page whose document owns the temporary state.
   * @param expression - Cleanup expression sent to the Cinlan CLI.
   * @returns Completion after the bounded best-effort cleanup attempt.
   */
  private async cleanupExpression(pageId: BrowserPageId, expression: string): Promise<void> {
    try {
      await this.invoke(
        ['eval', '--page', pageId, '--expression', expression],
        parseEvalResult,
        undefined,
        { pageId, timeoutMs: this.config.cleanupTimeoutMs, cleanup: true },
      )
    } catch (error) {
      // Temporary overlay and marker cleanup is best-effort and must not mask the primary operation.
      void error
    }
  }
  /** @inheritdoc */
  async screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot> {

    return this.track(async () => {
      this.assertPageRuntime(request.pageId)
      const { value: result, runtimeId } = await this.invoke(
        ['screenshot', '--page', request.pageId, '--format', request.format],
        value => parseScreenshotResult(value, this.config.maxImageBytes),
        signal,
        { pageId: request.pageId },
      )
      if (result.format !== request.format) {
        throw new BrowserError(
          `browser-cinlan screenshot returned '${result.format}' instead of '${request.format}'`,
          'BROWSER_CINLAN_PROTOCOL',
        )
      }
      this.pageRuntimes.set(request.pageId, runtimeId)
      return {
        pageId: request.pageId,
        format: result.format,
        mediaType: result.format === 'png' ? 'image/png' : 'image/jpeg',
        data: result.data,
      }
    })
  }

  /** @inheritdoc */
  async closePage(request: BrowserCloseRequest, signal?: AbortSignal): Promise<void> {
    return this.track(async () => {
      this.assertPageRuntime(request.pageId)
      this.invalidatePage(request.pageId)
      const { value: closed } = await this.invoke(
        ['tab', 'close', '--page', request.pageId],
        parseTabCloseResult,
        signal,
        { pageId: request.pageId },
      )
      if (!closed) {
        throw new BrowserError(`browser page '${request.pageId}' was not closed`, 'BROWSER_PAGE_NOT_FOUND')
      }
      this.ownedPages.delete(request.pageId)
      this.pageRuntimes.delete(request.pageId)
    })
  }

  private async finishDispose(): Promise<void> {
    await Promise.allSettled([...this.inFlight])
    const runtimeId = this.runtimeId
    if (runtimeId === undefined) return
    const pages = [...this.ownedPages]
      .filter(([, ownerRuntime]) => ownerRuntime === runtimeId)
      .map(([pageId]) => pageId)
    const failures: unknown[] = []
    for (const pageId of pages) {
      try {
        const { value: closed } = await this.invoke(
          ['tab', 'close', '--page', pageId],
          parseTabCloseResult,
          undefined,
          { pageId, timeoutMs: this.config.cleanupTimeoutMs, cleanup: true },
        )
        if (!closed) {
          throw new BrowserError(`browser page '${pageId}' closure was not confirmed`, 'BROWSER_CINLAN_CLEANUP_FAILED')
        }
      } catch (error) {
        if (error instanceof BrowserError && error.code === 'BROWSER_RUNTIME_STALE') break
        if (!(error instanceof BrowserError) || error.code !== 'BROWSER_PAGE_NOT_FOUND') {
          failures.push(error)
        }
      } finally {
        this.ownedPages.delete(pageId)
        this.pageRuntimes.delete(pageId)
        this.invalidatePage(pageId)
      }
    }
    this.ownedPages.clear()
    this.pageRuntimes.clear()
    this.observations.clear()
    this.selections.clear()
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'browser-cinlan failed to close owned pages')
    }
  }

  /**
   * Stop accepting calls, cancel in-flight CLI processes, then close only tabs
   * created by this provider instance in the current runtime generation.
   * @returns Completion after all owned processes and cleanup calls settle.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.lifecycle.abort(new BrowserError('browser-cinlan provider disposed', 'BROWSER_PROVIDER_DISPOSED'))
    this.disposal = this.finishDispose()
    return this.disposal
  }
}

/**
 * Register the provider immediately and bind cleanup to the plugin fiber.
 * Executable resolution and runtime probing are deferred to the first
 * operation call (lazy connection), so a missing or unready Cinlan IDE CLI
 * never blocks the plugin tree.
 * @param ctx - Context carrying browser and subprocess services.
 * @param config - Provider command, worktree, and bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveCinlanBrowserConfig(config)
  const provider = new CinlanBrowserProvider(ctx, resolved)
  ctx.effect(function* () {
    const unregister = ctx.browser.registerProvider(provider)
    yield async () => {
      unregister()
      await provider.dispose()
    }
  }, 'browser-cinlan.lifecycle')
}
