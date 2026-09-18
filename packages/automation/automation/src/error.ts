/** Classified automation failures for direct and Remote consumers. */
import type { AutomationErrorCode } from './types.ts'
/** A failed command; callers preserve the last committed view. */
export class AutomationError extends Error {
  /** @param code - stable failure category.
   * @param message - bounded operational explanation.
   * @param options - underlying local cause, kept off the Remote payload.
   */
  constructor(readonly code: AutomationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AutomationError'
  }
}
