/** Provider-neutral Work Items failure classification. */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { WorkItemsErrorCode } from './types.ts'

/** Typed Work Items failure with a stable open-string code. */
export class WorkItemsError extends HarnessError {
  /**
   * @param code - Stable operation failure category.
   * @param message - Safe diagnostic without credentials or response bodies.
   * @param options - Optional chained cause.
   */
  constructor(override readonly code: WorkItemsErrorCode, message: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'WorkItemsError'
  }
}
