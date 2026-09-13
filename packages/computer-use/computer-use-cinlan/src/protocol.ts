/** Strict parser for public `cinlan computer ... --json` responses. */

import {
  ComputerAppId,
  ComputerElementId,
  ComputerUseError,
  ComputerWindowId,
} from '@deepseek-ai/dsh-computer-use'
import type {
  ComputerActionMetadata,
  ComputerApp,
  ComputerCapabilities,
  ComputerElement,
  ComputerObservationTruncation,
  ComputerScreenshotStatus,
  ComputerWindow,
} from '@deepseek-ai/dsh-computer-use'

type JsonRecord = Record<string, unknown>

/** Parsed success or failure envelope with the issuing runtime generation. */
export type CinlanComputerEnvelope =
  | { readonly ok: true; readonly result: unknown; readonly runtimeId: string }
  | {
    readonly ok: false
    readonly error: { readonly code: string; readonly message: string; readonly nextSteps: readonly string[] }
    readonly runtimeId: string
  }

/** Screenshot source emitted by the CLI before bounded file/base64 ingestion. */
export interface ParsedScreenshotSource {
  readonly format: 'png'
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly data?: string
  readonly path?: string
  readonly dataOmitted?: boolean
  readonly expiresAt?: string
}

/** Parsed observation data before a fresh Harness observation id is assigned. */
export interface ParsedObservationResult {
  readonly sourceId: string
  readonly app: ComputerApp
  readonly window: ComputerWindow
  readonly tree: string
  readonly elements: readonly ComputerElement[]
  readonly focusedElementId: ReturnType<typeof ComputerElementId> | null
  readonly truncation?: ComputerObservationTruncation
  readonly screenshot?: ParsedScreenshotSource
  readonly screenshotStatus: ComputerScreenshotStatus
}

/** Parsed post-action observation and redacted provider metadata. */
export interface ParsedActionResult extends ParsedObservationResult {
  readonly action?: ComputerActionMetadata
}

function protocolError(message: string): ComputerUseError {
  return new ComputerUseError(`computer-use-cinlan: ${message}`, 'COMPUTER_CINLAN_PROTOCOL')
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw protocolError(`${label} must be an object`)
  }
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, allowed: readonly string[], label: string): void {
  const known = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw protocolError(`${label}.${key} is not a public response field`)
  }
}

function stringField(value: JsonRecord, key: string, label: string, nonEmpty = false): string {
  const field = value[key]
  if (typeof field !== 'string' || (nonEmpty && field.length === 0)) {
    throw protocolError(`${label}.${key} must be ${nonEmpty ? 'a non-empty string' : 'a string'}`)
  }
  return field
}

function optionalString(value: JsonRecord, key: string, label: string): string | undefined {
  const field = value[key]
  if (field === undefined) return undefined
  if (typeof field !== 'string') throw protocolError(`${label}.${key} must be a string or absent`)
  return field
}

function nullableString(value: JsonRecord, key: string, label: string): string | null {
  const field = value[key]
  if (field === null) return null
  if (typeof field !== 'string') throw protocolError(`${label}.${key} must be a string or null`)
  return field
}

function booleanField(value: JsonRecord, key: string, label: string): boolean {
  const field = value[key]
  if (typeof field !== 'boolean') throw protocolError(`${label}.${key} must be a boolean`)
  return field
}

function optionalBoolean(value: JsonRecord, key: string, label: string): boolean | undefined {
  const field = value[key]
  /* v8 ignore next -- callers test field presence before invoking this optional parser. */
  if (field === undefined) return undefined
  if (typeof field !== 'boolean') throw protocolError(`${label}.${key} must be a boolean or absent`)
  return field
}

function nullableBoolean(value: JsonRecord, key: string, label: string): boolean | null {
  const field = value[key]
  if (field === null) return null
  if (typeof field !== 'boolean') throw protocolError(`${label}.${key} must be a boolean or null`)
  return field
}

