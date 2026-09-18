/** Sanitized operational failures for saved execution targets. */
import type { TargetErrorCode } from './types.ts'

/** A target operation failed with a stable user-facing category. */
export class ExecutionTargetError extends Error {
  constructor(readonly code: TargetErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ExecutionTargetError'
  }
}
