/** Props and callbacks for the feature-owned Account Settings section. */
import type {
  AccountAuthorizationMethodId,
  AccountAuthorizationPromptId,
} from '@deepseek-ai/dsh-api-account-controller/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountReadback } from './source.ts'

/** Apply-owned callbacks and framework-bound account source. */
export interface AccountSettingsInjected {
  hooks: { account: ObservableSnapshot<AccountReadback> }
  start(key: CredentialKey, method: AccountAuthorizationMethodId): boolean
  answer(promptId: AccountAuthorizationPromptId, answer: string): Promise<boolean>
  cancel(): Promise<boolean>
  deleteCredential(key: CredentialKey): Promise<boolean>
  retry(): void
  dismissAttempt(): void
  clearFeedback(): void
}

/** Account Settings component inputs derived from its registration. */
export type AccountSettingsProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.account'>
  & InjectFace<AccountSettingsInjected>