function finiteNumber(value: JsonRecord, key: string, label: string): number {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isFinite(field)) {
    throw protocolError(`${label}.${key} must be a finite number`)
  }
  return field
}

function nonNegativeInteger(value: JsonRecord, key: string, label: string): number {
  const field = value[key]
  if (!Number.isSafeInteger(field) || (field as number) < 0) {
    throw protocolError(`${label}.${key} must be a non-negative safe integer`)
  }
  return field as number
}

function positiveInteger(value: JsonRecord, key: string, label: string): number {
  const field = nonNegativeInteger(value, key, label)
  if (field === 0) throw protocolError(`${label}.${key} must be positive`)
  return field
}

function nullableInteger(value: JsonRecord, key: string, label: string): number | null {
  const field = value[key]
  if (field === null) return null
  if (!Number.isSafeInteger(field) || (field as number) < 0) {
    throw protocolError(`${label}.${key} must be a non-negative safe integer or null`)
  }
  return field as number
}

function optionalNullableInteger(value: JsonRecord, key: string, label: string): number | null | undefined {
  if (value[key] === undefined) return undefined
  return nullableInteger(value, key, label)
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw protocolError(`${label} must be an array of strings`)
  }
  return value as string[]
}

/**
 * Parse one complete CLI stdout value as the public JSON envelope.
 * @param text Complete UTF-8 stdout text.
 * @returns Validated success or failure envelope.
 */
