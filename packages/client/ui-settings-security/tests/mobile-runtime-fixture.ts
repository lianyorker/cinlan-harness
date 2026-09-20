/** Typed Host observations for mobile resource presentation tests. */
import type { MobileResourceStatus, MobileResourceRevision, MobileRuntimeStatus, MobileResourceTask,
  MobileResourceTaskId, MobileMirrorId } from '@deepseek-ai/dsh-mobile-device-runtime/types'

/** Create managed resource facts.
 * @param patch - Overrides for the observed resource.
 * @returns A complete resource observation.
 */
export function mobileResource(patch: Partial<MobileResourceStatus> = {}): MobileResourceStatus {
  return {
    definition: { id: 'platform-tools', version: '36.0.2', platform: 'win32-x64', url: 'https://example.test/platform-tools.zip',
      sha256: 'a'.repeat(64), bytes: 100, archiveRoot: 'platform-tools', executable: 'adb.exe',
      licenseUrl: 'https://example.test/license', licenseName: 'Android SDK License' },
    supported: true, revision: 'revision-1' as MobileResourceRevision, installedVersion: null, installedPath: null,
    integrity: 'missing', leased: false, updateAvailable: false, ...patch,
  }
}

/** Create a complete Android resource and device snapshot.
 * @param patch - Overrides supplied by the case.
 * @returns Host facts without acquiring a device or starting a process.
 */
export function mobileStatus(patch: Partial<MobileRuntimeStatus> = {}): MobileRuntimeStatus {
  return { platform: 'win32', resources: [mobileResource()], task: null,
    adb: { source: 'path', path: 'adb.exe', version: '1.0.41', error: null }, devices: [], mirror: null,
    iosSupported: false, ...patch }
}

/** Create a task receipt with a stable identity.
 * @param patch - Task progress or result overrides.
 * @returns Host-owned operation facts.
 */
export function mobileTask(patch: Partial<MobileResourceTask> = {}): MobileResourceTask {
  return { id: 'task-exact' as MobileResourceTaskId, resourceId: 'platform-tools', operation: 'install', state: 'running',
    phase: 'downloading', downloadedBytes: 40, totalBytes: 100, error: null, ...patch }
}

/** Stable mirror identity used by process-close expectations. */
export const mirrorId = 'mirror-exact' as MobileMirrorId
