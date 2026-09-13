/** Strict parser for the public `cinlan ... --json` browser command responses. */

import {
  BrowserElementId,
  BrowserError,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type {
  BrowserElement,
  BrowserPage,
  BrowserScreenshotFormat,
} from '@deepseek-ai/dsh-browser'

type JsonRecord = Record<string, unknown>

/**
 * Parsed success or failure envelope with the issuing runtime generation. A
 * successful call always names its runtime; a failed call reports `null`
 * when the Cinlan runtime is unavailable and no generation exists yet (for
 * example `browser_runtime_unavailable`).
 */
export type CinlanEnvelope =
  | { readonly ok: true; readonly result: unknown; readonly runtimeId: string }
  | {
    readonly ok: false
    readonly error: { readonly code: string; readonly message: string }
    readonly runtimeId: string | null
  }

function protocolError(message: string): BrowserError {
  return new BrowserError(`browser-cinlan: ${message}`, 'BROWSER_CINLAN_PROTOCOL')
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw protocolError(`${label} must be an object`)
  }
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw protocolError(`${label}.${key} is not a public response field`)
  }
}

function stringField(value: JsonRecord, key: string, label: string, nonEmpty = false): string {
  const field = value[key]
  if (typeof field !== 'string' || (nonEmpty && field.length === 0)) {
    throw protocolError(`${label}.${key} must be ${nonEmpty ? 'a non-empty string' : 'a string'}`)
  }
  return field
}

function nullableStringField(value: JsonRecord, key: string, label: string, nonEmpty = false): string | null {
  const field = value[key]
  if (field === null) return null
  if (typeof field !== 'string' || (nonEmpty && field.length === 0)) {
    throw protocolError(`${label}.${key} must be ${nonEmpty ? 'a non-empty string or null' : 'a string or null'}`)
  }
  return field
}

function booleanField(value: JsonRecord, key: string, label: string): boolean {
  const field = value[key]
  if (typeof field !== 'boolean') throw protocolError(`${label}.${key} must be a boolean`)
  return field
}

function finiteNumberField(value: JsonRecord, key: string, label: string): number {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isFinite(field)) {
    throw protocolError(`${label}.${key} must be a finite number`)
  }
  return field
}

function nonNegativeIntegerField(value: JsonRecord, key: string, label: string): number {
  const field = value[key]
  if (!Number.isSafeInteger(field) || (field as number) < 0) {
    throw protocolError(`${label}.${key} must be a non-negative safe integer`)
  }
  return field as number
}

function optionalNullableString(value: JsonRecord, key: string, label: string): void {
  const field = value[key]
  if (field !== undefined && field !== null && typeof field !== 'string') {
    throw protocolError(`${label}.${key} must be a string, null, or absent`)
  }
}

function optionalNullableRecord(value: JsonRecord, key: string, label: string): void {
  const field = value[key]
  if (field !== undefined && field !== null
    && (typeof field !== 'object' || Array.isArray(field))) {
    throw protocolError(`${label}.${key} must be an object, null, or absent`)
  }
}

/**
 * Parse one complete CLI stdout value as the public JSON response envelope.
 * A failure envelope's `_meta.runtimeId` may be `null` (no Cinlan runtime
 * generation exists yet, e.g. `browser_runtime_unavailable`); a success
 * envelope always names its runtime.
 * @param text - Complete, bounded stdout from one `cinlan ... --json` process.
 * @returns The strict success/failure envelope and runtime id.
 */
