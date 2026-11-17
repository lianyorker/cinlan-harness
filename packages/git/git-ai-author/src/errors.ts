/** Typed failure carrying the stable Git AI error code across transports. */
import type { GitAiErrorCode } from './types.ts'

/** One Git AI generation refusal or execution failure. */
export class GitAiError extends Error {
  override name = 'GitAiError'

  /**
   * @param code - stable error code shared by every transport.
   * @param message - actionable failure description.
   * @param options - standard error options; `cause` keeps the underlying failure.
   */
  constructor(readonly code: GitAiErrorCode, message: string,
    options?: ErrorOptions) {
    super(message, options)
  }
}
