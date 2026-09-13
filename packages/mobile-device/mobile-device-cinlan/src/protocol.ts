/** Strict parser for the public Cinlan mobile-emulator JSON protocol. */

import {
  MobileDeviceError,
  MobileDeviceGeneration,
  MobileDeviceId,
  MobileObservationId,
} from '@deepseek-ai/dsh-mobile-device'
import type {
  MobileDevice,
  MobileObservation,
  MobileScreenshot,
  MobileScreenshotStatus,
} from '@deepseek-ai/dsh-mobile-device'

interface JsonRecord {
  readonly [key: string]: unknown
}

/** Validated success or failure envelope returned by the public Cinlan CLI. */
export type CinlanMobileEnvelope =
  | { readonly ok: true; readonly result: unknown; readonly runtimeId: string }
  | {
    readonly ok: false
    readonly error: { readonly code: string; readonly message: string; readonly nextSteps: readonly string[] }
    readonly runtimeId: string
  }

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function protocolError(message: string): MobileDeviceError {
  return new MobileDeviceError(`mobile-device-cinlan: ${message}`, 'MOBILE_CINLAN_PROTOCOL')
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw protocolError(`${label} must be an object`)
  }
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw protocolError(`${label}.${key} is unsupported`)
  }
}

function stringField(value: JsonRecord, key: string, label: string, nonEmpty = false): string {
  const field = value[key]
  if (typeof field !== 'string' || (nonEmpty && field.length === 0)) {
    throw protocolError(`${label}.${key} must be ${nonEmpty ? 'a non-empty ' : 'a '}string`)
  }
  return field
}

function optionalString(value: JsonRecord, key: string, label: string): string | undefined {
  if (value[key] === undefined) return undefined
  return stringField(value, key, label, true)
}

function booleanField(value: JsonRecord, key: string, label: string): boolean {
  const field = value[key]
  if (typeof field !== 'boolean') throw protocolError(`${label}.${key} must be a boolean`)
  return field
}

function positiveInteger(value: JsonRecord, key: string, label: string): number {
  const field = value[key]
  if (!Number.isSafeInteger(field) || (field as number) < 1) {
    throw protocolError(`${label}.${key} must be a positive safe integer`)
  }
  return field as number
}

