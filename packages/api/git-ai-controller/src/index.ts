/** Desktop and Web Remote carrier for the Git AI draft owner. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { GitAiError } from '@cinlan/git-ai-author'
import type {
  GitAiGenerateRequest, GitAiGenerateResult, GitAiErrorCode, GitAiRemoteErrorCode,
} from './types.ts'

export type * from './types.ts'

const REMOTE_ERROR_CODES = {
  'unavailable': 'git-ai/unavailable',
  'not-repository': 'git-ai/not-repository',
  'invalid-request': 'git-ai/invalid-request',
  'stale': 'git-ai/stale',
  'ai-disabled': 'git-ai/ai-disabled',
  'recipe-disabled': 'git-ai/recipe-disabled',
  'empty-diff': 'git-ai/empty-diff',
  'comparison-unavailable': 'git-ai/comparison-unavailable',
  'all-filtered': 'git-ai/all-filtered',
  'no-model': 'git-ai/no-model',
  'model-failed': 'git-ai/model-failed',
  'cancelled': 'git-ai/cancelled',
  'timeout': 'git-ai/timeout',
  'busy': 'git-ai/busy',
} satisfies Record<GitAiErrorCode, GitAiRemoteErrorCode>

declare module '@deepseek-ai/cordis' {
  interface Context { gitAiController: GitAiController }
}

/** Forward typed Git AI requests without owning filtering or model orchestration. */
export class GitAiController extends TypertRemoteService {
  static inject = ['typert', 'gitAi']

  /** @param ctx - Host context containing the Git AI owner. */
  constructor(ctx: Context) {
    super(ctx, 'gitAiController', { namespace: 'gitAi' })
  }

  /**
   * Generate one editable Git AI draft.
   * @param request - Session identity, action, and change-set selection.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable Git AI code.
   */
  @Remote('generate')
  async generate(request: GitAiGenerateRequest, signal: AbortSignal): Promise<GitAiGenerateResult> {
    const owner = this.ctx.gitAi
    try {
      return await owner.generate(request, signal)
    } catch (error) {
      if (signal.aborted) throw new RemoteError('git-ai/cancelled', 'Git AI generation was cancelled', { operation: 'generate' })
      if (error instanceof GitAiError) throw new RemoteError(REMOTE_ERROR_CODES[error.code], error.message, { operation: 'generate' })
      throw new RemoteError('git-ai/model-failed', error instanceof Error ? error.message : String(error), { operation: 'generate' })
    }
  }
}

export default GitAiController
