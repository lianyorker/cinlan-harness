/** Browser-safe results of read-only integration readiness checks. */

/** Integration providers supported by the preflight controller. */
export type IntegrationProvider = 'github' | 'gitlab' | 'gitee'

/** Connection status for one integration. */
export type IntegrationStatus = 'connected' | 'not-installed' | 'not-authenticated' | 'not-configured' | 'unavailable' | 'checking'

/** Redacted reason for the current status; never includes tokens, usernames, or paths. */
export type IntegrationReason =
  | 'connected'
  | 'cli-not-found'
  | 'cli-auth-failed'
  | 'token-not-set'
  | 'token-invalid'
  | 'probe-failed'
  | 'not-configured'

/** Request one provider's readiness check. */
export interface IntegrationPreflightRequest {
  readonly provider: IntegrationProvider
}

/** Result of one integration readiness probe. */
export interface IntegrationPreflightSnapshot {
  readonly provider: IntegrationProvider
  readonly status: IntegrationStatus
  readonly reason: IntegrationReason | null
  /** Redacted account hint when connected (e.g. login name); null otherwise. */
  readonly account: string | null
}
