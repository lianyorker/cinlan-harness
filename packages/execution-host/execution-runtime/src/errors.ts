/** Finite public diagnostics; SSH and local filesystem error details never cross the management API. */
import type { RuntimeErrorCode } from './types.ts'
const messages: Record<RuntimeErrorCode, string> = {
  'release-unavailable': 'This Harness release has no complete verified runtime payload for the selected remote platform.',
  'invalid-config': 'The remote runtime configuration is invalid.',
  'connection-failed': 'The pinned SSH connection could not complete the runtime operation.',
  'verification-failed': 'The remote runtime did not pass artifact or execution verification.',
  'target-changed': 'The saved target changed before runtime activation. Refresh the target and try again.',
  cancelled: 'Runtime installation was cancelled.',
}
/** Stable management failure without raw credentials, paths or child diagnostics. */
export class RuntimeError extends Error {
  /**
   * Create a public runtime management diagnostic.
   * @param code - Stable failure category.
   */
  constructor(readonly code: RuntimeErrorCode) { super(messages[code]); this.name = 'RuntimeError' }
}