function protocolVersion(value: JsonRecord, label: string): void {
  if (value.protocolVersion !== 1) throw protocolError(`${label}.protocolVersion must be 1`)
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
export function parseCinlanMobileEnvelope(text: string): CinlanMobileEnvelope {
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
    exactKeys(data, ['nextSteps'], 'response.error.data')
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

function device(value: unknown, label: string): MobileDevice {
  const item = record(value, label)
  exactKeys(item, ['backend', 'id', 'name', 'state', 'isAvailable', 'detail'], label)
  const backend = stringField(item, 'backend', label, true)
  if (backend !== 'ios' && backend !== 'android') {
    throw protocolError(`${label}.backend must be "ios" or "android"`)
  }
  const state = stringField(item, 'state', label, true)
  if (state !== 'shutdown' && state !== 'booting' && state !== 'booted') {
    throw protocolError(`${label}.state must be "shutdown", "booting", or "booted"`)
  }
  const detail = optionalString(item, 'detail', label)
  return {
    backend,
    id: MobileDeviceId(stringField(item, 'id', label, true)),
    name: stringField(item, 'name', label, true),
    state,
    isAvailable: booleanField(item, 'isAvailable', label),
    ...(detail === undefined ? {} : { detail }),
  }
}

/**
 * Parse `cinlan emulator devices --json` result data.
 * @param value Untrusted result value.
 * @returns Validated canonical devices.
 */
export function parseDevices(value: unknown): readonly MobileDevice[] {
  if (!Array.isArray(value)) throw protocolError('result must be an array')
  const devices = value.map((item, index) => device(item, `result[${index}]`))
  const ids = new Set<string>()
  for (const item of devices) {
    if (ids.has(item.id)) throw protocolError(`result contains duplicate device id '${item.id}'`)
    ids.add(item.id)
  }
  return devices
}

function screenshotStatus(value: unknown): MobileScreenshotStatus {
  const item = record(value, 'result.screenshotStatus')
  const state = stringField(item, 'state', 'result.screenshotStatus', true)
  if (state === 'captured') {
    exactKeys(item, ['state'], 'result.screenshotStatus')
    return { state }
  }
  if (state === 'skipped') {
    exactKeys(item, ['state'], 'result.screenshotStatus')
    return { state }
  }
  if (state === 'failed') {
    exactKeys(item, ['state', 'code', 'message'], 'result.screenshotStatus')
    const code = stringField(item, 'code', 'result.screenshotStatus', true)
    if (![
      'emulator_screenshot_failed',
      'emulator_screenshot_invalid',
      'emulator_screenshot_too_large',
      'emulator_screenshot_unsupported',
    ].includes(code)) {
      throw protocolError('result.screenshotStatus.code is unsupported')
    }
    return {
      state,
      code,
      message: stringField(item, 'message', 'result.screenshotStatus', true),
    }
  }
  throw protocolError('result.screenshotStatus.state is unsupported')
}

function decodePng(value: unknown, maxImageBytes: number): MobileScreenshot {
  const item = record(value, 'result.screenshot')
  exactKeys(item, ['mediaType', 'dataBase64', 'width', 'height'], 'result.screenshot')
  if (stringField(item, 'mediaType', 'result.screenshot') !== 'image/png') {
    throw protocolError('result.screenshot.mediaType must be "image/png"')
  }
  const encoded = stringField(item, 'dataBase64', 'result.screenshot', true)
  if (!BASE64.test(encoded)) throw protocolError('result.screenshot.dataBase64 must be canonical padded base64')
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedBytes = (encoded.length / 4) * 3 - padding
  if (decodedBytes > maxImageBytes) {
    throw new MobileDeviceError(
      `mobile-device-cinlan: screenshot exceeds the configured ${maxImageBytes}-byte limit`,
      'MOBILE_SCREENSHOT_TOO_LARGE',
    )
  }
  const data = Uint8Array.from(Buffer.from(encoded, 'base64'))
  if (data.byteLength < 24 || PNG_MAGIC.some((byte, index) => data[index] !== byte)) {
    throw protocolError('result.screenshot.dataBase64 is not a PNG image')
  }
  if (String.fromCharCode(...data.slice(12, 16)) !== 'IHDR') {
    throw protocolError('result.screenshot.dataBase64 has no PNG IHDR header')
  }
  const width = positiveInteger(item, 'width', 'result.screenshot')
  const height = positiveInteger(item, 'height', 'result.screenshot')
  const header = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (header.readUInt32BE(16) !== width || header.readUInt32BE(20) !== height) {
    throw protocolError('result.screenshot dimensions do not match its PNG IHDR header')
  }
  return { mediaType: 'image/png', data, width, height }
}

/**
 * Parse `cinlan emulator observe --json` result data.
 * @param value Untrusted result value.
 * @param maxTreeBytes Maximum accepted UTF-8 tree length.
 * @param maxImageBytes Maximum accepted decoded PNG length.
 * @returns Validated protocol-v1 observation.
 */
export function parseObservation(
  value: unknown,
  maxTreeBytes: number,
  maxImageBytes: number,
): MobileObservation {
  const result = record(value, 'result')
  exactKeys(result, [
    'protocolVersion', 'device', 'deviceGeneration', 'observationId', 'coordinateSpace',
    'tree', 'screenshot', 'screenshotStatus',
  ], 'result')
  protocolVersion(result, 'result')
  if (stringField(result, 'coordinateSpace', 'result') !== 'normalized') {
    throw protocolError('result.coordinateSpace must be "normalized"')
  }
  const tree = stringField(result, 'tree', 'result')
  if (Buffer.byteLength(tree, 'utf8') > maxTreeBytes) {
    throw new MobileDeviceError(
      `mobile-device-cinlan: observation tree exceeds the configured ${maxTreeBytes}-byte limit`,
      'MOBILE_TREE_TOO_LARGE',
    )
  }
  const status = screenshotStatus(result.screenshotStatus)
  const screenshot = result.screenshot === undefined ? undefined : decodePng(result.screenshot, maxImageBytes)
  if ((screenshot === undefined) !== (status.state !== 'captured')) {
    throw protocolError('result.screenshot and result.screenshotStatus disagree')
  }
  return {
    device: device(result.device, 'result.device'),
    deviceGeneration: MobileDeviceGeneration(stringField(result, 'deviceGeneration', 'result', true)),
    observationId: MobileObservationId(stringField(result, 'observationId', 'result', true)),
    coordinateSpace: 'normalized',
    tree,
    ...(screenshot === undefined ? {} : { screenshot }),
    screenshotStatus: status,
  }
}

/**
 * Parse one `cinlan emulator` mutation acknowledgement.
 * @param value Untrusted result value.
 * @returns Validated acknowledgement.
 */
export function parseAcknowledgement(value: unknown): { readonly ok: true } {
  const result = record(value, 'result')
  exactKeys(result, ['ok'], 'result')
  if (result.ok !== true) throw protocolError('result.ok must be true')
  return { ok: true }
}
