/** Runtime brands, constants, and coded errors for durable findings. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  FindingCursor as FindingCursorType,
  FindingErrorCode,
  FindingFingerprint as FindingFingerprintType,
  FindingId as FindingIdType,
  FindingRef,
  FindingRuleId as FindingRuleIdType,
  FindingState,
  FindingTargetId as FindingTargetIdType,
} from './types.ts'

/** Durable finding event payload version. */
export const FINDING_CHANGE_VERSION = 1

/** Closed finding-state vocabulary in stable display order. */
export const FINDING_STATES: readonly FindingState[] = [
  'observation',
  'hypothesis',
  'reproduced-vulnerability',
  'remediation',
  'unresolved',
]

/**
 * Brand a validated finding id.
 * @param value - Opaque id.
 * @returns Branded id.
 */
export function FindingId(value: string): FindingIdType {
  return value as FindingIdType
}

/**
 * Brand a canonical fingerprint.
 * @param value - SHA-256 hex digest.
 * @returns Branded digest.
 */
export function FindingFingerprint(value: string): FindingFingerprintType {
  return value as FindingFingerprintType
}

/**
 * Brand a detector rule id.
 * @param value - Stable rule id.
 * @returns Branded rule id.
 */
export function FindingRuleId(value: string): FindingRuleIdType {
  return value as FindingRuleIdType
}

/**
 * Brand an affected target id.
 * @param value - Stable target id.
 * @returns Branded target id.
 */
export function FindingTargetId(value: string): FindingTargetIdType {
  return value as FindingTargetIdType
}

/**
 * Brand an opaque finding cursor.
 * @param value - Cursor value.
 * @returns Branded cursor.
 */
export function FindingCursor(value: string): FindingCursorType {
  return value as FindingCursorType
}

/** Optional committed ref carried by a post-append durability failure. */
export interface FindingErrorOptions extends ErrorOptions {
  readonly committedRef?: FindingRef
}

/** Stable domain error whose message contains no artifact bytes or authorization values. */
export class FindingError extends HarnessError {
  override readonly code: FindingErrorCode
  /** Exact committed finding ref when persistence succeeded but flush failed. */
  readonly committedRef: FindingRef | undefined

  /**
   * @param message - Human-readable rejection reason.
   * @param code - Stable machine-routable classification.
   * @param options - Optional cause and committed ref.
   */
  constructor(message: string, code: FindingErrorCode, options?: FindingErrorOptions) {
    super(message, code, options)
    this.name = 'FindingError'
    this.code = code
    this.committedRef = options?.committedRef
  }
}
