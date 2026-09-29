/**
 * Error types and classification for history recall operations.
 * @module @deepseek-ai/dsh-tool-recall/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable error codes for recall tools. */
export type RecallErrorCode =
  | 'NON_AGENT_CALLER'
  | 'CHECKPOINT_NOT_FOUND'
  | 'ORPHANED_COMPACTION'
  | 'INVALID_OFFSET'
  | 'INVALID_ARGUMENT'

/**
 * Typed failure thrown by recall tools.
 */
export class RecallError extends HarnessError {
  override readonly name = 'RecallError'

  constructor(
    message: string,
    override readonly code: RecallErrorCode,
    options?: { fatal?: boolean; cause?: unknown },
  ) {
    super(message, code, options)
  }
}