export function parseCinlanComputerEnvelope(text: string): CinlanComputerEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    /* v8 ignore next -- JSON.parse throws Error instances. */
    throw protocolError(`stdout is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const root = record(parsed, 'response')
  stringField(root, 'id', 'response', true)
  const ok = booleanField(root, 'ok', 'response')
  const meta = record(root._meta, 'response._meta')
  exactKeys(meta, ['runtimeId'], 'response._meta')
  const runtimeId = stringField(meta, 'runtimeId', 'response._meta', true)
  if (ok) {
    exactKeys(root, ['id', 'ok', 'result', '_meta'], 'response')
    if (!Object.hasOwn(root, 'result')) throw protocolError('response.result is required')
    return { ok: true, result: root.result, runtimeId }
  }
  exactKeys(root, ['id', 'ok', 'error', '_meta'], 'response')
  const error = record(root.error, 'response.error')
  exactKeys(error, ['code', 'message', 'data'], 'response.error')
  let nextSteps: readonly string[] = []
  if (error.data !== undefined) {
    const data = record(error.data, 'response.error.data')
    if (data.nextSteps !== undefined) nextSteps = stringArray(data.nextSteps, 'response.error.data.nextSteps')
  }
  return {
    ok: false,
    error: {
      code: stringField(error, 'code', 'response.error', true),
      message: stringField(error, 'message', 'response.error', true),
      nextSteps,
    },
    runtimeId,
  }
}

function platform(value: unknown): NodeJS.Platform {
  const platforms = new Set<NodeJS.Platform>([
    'aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd',
  ])
  if (typeof value !== 'string' || !platforms.has(value as NodeJS.Platform)) {
    throw protocolError('result.platform must be a known Node platform')
  }
  return value as NodeJS.Platform
}

function booleans(value: unknown, keys: readonly string[], label: string): Record<string, boolean> {
  const item = record(value, label)
  exactKeys(item, keys, label)
  return Object.fromEntries(keys.map(key => [key, booleanField(item, key, label)]))
}

/**
 * Parse `cinlan computer capabilities --json` result data.
 * @param value Untrusted result value.
 * @returns Validated provider capabilities.
 */
export function parseCapabilities(value: unknown): ComputerCapabilities {
  const result = record(value, 'result')
  exactKeys(result, ['platform', 'provider', 'providerVersion', 'protocolVersion', 'supports'], 'result')
  const supports = record(result.supports, 'result.supports')
  exactKeys(supports, ['apps', 'windows', 'observation', 'actions', 'surfaces'], 'result.supports')
  return {
    platform: platform(result.platform),
    provider: stringField(result, 'provider', 'result', true),
    providerVersion: stringField(result, 'providerVersion', 'result', true),
    protocolVersion: positiveInteger(result, 'protocolVersion', 'result'),
    supports: {
      apps: booleans(supports.apps, ['list', 'bundleIds', 'pids'], 'result.supports.apps') as ComputerCapabilities['supports']['apps'],
      windows: booleans(supports.windows, ['list', 'targetById', 'targetByIndex', 'focus', 'moveResize'], 'result.supports.windows') as ComputerCapabilities['supports']['windows'],
      observation: booleans(supports.observation, ['screenshot', 'annotatedScreenshot', 'elementFrames', 'ocr'], 'result.supports.observation') as ComputerCapabilities['supports']['observation'],
      actions: booleans(supports.actions, ['click', 'typeText', 'pressKey', 'hotkey', 'pasteText', 'scroll', 'drag', 'setValue', 'performAction'], 'result.supports.actions') as ComputerCapabilities['supports']['actions'],
      surfaces: booleans(supports.surfaces, ['menus', 'dialogs', 'dock', 'menubar'], 'result.supports.surfaces') as ComputerCapabilities['supports']['surfaces'],
    },
  }
}

function rawApp(value: unknown, label: string): { name: string; bundleId: string | null; pid: number } {
  const item = record(value, label)
  exactKeys(item, ['name', 'bundleId', 'pid'], label)
  return {
    name: stringField(item, 'name', label, true),
    bundleId: nullableString(item, 'bundleId', label),
    pid: positiveInteger(item, 'pid', label),
  }
}

function appId(app: { bundleId: string | null; pid: number }): ReturnType<typeof ComputerAppId> {
  return ComputerAppId(app.bundleId === null || app.bundleId.length === 0 ? `pid:${app.pid}` : app.bundleId)
}

function app(value: unknown, label: string): ComputerApp {
  const item = record(value, label)
  exactKeys(item, ['name', 'bundleId', 'pid', 'isRunning', 'lastUsedAt', 'useCount'], label)
  const base = rawApp({ name: item.name, bundleId: item.bundleId, pid: item.pid }, label)
  return {
    appId: appId(base),
    ...base,
    running: booleanField(item, 'isRunning', label),
    lastUsedAt: nullableString(item, 'lastUsedAt', label),
    useCount: nullableInteger(item, 'useCount', label),
  }
}

/**
 * Parse `cinlan computer list-apps --json` result data.
 * @param value Untrusted result value.
 * @returns Validated applications with stable Harness ids.
 */
export function parseListApps(value: unknown): readonly ComputerApp[] {
  const result = record(value, 'result')
  exactKeys(result, ['apps'], 'result')
  if (!Array.isArray(result.apps)) throw protocolError('result.apps must be an array')
  const apps = result.apps.map((value, index) => app(value, `result.apps[${index}]`))
  const ids = new Set<string>()
  for (const item of apps) {
    if (ids.has(item.appId)) throw protocolError(`result.apps contains duplicate app id '${item.appId}'`)
    ids.add(item.appId)
  }
  return apps
}

function windowId(id: number | null | undefined, index: number | null | undefined): ReturnType<typeof ComputerWindowId> {
  if (id !== undefined && id !== null) return ComputerWindowId(`id:${id}`)
  if (index !== undefined && index !== null) return ComputerWindowId(`index:${index}`)
  throw protocolError('window must publish id or index')
}

function optionalNullableNumber(value: JsonRecord, key: string, label: string): number | null {
  const field = value[key]
  if (field === undefined || field === null) return null
  if (typeof field !== 'number' || !Number.isFinite(field)) {
    throw protocolError(`${label}.${key} must be a finite number, null, or absent`)
  }
  return field
}

function window(value: unknown, label: string, owner: ReturnType<typeof ComputerAppId>, mainAllowed: boolean): ComputerWindow {
  const item = record(value, label)
  exactKeys(item, [
    'id', 'index', 'title', 'x', 'y', 'width', 'height', 'isMinimized', 'isOffscreen', 'screenIndex', 'platform',
    ...(mainAllowed ? ['app', 'isMain'] : []),
  ], label)
  if (item.platform !== undefined && (typeof item.platform !== 'object' || item.platform === null || Array.isArray(item.platform))) {
    throw protocolError(`${label}.platform must be an object or absent`)
  }
  return {
    windowId: windowId(optionalNullableInteger(item, 'id', label), optionalNullableInteger(item, 'index', label)),
    appId: owner,
    title: stringField(item, 'title', label),
    x: optionalNullableNumber(item, 'x', label),
    y: optionalNullableNumber(item, 'y', label),
    width: positiveInteger(item, 'width', label),
    height: positiveInteger(item, 'height', label),
    minimized: item.isMinimized === undefined ? null : nullableBoolean(item, 'isMinimized', label),
    offscreen: item.isOffscreen === undefined ? null : nullableBoolean(item, 'isOffscreen', label),
    screenIndex: item.screenIndex === undefined ? null : nullableInteger(item, 'screenIndex', label),
    main: mainAllowed && item.isMain !== undefined ? nullableBoolean(item, 'isMain', label) : null,
  }
}

/**
 * Parse `cinlan computer list-windows --json` result data.
 * @param value Untrusted result value.
 * @returns Validated windows with stable Harness ids.
 */
export function parseListWindows(value: unknown): readonly ComputerWindow[] {
  const result = record(value, 'result')
  exactKeys(result, ['app', 'windows'], 'result')
  const owner = rawApp(result.app, 'result.app')
  const ownerId = appId(owner)
  if (!Array.isArray(result.windows)) throw protocolError('result.windows must be an array')
  const windows = result.windows.map((value, index) => {
    const item = record(value, `result.windows[${index}]`)
    const listedApp = rawApp(item.app, `result.windows[${index}].app`)
    if (appId(listedApp) !== ownerId) throw protocolError(`result.windows[${index}].app does not match result.app`)
    return window(value, `result.windows[${index}]`, ownerId, true)
  })
  const ids = new Set<string>()
  for (const item of windows) {
    if (ids.has(item.windowId)) throw protocolError(`result.windows contains duplicate window id '${item.windowId}'`)
    ids.add(item.windowId)
  }
  return windows
}

function truncation(value: unknown): ComputerObservationTruncation | undefined {
  /* v8 ignore next -- the caller tests field presence before invoking this optional parser. */
  if (value === undefined) return undefined
  const item = record(value, 'result.snapshot.truncation')
  exactKeys(item, ['truncated', 'maxNodes', 'maxDepth', 'maxDepthReached'], 'result.snapshot.truncation')
  return {
    truncated: booleanField(item, 'truncated', 'result.snapshot.truncation'),
    ...(item.maxNodes === undefined ? {} : { maxNodes: positiveInteger(item, 'maxNodes', 'result.snapshot.truncation') }),
    ...(item.maxDepth === undefined ? {} : { maxDepth: positiveInteger(item, 'maxDepth', 'result.snapshot.truncation') }),
    ...(item.maxDepthReached === undefined ? {} : { maxDepthReached: booleanField(item, 'maxDepthReached', 'result.snapshot.truncation') }),
  }
}

function elements(tree: string): readonly ComputerElement[] {
  const found: ComputerElement[] = []
  const ids = new Set<number>()
  const pattern = /(?:^|\n)[\t ]*(\d+)[\t ]+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(tree)) !== null) {
    const index = Number(match[1])
    if (!Number.isSafeInteger(index) || index < 0 || ids.has(index)) {
      throw protocolError(`result.snapshot.treeText contains invalid or duplicate element index '${match[1]}'`)
    }
    ids.add(index)
    found.push({ elementId: ComputerElementId(String(index)), index })
  }
  return found
}

function screenshot(value: unknown): ParsedScreenshotSource | undefined {
  if (value === null) return undefined
  const item = record(value, 'result.screenshot')
  exactKeys(item, ['data', 'format', 'width', 'height', 'scale', 'path', 'dataOmitted', 'expiresAt'], 'result.screenshot')
  if (stringField(item, 'format', 'result.screenshot') !== 'png') {
    throw protocolError('result.screenshot.format must be "png"')
  }
  const data = optionalString(item, 'data', 'result.screenshot')
  const path = optionalString(item, 'path', 'result.screenshot')
  const dataOmitted = optionalBoolean(item, 'dataOmitted', 'result.screenshot')
  const expiresAt = optionalString(item, 'expiresAt', 'result.screenshot')
  if (data === undefined && path === undefined) throw protocolError('result.screenshot must publish data or path')
  return {
    format: 'png',
    width: positiveInteger(item, 'width', 'result.screenshot'),
    height: positiveInteger(item, 'height', 'result.screenshot'),
    scale: finiteNumber(item, 'scale', 'result.screenshot'),
    ...(data === undefined ? {} : { data }),
    ...(path === undefined ? {} : { path }),
    ...(dataOmitted === undefined ? {} : { dataOmitted }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

function screenshotStatus(value: unknown): ComputerScreenshotStatus {
  const item = record(value, 'result.screenshotStatus')
  const state = stringField(item, 'state', 'result.screenshotStatus', true)
  if (state === 'captured') {
    exactKeys(item, ['state', 'metadata'], 'result.screenshotStatus')
    return { state }
  }
  if (state === 'skipped') {
    exactKeys(item, ['state', 'reason'], 'result.screenshotStatus')
    if (stringField(item, 'reason', 'result.screenshotStatus') !== 'no_screenshot_flag') {
      throw protocolError('result.screenshotStatus.reason must be "no_screenshot_flag"')
    }
    return { state, reason: 'no_screenshot_flag' }
  }
  if (state === 'failed') {
    exactKeys(item, ['state', 'code', 'message', 'metadata'], 'result.screenshotStatus')
    return {
      state,
      code: stringField(item, 'code', 'result.screenshotStatus', true),
      message: stringField(item, 'message', 'result.screenshotStatus', true),
    }
  }
  throw protocolError('result.screenshotStatus.state is unsupported')
}

function observation(value: unknown): ParsedObservationResult {
  const result = record(value, 'result')
  exactKeys(result, ['snapshot', 'screenshot', 'screenshotStatus', 'action'], 'result')
  const snapshot = record(result.snapshot, 'result.snapshot')
  exactKeys(snapshot, ['id', 'app', 'window', 'coordinateSpace', 'treeText', 'elementCount', 'focusedElementId', 'truncation'], 'result.snapshot')
  if (stringField(snapshot, 'coordinateSpace', 'result.snapshot') !== 'window') {
    throw protocolError('result.snapshot.coordinateSpace must be "window"')
  }
  const rawOwner = rawApp(snapshot.app, 'result.snapshot.app')
  const owner: ComputerApp = {
    appId: appId(rawOwner),
    ...rawOwner,
    running: true,
    lastUsedAt: null,
    useCount: null,
  }
  const tree = stringField(snapshot, 'treeText', 'result.snapshot')
  const parsedElements = elements(tree)
  if (nonNegativeInteger(snapshot, 'elementCount', 'result.snapshot') < parsedElements.length) {
    throw protocolError('result.snapshot.elementCount is smaller than the published tree element count')
  }
  const focused = nullableInteger(snapshot, 'focusedElementId', 'result.snapshot')
  const parsedScreenshot = screenshot(result.screenshot)
  const status = screenshotStatus(result.screenshotStatus)
  const parsedTruncation = truncation(snapshot.truncation)
  if ((parsedScreenshot === undefined) !== (status.state !== 'captured')) {
    throw protocolError('result screenshot and screenshotStatus disagree')
  }
  return {
    sourceId: stringField(snapshot, 'id', 'result.snapshot', true),
    app: owner,
    window: window(snapshot.window, 'result.snapshot.window', owner.appId, false),
    tree,
    elements: parsedElements,
    focusedElementId: focused === null ? null : ComputerElementId(String(focused)),
    ...(parsedTruncation === undefined ? {} : { truncation: parsedTruncation }),
    ...(parsedScreenshot === undefined ? {} : { screenshot: parsedScreenshot }),
    screenshotStatus: status,
  }
}

/**
 * Parse `cinlan computer get-app-state --json` result data.
 * @param value Untrusted result value.
 * @returns Validated accessibility observation.
 */
export function parseObservation(value: unknown): ParsedObservationResult {
  const parsed = observation(value)
  const result = record(value, 'result')
  if (result.action !== undefined) throw protocolError('get-app-state result.action must be absent')
  return parsed
}

function nullableOptionalString(value: JsonRecord, key: string, label: string): string | null {
  const field = value[key]
  if (field === undefined || field === null) return null
  if (typeof field !== 'string') throw protocolError(`${label}.${key} must be a string, null, or absent`)
  return field
}

function action(value: unknown): ComputerActionMetadata | undefined {
  if (value === undefined) return undefined
  const item = record(value, 'result.action')
  exactKeys(item, ['path', 'actionName', 'fallbackReason', 'targetWindowId', 'targetWindowIndex', 'verification'], 'result.action')
  const path = stringField(item, 'path', 'result.action', true)
  if (path !== 'accessibility' && path !== 'synthetic' && path !== 'clipboard') {
    throw protocolError('result.action.path is unsupported')
  }
  optionalNullableInteger(item, 'targetWindowId', 'result.action')
  optionalNullableInteger(item, 'targetWindowIndex', 'result.action')
  let verification: ComputerActionMetadata['verification']
  if (item.verification !== undefined) {
    const verify = record(item.verification, 'result.action.verification')
    exactKeys(verify, ['state', 'property', 'reason', 'expected', 'actualPreview'], 'result.action.verification')
    nullableOptionalString(verify, 'expected', 'result.action.verification')
    nullableOptionalString(verify, 'actualPreview', 'result.action.verification')
    const state = stringField(verify, 'state', 'result.action.verification', true)
    if (state === 'verified') {
      const property = stringField(verify, 'property', 'result.action.verification', true)
      if (property !== 'focusedText' && property !== 'selection' && property !== 'value') {
        throw protocolError('result.action.verification.property is unsupported')
      }
      verification = { state, property }
    } else if (state === 'unverified') {
      const reason = stringField(verify, 'reason', 'result.action.verification', true)
      if (reason !== 'synthetic_input' && reason !== 'clipboard_paste' && reason !== 'provider_unavailable'
        && reason !== 'window_changed' && reason !== 'value_mismatch') {
        throw protocolError('result.action.verification.reason is unsupported')
      }
      verification = { state, reason }
    } else {
      throw protocolError('result.action.verification.state is unsupported')
    }
  }
  return {
    path,
    actionName: nullableOptionalString(item, 'actionName', 'result.action'),
    fallbackReason: nullableOptionalString(item, 'fallbackReason', 'result.action'),
    ...(verification === undefined ? {} : { verification }),
  }
}

/**
 * Parse one `cinlan computer` action result.
 * @param value Untrusted result value.
 * @returns Validated post-action observation and metadata.
 */
export function parseAction(value: unknown): ParsedActionResult {
  const parsed = observation(value)
  const result = record(value, 'result')
  const parsedAction = action(result.action)
  return { ...parsed, ...(parsedAction === undefined ? {} : { action: parsedAction }) }
}
