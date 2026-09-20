/** Runtime checks for untrusted Remote arguments; typed provider calls do not use these checks. */
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const COUNTER = /^(?:0|[1-9][0-9]*)$/u
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const MAX_ID_LENGTH = 256
const MAX_INPUT_BYTES = 64 * 1024
const encoder = new TextEncoder()

function invalid(): never {
  throw new SidebarTerminalError('invalid-request', 'Invalid terminal request')
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  if (Object.keys(value).some(key => !fields.includes(key))) invalid()
  return value as Record<string, unknown>
}

function opaqueId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH || CONTROL.test(value)) invalid()
}

function counter(value: string): boolean {
  return COUNTER.test(value) && Number.isSafeInteger(Number(value))
}

function uuid(value: unknown): void {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
}

function dimensions(value: Record<string, unknown>): void {
  for (const dimension of [value.cols, value.rows]) {
    if (typeof dimension !== 'number' || !Number.isInteger(dimension) || dimension < 1 || dimension > 1024) invalid()
  }
}

/** @param value - Nonempty opaque Session id from Remote JSON. */
export function validateSessionId(value: unknown): void { opaqueId(value) }

/** @param value - Lowercase agent terminal UUID from Remote JSON. */
export function validateAgentId(value: unknown): void { uuid(value) }

/** @param value - Open request from Remote JSON; floating tabs must identify their owning window. */
export function validateOpen(value: unknown): void {
  const request = record(value, ['target', 'cols', 'rows'])
  dimensions(request)
  const target = record(request.target, ['kind', 'sessionId', 'tabId', 'floating', 'shellPath', 'uuid'])
  if (target.kind === 'agent') {
    record(target, ['kind', 'uuid'])
    uuid(target.uuid)
    return
  }
  if (target.kind !== 'ui') invalid()
  record(target, ['kind', 'sessionId', 'tabId', 'floating', 'shellPath'])
  if (target.shellPath !== undefined && (typeof target.shellPath !== 'string' || target.shellPath.length === 0
    || target.shellPath.length > 4096 || CONTROL.test(target.shellPath))) invalid()
  opaqueId(target.sessionId)
  opaqueId(target.tabId)
  if (target.floating !== undefined) {
    const floating = record(target.floating, ['windowId', 'directory'])
    uuid(floating.windowId)
    const prefix = 'terminal:' + String(floating.windowId) + ':'
    if (!target.tabId.startsWith(prefix) || !counter(target.tabId.slice(prefix.length))) invalid()
    if (typeof floating.directory !== 'string' || floating.directory.length > 4096 || floating.directory.includes('\0')) {
      throw new SidebarTerminalError('invalid-directory', 'Invalid terminal directory')
    }
  } else if (!/^terminal:[A-Za-z0-9_-]{1,128}$/u.test(target.tabId)) {
    invalid()
  }
}

function uiTarget(request: Record<string, unknown>): void {
  opaqueId(request.sessionId)
  opaqueId(request.tabId)
  if (/^terminal:[A-Za-z0-9_-]{1,128}$/u.test(request.tabId)) return
  const parts = request.tabId.split(':')
  if (parts.length !== 3 || parts[0] !== 'terminal' || typeof parts[2] !== 'string') invalid()
  uuid(parts[1])
  if (!counter(parts[2])) invalid()
}

/** @param value - Existing UI tab lookup; no process creation or directory change is permitted. */
export function validateInspectUi(value: unknown): void {
  uiTarget(record(value, ['sessionId', 'tabId']))
}

/** @param value - Previously observed UI process to close; the provider compares its native generation. */
export function validateCloseUi(value: unknown): void {
  const request = record(value, ['sessionId', 'tabId', 'processId'])
  uiTarget(request)
  uuid(request.processId)
}

/** @param value - Input request; its complete JSON request object, including metadata, is bounded to 64 KiB. */
export function validateInput(value: unknown): void {
  const request = record(value, ['attachmentId', 'data'])
  uuid(request.attachmentId)
  if (typeof request.data !== 'string' || request.data.length > MAX_INPUT_BYTES
    || encoder.encode(JSON.stringify(request)).byteLength > MAX_INPUT_BYTES) invalid()
}

/** @param value - Resize request with a live attachment identity and bounded integer dimensions. */
export function validateResize(value: unknown): void {
  const request = record(value, ['attachmentId', 'cols', 'rows'])
  uuid(request.attachmentId)
  dimensions(request)
}

/** @param value - Acknowledgement request with a safe nonnegative rendered sequence. */
export function validateAck(value: unknown): void {
  const request = record(value, ['attachmentId', 'sequence'])
  uuid(request.attachmentId)
  if (typeof request.sequence !== 'number' || !Number.isSafeInteger(request.sequence) || request.sequence < 0) invalid()
}

/** @param value - Release request with one of the three public dispositions. */
export function validateRelease(value: unknown): void {
  const request = record(value, ['attachmentId', 'mode'])
  uuid(request.attachmentId)
  if (request.mode !== 'disconnect' && request.mode !== 'park' && request.mode !== 'close') invalid()
}
