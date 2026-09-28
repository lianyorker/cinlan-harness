/** Wire-safe Account Settings views and authorization stream frames. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AuthorizationPromptAutocomplete } from '@deepseek-ai/dsh-authorization/types'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'account/bad-request': {}
    'account/not-found': { key: CredentialKey }
    'account/stale-prompt': {
      attemptId: AccountAuthorizationAttemptId
      promptId: AccountAuthorizationPromptId
    }
    'account/in-flight': { key: CredentialKey }
    'account/read-only': { key: CredentialKey }
    'account/delete-failed': { key: CredentialKey }
    'account/output-limit': {}
  }
}

/** Opaque identity of one caller-owned authorization attempt. */
export type AccountAuthorizationAttemptId = Branded<'AccountAuthorizationAttemptId'>

/** Opaque identity of one prompt within an authorization attempt. */
export type AccountAuthorizationPromptId = Branded<'AccountAuthorizationPromptId'>

/** Opaque flow-owned authorization method identity. */
export type AccountAuthorizationMethodId = Branded<'AccountAuthorizationMethodId'>

/** One authorization method exposed to Account Settings. */
export interface AccountAuthorizationMethodView {
  /** Flow-owned method identity echoed when authorization starts. */
  readonly id: AccountAuthorizationMethodId
  /** Provider-owned display label. */
  readonly label: string
}

/** Secret-free local credential state for one authorization flow. */
export interface AccountCredentialState {
  /** Whether the local credential record exists. */
  readonly configured: boolean
  /** Stored record family, absent while unconfigured. */
  readonly kind?: CredentialRecord['kind']
  /** Whether the active credential provider permits deletion. */
  readonly writable: boolean
}

/** One registered account authorization flow and its local state. */
export interface AccountAuthorizationFlowView {
  /** Credential record the flow writes. */
  readonly key: CredentialKey
  /** Provider-owned display label. */
  readonly label: string
  /** Available authorization methods in preference order. */
  readonly methods: readonly AccountAuthorizationMethodView[]
  /** Whether authorization still reserves this key until its runner settles, including after caller cancellation. */
  readonly inFlight: boolean
  /** Local presence and deletion capability without the credential payload. */
  readonly credential: AccountCredentialState
}

/** Complete secret-free Account Settings readback. */
export interface AccountAuthorizationSnapshot {
  /** Registered flows in provider registration order. */
  readonly flows: readonly AccountAuthorizationFlowView[]
}

/** One progress notice sent only to the caller that started an attempt. */
export interface AccountAuthorizationNoticeView {
  /** Provider-owned progress or instruction text. */
  readonly message: string
  /** Optional continuation page. */
  readonly url?: string
  /** Optional short code entered on the continuation page. */
  readonly code?: string
}

/** One select option in an authorization prompt. */
export interface AccountAuthorizationPromptOptionView {
  /** Flow-owned value returned when selected. */
  readonly id: string
  /** Provider-owned display label. */
  readonly label: string
  /** Optional provider-owned explanation. */
  readonly description?: string
}

/** Prompt metadata; answers never enter this view. */
export type AccountAuthorizationPromptView = {
  /** Prompt identity required by the answer command. */
  readonly id: AccountAuthorizationPromptId
  /** Provider-owned question. */
  readonly message: string
  /** Optional provider-owned input hint. */
  readonly placeholder?: string
  /** Optional browser input purpose for credential and one-time-code fields. */
  readonly autocomplete?: AuthorizationPromptAutocomplete
} & ({
  /** Ordinary visible text input. */
  readonly kind: 'text'
} | {
  /** Masked input whose value remains local to the submitting component. */
  readonly kind: 'secret'
} | {
  /** Closed option set. */
  readonly kind: 'select'
  /** Options accepted by the Host for this prompt. */
  readonly options: readonly AccountAuthorizationPromptOptionView[]
})

/** Safe failure classes rendered through locale-owned UI copy. */
export type AccountAuthorizationFailureCode =
  | 'busy'
  | 'invalid-input'
  | 'network'
  | 'rejected'
  | 'invalid-response'
  | 'cleanup-failed'
  | 'not-committed'
  | 'unavailable'

/** Caller-owned authorization stream. Secret answers travel only in answer(). */
export type AccountAuthorizationFrame = {
  readonly type: 'started'
  readonly attemptId: AccountAuthorizationAttemptId
  readonly key: CredentialKey
  readonly method: AccountAuthorizationMethodId
} | {
  readonly type: 'notice'
  readonly attemptId: AccountAuthorizationAttemptId
  readonly notice: AccountAuthorizationNoticeView
} | {
  readonly type: 'prompt'
  readonly attemptId: AccountAuthorizationAttemptId
  readonly prompt: AccountAuthorizationPromptView
} | {
  readonly type: 'prompt-withdrawn'
  readonly attemptId: AccountAuthorizationAttemptId
  readonly promptId: AccountAuthorizationPromptId
} | ({
  readonly type: 'settled'
  readonly attemptId: AccountAuthorizationAttemptId
} & ({
  readonly status: 'authorized' | 'cancelled'
} | {
  readonly status: 'failed'
  readonly failure: AccountAuthorizationFailureCode
}))

/** Result of deleting only the locally stored credential record. */
export interface AccountCredentialDeletionResult {
  /** Whether a local record existed before deletion. */
  readonly localDeleted: boolean
  /** Always false: the generic controller has no issuer revocation authority. */
  readonly issuerRevoked: false
}
