/** Browser-safe request and response data for the gitAi Remote namespace. */
export type * from '@cinlan/git-ai-author/types'

/** Failure details shared by every operation in the gitAi namespace. */
export interface GitAiFailureDetails { operation: string }

/** Stable Remote codes for the Git AI owner's refusals and execution failures. */
export type GitAiRemoteErrorCode =
  | 'git-ai/unavailable'
  | 'git-ai/not-repository'
  | 'git-ai/invalid-request'
  | 'git-ai/stale'
  | 'git-ai/ai-disabled'
  | 'git-ai/recipe-disabled'
  | 'git-ai/empty-diff'
  | 'git-ai/comparison-unavailable'
  | 'git-ai/all-filtered'
  | 'git-ai/no-model'
  | 'git-ai/model-failed'
  | 'git-ai/cancelled'
  | 'git-ai/timeout'
  | 'git-ai/busy'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'git-ai/unavailable': GitAiFailureDetails
    'git-ai/not-repository': GitAiFailureDetails
    'git-ai/invalid-request': GitAiFailureDetails
    'git-ai/stale': GitAiFailureDetails
    'git-ai/ai-disabled': GitAiFailureDetails
    'git-ai/recipe-disabled': GitAiFailureDetails
    'git-ai/empty-diff': GitAiFailureDetails
    'git-ai/comparison-unavailable': GitAiFailureDetails
    'git-ai/all-filtered': GitAiFailureDetails
    'git-ai/no-model': GitAiFailureDetails
    'git-ai/model-failed': GitAiFailureDetails
    'git-ai/cancelled': GitAiFailureDetails
    'git-ai/timeout': GitAiFailureDetails
    'git-ai/busy': GitAiFailureDetails
  }
}
