/**
 * Browser-safe results of provider REST API budget probes.
 *
 * Counts here describe the provider's own request quota. They are never LLM
 * token usage, and the probes read no credential material.
 * @module @deepseek-ai/dsh-api-integration-preflight-controller/budget
 */

import type { IntegrationProvider } from './types.ts'

/** How a provider's API budget was resolved. */
export type IntegrationBudgetState =
  /** The provider reported the current window's request quota. */
  | 'reported'
  /** The probe succeeded, but the provider returned no quota data. */
  | 'not-reported'
  /** The provider exposes no readable API budget. */
  | 'unsupported'
  /** The probe itself failed; `reason` names why. */
  | 'unavailable'

/** Redacted reason a budget probe reported no quota. */
export type IntegrationBudgetReason =
  | 'cli-not-found'
  | 'cli-auth-failed'
  | 'probe-failed'
  | 'budget-unsupported'
  | 'no-rate-limit-data'

/** Request one provider's API budget probe. */
export interface IntegrationBudgetRequest {
  readonly provider: IntegrationProvider
}

/** Rate-limit budget of one integration provider. */
export interface IntegrationBudgetSnapshot {
  readonly provider: IntegrationProvider
  readonly state: IntegrationBudgetState
  readonly reason: IntegrationBudgetReason | null
  /** Requests left in the current window; null unless `state` is `reported`. */
  readonly remaining: number | null
  /** Requests allowed per window; null unless `state` is `reported`. */
  readonly limit: number | null
  /** RFC 3339 instant the current window resets; null when the provider omits it. */
  readonly resetsAt: string | null
}