export function parseCinlanEnvelope(text: string): CinlanEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    throw protocolError(`stdout is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const root = record(parsed, 'response')
  stringField(root, 'id', 'response', true)
  const ok = booleanField(root, 'ok', 'response')
  const meta = record(root._meta, 'response._meta')
  exactKeys(meta, ['runtimeId'], 'response._meta')

  if (ok) {
    exactKeys(root, ['id', 'ok', 'result', '_meta'], 'response')
    if (!Object.hasOwn(root, 'result')) throw protocolError('response.result is required')
    return {
      ok: true,
      result: root.result,
      runtimeId: stringField(meta, 'runtimeId', 'response._meta', true),
    }
  }

  exactKeys(root, ['id', 'ok', 'error', '_meta'], 'response')
  const error = record(root.error, 'response.error')
  exactKeys(error, ['code', 'message'], 'response.error')
  return {
    ok: false,
    error: {
      code: stringField(error, 'code', 'response.error', true),
      message: stringField(error, 'message', 'response.error', true),
    },
    runtimeId: nullableStringField(meta, 'runtimeId', 'response._meta', true),
  }
}

function tab(value: unknown, label: string): BrowserPage {
  const item = record(value, label)
  exactKeys(item, [
    'browserPageId',
    'index',
    'url',
    'title',
    'active',
    'loadError',
    'certificateFailure',
    'worktreeId',
    'profileId',
    'profileLabel',
  ], label)
  optionalNullableRecord(item, 'loadError', label)
  optionalNullableRecord(item, 'certificateFailure', label)
  optionalNullableString(item, 'worktreeId', label)
  optionalNullableString(item, 'profileId', label)
  optionalNullableString(item, 'profileLabel', label)
  return {
    pageId: BrowserPageId(stringField(item, 'browserPageId', label, true)),
    index: nonNegativeIntegerField(item, 'index', label),
    url: stringField(item, 'url', label),
    title: stringField(item, 'title', label),
    active: booleanField(item, 'active', label),
  }
}

/**
 * Parse `cinlan tab list --json` result data.
 * @param value - Envelope `result` field.
 * @returns Current browser pages.
 */
export function parseTabListResult(value: unknown): readonly BrowserPage[] {
  const result = record(value, 'result')
  exactKeys(result, ['tabs'], 'result')
  if (!Array.isArray(result.tabs)) throw protocolError('result.tabs must be an array')
  const pages = result.tabs.map((value, index) => tab(value, `result.tabs[${index}]`))
  const ids = new Set<string>()
  for (const page of pages) {
    if (ids.has(page.pageId)) throw protocolError(`result.tabs contains duplicate page id '${page.pageId}'`)
    ids.add(page.pageId)
  }
  return pages
}

/**
 * Parse `cinlan tab create --json` result data.
 * @param value - Envelope `result` field.
 * @returns The created page id.
 */
export function parseTabCreateResult(value: unknown): BrowserPageId {
  const result = record(value, 'result')
  exactKeys(result, ['browserPageId'], 'result')
  return BrowserPageId(stringField(result, 'browserPageId', 'result', true))
}

/** Parsed navigation location from `cinlan goto --json`. */
export interface ParsedNavigateResult {
  readonly url: string
  readonly title: string
}

/**
 * Parse `cinlan goto --json` result data.
 * @param value - Envelope `result` field.
 * @returns Final URL and title.
 */
export function parseNavigateResult(value: unknown): ParsedNavigateResult {
  const result = record(value, 'result')
  exactKeys(result, ['url', 'title'], 'result')
  return {
    url: stringField(result, 'url', 'result'),
    title: stringField(result, 'title', 'result'),
  }
}

/** Parsed accessibility snapshot data. */
export interface ParsedSnapshotResult {
  readonly pageId: BrowserPageId
  readonly tree: string
  readonly url: string
  readonly title: string
  readonly elements: readonly BrowserElement[]
}

/**
 * Parse `cinlan snapshot --json` result data.
 * @param value - Envelope `result` field.
 * @returns Page identity, accessibility tree, and exact element refs.
 */
export function parseSnapshotResult(value: unknown): ParsedSnapshotResult {
  const result = record(value, 'result')
  exactKeys(result, ['browserPageId', 'snapshot', 'refs', 'url', 'title'], 'result')
  if (!Array.isArray(result.refs)) throw protocolError('result.refs must be an array')
  const ids = new Set<string>()
  const elements = result.refs.map((value, index): BrowserElement => {
    const label = `result.refs[${index}]`
    const item = record(value, label)
    exactKeys(item, ['ref', 'role', 'name'], label)
    const elementId = stringField(item, 'ref', label, true)
    if (ids.has(elementId)) throw protocolError(`result.refs contains duplicate element ref '${elementId}'`)
    ids.add(elementId)
    return {
      elementId: BrowserElementId(elementId),
      role: stringField(item, 'role', label),
      name: stringField(item, 'name', label),
    }
  })
  return {
    pageId: BrowserPageId(stringField(result, 'browserPageId', 'result', true)),
    tree: stringField(result, 'snapshot', 'result'),
    url: stringField(result, 'url', 'result'),
    title: stringField(result, 'title', 'result'),
    elements,
  }
}

/**
 * Parse `cinlan click --json` result data.
 * @param value - Envelope `result` field.
 * @returns The clicked raw element ref.
 */
export function parseClickResult(value: unknown): string {
  const result = record(value, 'result')
  exactKeys(result, ['clicked'], 'result')
  return stringField(result, 'clicked', 'result', true)
}

/** Parsed screenshot bytes and encoding. */
export interface ParsedScreenshotResult {
  readonly format: BrowserScreenshotFormat
  readonly data: Uint8Array
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * Parse and bound `cinlan screenshot --json` result data before allocation.
 * @param value - Envelope `result` field.
 * @param maxImageBytes - Maximum decoded image bytes.
 * @returns Strictly decoded image bytes and declared format.
 */
export function parseScreenshotResult(value: unknown, maxImageBytes: number): ParsedScreenshotResult {
  const result = record(value, 'result')
  exactKeys(result, ['data', 'format'], 'result')
  const format = stringField(result, 'format', 'result')
  if (format !== 'png' && format !== 'jpeg') {
    throw protocolError('result.format must be "png" or "jpeg"')
  }
  const encoded = stringField(result, 'data', 'result', true)
  if (!BASE64.test(encoded)) throw protocolError('result.data must be canonical padded base64')
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedBytes = (encoded.length / 4) * 3 - padding
  if (decodedBytes > maxImageBytes) {
    throw new BrowserError(
      `browser-cinlan: screenshot exceeds the configured ${maxImageBytes}-byte limit`,
      'BROWSER_SCREENSHOT_TOO_LARGE',
    )
  }
  const data = Buffer.from(encoded, 'base64')
  if (data.byteLength === 0) throw protocolError('result.data decodes to an empty image')
  if (data.toString('base64') !== encoded) throw protocolError('result.data must be canonical padded base64')
  return { format, data: Uint8Array.from(data) }
}

/**
 * Parse `cinlan tab close --json` result data.
 * @param value - Envelope `result` field.
 * @returns Whether the runtime confirmed closure.
 */
export function parseTabCloseResult(value: unknown): boolean {
  const result = record(value, 'result')
  exactKeys(result, ['closed'], 'result')
  return booleanField(result, 'closed', 'result')
}

/** Parsed `cinlan eval --json` envelope before the injected script's own JSON is decoded. */
export interface ParsedEvalResult {
  /** The injected script's return value, always a JSON-encoded string. */
  readonly result: string
  /** The page origin the script ran against. */
  readonly origin: string
}

/**
 * Parse `cinlan eval --json` result data. The injected script always resolves
 * with `JSON.stringify(...)` of its payload, so `result` is itself JSON text
 * that a caller decodes with {@link parseElementCapturePayload}.
 * @param value - Envelope `result` field.
 * @returns The script's raw string result and the page origin it ran against.
 */
export function parseEvalResult(value: unknown): ParsedEvalResult {
  const result = record(value, 'result')
  exactKeys(result, ['result', 'origin'], 'result')
  return {
    result: stringField(result, 'result', 'result'),
    origin: stringField(result, 'origin', 'result'),
  }
}

/** Element fingerprint captured by an injected overlay or verification script. */
export interface RawElementFingerprint {
  readonly tagName: string
  readonly role: string
  readonly name: string
  readonly text: string
}

/** Viewport-relative rectangle reported by an injected page script. */
export interface RawElementRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function rectField(value: JsonRecord, key: string, label: string): RawElementRect {
  const rect = record(value[key], `${label}.${key}`)
  exactKeys(rect, ['x', 'y', 'width', 'height'], `${label}.${key}`)
  return {
    x: finiteNumberField(rect, 'x', `${label}.${key}`),
    y: finiteNumberField(rect, 'y', `${label}.${key}`),
    width: finiteNumberField(rect, 'width', `${label}.${key}`),
    height: finiteNumberField(rect, 'height', `${label}.${key}`),
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw protocolError(`${label} is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

/**
 * One element capture payload decoded from an `orca eval` result string:
 * fingerprint, viewport-relative rect, and the viewport size it was measured
 * against. The overlay-selection and marker-verification scripts in
 * `scripts.ts` both resolve with this exact shape, so one parser covers both.
 */
export interface RawElementCapture extends RawElementFingerprint {
  readonly rect: RawElementRect
  readonly viewport: { readonly width: number; readonly height: number }
}

/**
 * Decode one overlay-selection or marker-verification script's
 * JSON-stringified return value.
 * @param text - The `result` string from {@link parseEvalResult}.
 * @returns The raw fingerprint, rect, and viewport, or `null` for
 *   cancellation (selection) or when the marker no longer identifies exactly
 *   one visible element (verification).
 */
export function parseElementCapturePayload(text: string): RawElementCapture | null {
  const parsed = parseJson(text, 'eval result')
  if (parsed === null) return null
  const value = record(parsed, 'eval result')
  exactKeys(value, ['tagName', 'role', 'name', 'text', 'rect', 'viewport'], 'eval result')
  const viewport = record(value.viewport, 'eval result.viewport')
  exactKeys(viewport, ['width', 'height'], 'eval result.viewport')
  return {
    tagName: stringField(value, 'tagName', 'eval result', true),
    role: stringField(value, 'role', 'eval result'),
    name: stringField(value, 'name', 'eval result'),
    text: stringField(value, 'text', 'eval result'),
    rect: rectField(value, 'rect', 'eval result'),
    viewport: {
      width: finiteNumberField(viewport, 'width', 'eval result.viewport'),
      height: finiteNumberField(viewport, 'height', 'eval result.viewport'),
    },
  }
}
