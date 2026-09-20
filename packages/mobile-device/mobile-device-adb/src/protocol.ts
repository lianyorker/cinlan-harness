/** ADB text and screenshot validation; callers bound subprocess output before parsing. */
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import sharp from 'sharp'
import { MobileDeviceError, MobileDeviceId, type MobileDevice, type MobileScreenshot } from '@deepseek-ai/dsh-mobile-device'

/** An exact ADB selector and its provider-neutral device record. */
export interface AdbDevice {
  readonly serial: string
  readonly transportId: string | null
  readonly device: MobileDevice
}

function protocolError(): MobileDeviceError {
  return new MobileDeviceError('The Android device returned invalid protocol data.', 'MOBILE_ADB_PROTOCOL')
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function lines(text: string): string[] {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /\r(?!\n)/.test(text)) throw protocolError()
  return text.replace(/\r\n/g, '\n').trimEnd().split('\n')
}
const DEVICE_STATES = new Set(['device', 'offline', 'unauthorized', 'recovery', 'sideload', 'bootloader', 'authorizing', 'connecting'])

/** Parse complete adb devices -l output without choosing an implicit device.
 * @param text - Caller-bounded stdout, including the exact ADB list header.
 * @returns Listed devices; only device state with a valid transport id is available.
 * @throws MobileDeviceError for malformed rows, unsafe selectors, or duplicate identities.
 */
export function parseDevices(text: string): readonly AdbDevice[] {
  const [header, ...rows] = lines(text)
  if (header !== 'List of devices attached') throw protocolError()
  const serials = new Set<string>()
  const transports = new Set<string>()
  return rows.filter(line => line.trim().length > 0).map((line) => {
    const [serial, state, ...fields] = line.trim().split(/[ \t]+/)
    if (serial === undefined || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(serial) || serials.has(serial)
      || state === undefined || !DEVICE_STATES.has(state)) throw protocolError()
    serials.add(serial)
    const metadata = new Map<string, string>()
    for (const field of fields) {
      const match = /^([a-z_]+):([^\s:]+)$/.exec(field)
      const key = match?.[1]
      const value = match?.[2]
      if (key === undefined || value === undefined || metadata.has(key)) throw protocolError()
      metadata.set(key, value)
    }
    const transportId = metadata.get('transport_id') ?? null
    if (transportId !== null) {
      if (!/^[1-9][0-9]*$/.test(transportId) || !Number.isSafeInteger(Number(transportId))
        || transports.has(transportId)) throw protocolError()
      transports.add(transportId)
    }
    return { serial, transportId, device: {
      id: MobileDeviceId('android:' + serial), backend: 'android', name: metadata.get('model')?.replaceAll('_', ' ') ?? serial,
      state, isAvailable: state === 'device' && transportId !== null,
    } }
  })
}

/** Validate a UI Automator hierarchy without replacing its original XML representation.
 * @param xml - Raw XML already bounded by the subprocess caller; no trimming or tree rewriting occurs.
 * @returns Original XML and its declared display rotation.
 * @throws MobileDeviceError for malformed XML, declarations of entities, wrong roots, or unsupported rotation.
 */
export function parseHierarchy(xml: string): { tree: string; rotation: 0 | 1 | 2 | 3 } {
  try {
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(xml)
      || XMLValidator.validate(xml) !== true) throw protocolError()
    const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false,
      processEntities: false, ignoreDeclaration: false, ignorePiTags: false })
    const parsed: unknown = parser.parse(xml)
    if (!record(parsed) || Object.keys(parsed).some(key => key !== 'hierarchy' && key !== '?xml') || !record(parsed.hierarchy)) throw protocolError()
    const declaration = parsed['?xml']
    if (declaration !== undefined && (!record(declaration) || declaration['@_version'] !== '1.0')) throw protocolError()
    const rotation = parsed.hierarchy['@_rotation']
    if (rotation !== '0' && rotation !== '1' && rotation !== '2' && rotation !== '3') throw protocolError()
    return { tree: xml, rotation: Number(rotation) as 0 | 1 | 2 | 3 }
  } catch (_invalidHierarchy) {
    throw protocolError()
  }
}

