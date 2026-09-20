/** Shared native runtime observations for presentation and polling tests. */
import type { BrowserRuntimeStatus, BrowserRuntimeTask, BrowserRuntimeTaskId } from '@deepseek-ai/dsh-browser-playwright/types'

/** Create a runtime status without starting a native browser.
 * @param patch - Fields specific to the test observation.
 * @returns A complete Host runtime status.
 */
export function runtimeStatus(patch: Partial<BrowserRuntimeStatus> = {}): BrowserRuntimeStatus {
  return { providerActive: true, source: 'managed', channel: 'chromium', executablePath: null,
    installed: false, browserState: 'stopped', playwrightVersion: '1.60.0', browserVersion: '145.0.1',
    revision: '1201', managedInstalled: false, downloadOrigins: [], task: null, ...patch }
}

/** Create an active runtime task.
 * @param patch - State or progress fields specific to the test.
 * @returns An identified Host-owned task.
 */
export function runtimeTask(patch: Partial<BrowserRuntimeTask> = {}): BrowserRuntimeTask {
  return { taskId: 'task-1' as BrowserRuntimeTaskId, operation: 'install', state: 'running',
    phase: 'downloading', progressPercent: 40, errorCode: null, ...patch }
}
