/** Account Remote values contain no credential payloads. */
export type { AccountBonusBatch, AccountBonusNotification, AccountBonusOrderId, AccountClientMetadata, AccountDetails, AccountProfile, AccountUserId, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'

/** Safe Sub2API account projection: presence of the committed key, never its value. */
export interface Sub2ApiAccountState {
  /** Whether an API-key record for the Sub2API provider is stored. */
  readonly signedIn: boolean
  /** Whether a sign-in attempt is currently running. */
  readonly inFlight: boolean
}

/** Explicit Sub2API sign-in answers collected by the settings form. */
export interface Sub2ApiSignInRequest {
  readonly email: string
  readonly password: string
  /** Verification code for accounts with two-factor authentication enabled. */
  readonly totpCode?: string
}

/** How one Sub2API sign-in attempt ended. */
export type Sub2ApiSignInOutcome =
  | { readonly status: 'authorized' }
  | { readonly status: 'totp-required' }