/** Resolve wm size dimensions in the hierarchy's current rotation.
 * @param text - Caller-bounded wm size stdout with physical and optional override dimensions.
 * @param rotation - UI Automator quarter turns, from zero through three.
 * @returns Positive safe pixel dimensions, preferring an override and swapping odd rotations.
 * @throws MobileDeviceError for ambiguous or invalid dimensions and rotation.
 */
export function parseDisplaySize(text: string, rotation: number): { width: number; height: number } {
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw protocolError()
  const dimensions = new Map<string, { width: number; height: number }>()
  for (const line of lines(text)) {
    const match = /^(Physical|Override) size: ([1-9][0-9]*)x([1-9][0-9]*)$/.exec(line.trim())
    const kind = match?.[1]
    if (kind === undefined || dimensions.has(kind)) throw protocolError()
    const width = Number(match?.[2])
    const height = Number(match?.[3])
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) throw protocolError()
    dimensions.set(kind, { width, height })
  }
  const physical = dimensions.get('Physical')
  if (physical === undefined) throw protocolError()
  const size = dimensions.get('Override') ?? physical
  return rotation % 2 === 1 ? { width: size.height, height: size.width } : size
}

/** Validate the kernel boot identity used to distinguish device generations.
 * @param text - Caller-bounded boot_id stdout with optional trailing whitespace.
 * @returns Canonical UUID text in lowercase.
 * @throws MobileDeviceError when stdout is not exactly one UUID.
 */
export function parseBootId(text: string): string {
  const value = text.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw protocolError()
  return value.toLowerCase()
}

/** Extract an activity component without returning the device's full activity dump.
 * @param text - Caller-bounded dumpsys activity stdout.
 * @returns The unique top resumed component, otherwise a resumed component or unknown.
 */
export function parseActivity(text: string): string {
  for (const field of ['topResumedActivity', 'mResumedActivity']) {
    const components = new Set<string>()
    const pattern = new RegExp('^\\s*' + field + '\\s*[:=]\\s*ActivityRecord\\{[^}\\r\\n]*?\\s([a-zA-Z][a-zA-Z0-9_]*(?:\\.[a-zA-Z0-9_]+)*\\/[.a-zA-Z_$][a-zA-Z0-9_.$]*)\\s[^}\\r\\n]*\\}', 'gm')
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== undefined) components.add(match[1])
    }
    if (components.size > 1) return 'unknown'
    const component = [...components][0]
    if (component !== undefined) return component
  }
  return 'unknown'
}

// libvips decodes complete pixel data without requiring PNG's final IEND chunk.
const PNG_END = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130] as const

/** Fully decode one PNG before exposing its original bytes to attachment consumers.
 * @param data - Caller-bounded PNG bytes; the returned screenshot retains this byte array.
 * @param maxPixels - Positive safe maximum decoded pixel count supplied by provider configuration.
 * @returns Validated PNG media type, original bytes, and decoded dimensions.
 * @throws MobileDeviceError with MOBILE_IMAGE_INVALID for invalid, non-PNG, or oversized images.
 */
export async function parseScreenshot(data: Uint8Array, maxPixels: number): Promise<MobileScreenshot> {
  try {
    if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) throw new Error('Invalid pixel bound')
    if (PNG_END.some((byte, index) => data[data.length - PNG_END.length + index] !== byte)) throw new Error('Incomplete PNG')
    const image = sharp(data, { failOn: 'warning', limitInputPixels: maxPixels })
    const metadata = await image.metadata()
    if (metadata.format !== 'png') throw new Error('Expected PNG')
    const decoded = await image.raw().toBuffer({ resolveWithObject: true })
    const { width, height } = decoded.info
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
      || width > maxPixels / height) throw new Error('Invalid image dimensions')
    return { mediaType: 'image/png', data, width, height }
  } catch (_invalidScreenshot) {
    throw new MobileDeviceError('The Android device returned an invalid PNG screenshot.', 'MOBILE_IMAGE_INVALID')
  }
}
