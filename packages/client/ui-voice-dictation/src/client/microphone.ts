/** Microphone permission probing and persisted fallback for WebViews whose Permissions API cannot query microphone state. */

/** Current or just-requested microphone permission outcome. */
export type MicrophonePermissionState = 'unknown' | 'granted' | 'denied'

const STORAGE_KEY = 'dsh.voice.microphonePermission'

function readStoredPermission(): MicrophonePermissionState {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'granted' || value === 'denied' ? value : 'unknown'
  } catch {
    return 'unknown'
  }
}

function storePermission(value: MicrophonePermissionState): void {
  try {
    if (value === 'unknown') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Storage can be blocked in a hardened WebView. The live permission result
    // still reaches the current component; only cross-mount fallback is lost.
  }
}

function isPermissionRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  const name = (error as { readonly name?: unknown }).name
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError'
}

/**
 * Request microphone access, releasing the stream immediately on success.
 * The result is persisted only as a fallback for WebViews that cannot query
 * the microphone through the Permissions API on the next Settings mount.
 * @returns granted or denied for a permission decision; otherwise the current query/fallback state.
 */
export async function requestMicrophonePermission(): Promise<MicrophonePermissionState> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    storePermission('granted')
    return 'granted'
  } catch (error) {
    if (isPermissionRejection(error)) {
      storePermission('denied')
      return 'denied'
    }
    return readMicrophonePermission()
  }
}

/**
 * Read the current browser permission without prompting. A real Permissions
 * API answer always wins and refreshes the fallback; unsupported/throwing
 * implementations fall back to the last successful getUserMedia result.
 * @returns current browser permission or the persisted fallback.
 */
export async function readMicrophonePermission(): Promise<MicrophonePermissionState> {
  const permissions = (navigator as { permissions?: Permissions }).permissions
  if (permissions === undefined) return readStoredPermission()
  try {
    const status = await permissions.query({ name: 'microphone' })
    if (status.state === 'granted') {
      storePermission('granted')
      return 'granted'
    }
    if (status.state === 'denied') {
      storePermission('denied')
      return 'denied'
    }
    storePermission('unknown')
    return 'unknown'
  } catch {
    return readStoredPermission()
  }
}

/** Test-only reset of the persisted fallback. */
export function resetStoredMicrophonePermission(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (_storageUnavailable) {
    // Tests and hardened WebViews may expose no writable storage; nothing was persisted to reset.
  }
}
