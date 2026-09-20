/** Desktop and Web Remote carrier for the concrete sidebar Git owner. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SidebarGitError } from '@deepseek-ai/dsh-sidebar-git'
import type { SidebarGit } from '@deepseek-ai/dsh-sidebar-git'
import type {
  GitSessionRequest,
  GitStatusResult,
  GitDiffRequest,
  GitDiffResult,
  GitPathMutationRequest,
  GitMutationResult,
  GitBranchesResult,
  GitCheckoutRequest,
  GitPrepareCommitRequest,
  GitCommitPreview,
  GitCommitRequest,
  GitCommitResult,
  GitCompareResult,
  GitLogRequest,
  GitLogEntry,
  GitShowRequest,
  GitShowResult,
  GitRevisionRequest,
  GitDiscardRequest,
  GitRevisionMutationRequest,
  SidebarGitErrorCode,
  SidebarGitRemoteErrorCode,
} from './types.ts'

export type * from './types.ts'

const REMOTE_ERROR_CODES = {
  'unavailable': 'sidebar-git/unavailable',
  'not-repository': 'sidebar-git/not-repository',
  'invalid-request': 'sidebar-git/invalid-request',
  'stale': 'sidebar-git/stale',
  'conflict': 'sidebar-git/conflict',
  'git-error': 'sidebar-git/git-error',
  'output-limit': 'sidebar-git/output-limit',
  'cancelled': 'sidebar-git/cancelled',
} satisfies Record<SidebarGitErrorCode, SidebarGitRemoteErrorCode>

declare module '@deepseek-ai/cordis' {
  interface Context { sidebarGitController: SidebarGitController }
}

/** Carry typed Git requests without adding authority or another process implementation. */
export class SidebarGitController extends TypertRemoteService {
  static inject = ['typert']

  constructor(ctx: Context) {
    super(ctx, 'sidebarGitController', { namespace: 'sidebarGit' })
  }

  /**
   * Read the current Git panel state.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('status')
  async status(request: GitSessionRequest, signal: AbortSignal): Promise<GitStatusResult> {
    return this.run('status', signal, owner => owner.status(request, signal))
  }

  /**
   * Read a worktree or staged patch.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('diff')
  async diff(request: GitDiffRequest, signal: AbortSignal): Promise<GitDiffResult> {
    return this.run('diff', signal, owner => owner.diff(request, signal))
  }

  /**
   * Stage explicitly selected paths.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('stage')
  async stage(request: GitPathMutationRequest, signal: AbortSignal): Promise<GitMutationResult> {
    return this.run('stage', signal, owner => owner.stage(request, signal))
  }

  /**
   * Unstage explicitly selected paths.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('unstage')
  async unstage(request: GitPathMutationRequest, signal: AbortSignal): Promise<GitMutationResult> {
    return this.run('unstage', signal, owner => owner.unstage(request, signal))
  }

  /**
   * List existing local branches.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('branches')
  async branches(request: GitSessionRequest, signal: AbortSignal): Promise<GitBranchesResult> {
    return this.run('branches', signal, owner => owner.branches(request, signal))
  }

  /**
   * Check out an existing local branch.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('checkout')
  async checkout(request: GitCheckoutRequest, signal: AbortSignal): Promise<GitMutationResult> {
    return this.run('checkout', signal, owner => owner.checkout(request, signal))
  }

  /**
   * Prepare an exact commit intent for user review.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('prepareCommit')
  async prepareCommit(request: GitPrepareCommitRequest, signal: AbortSignal): Promise<GitCommitPreview> {
    return this.run('prepareCommit', signal, owner => owner.prepareCommit(request, signal))
  }

  /**
   * Commit the unchanged intent confirmed by the user.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('commit')
  async commit(request: GitCommitRequest, signal: AbortSignal): Promise<GitCommitResult> {
    return this.run('commit', signal, owner => owner.commit(request, signal))
  }

  /**
   * Compare committed changes against locally available refs.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('compare')
  async compare(request: GitSessionRequest, signal: AbortSignal): Promise<GitCompareResult> {
    return this.run('compare', signal, owner => owner.compare(request, signal))
  }

  /**
   * Read a bounded page of commit history.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('log')
  async log(request: GitLogRequest, signal: AbortSignal): Promise<GitLogEntry[]> {
    return this.run('log', signal, owner => owner.log(request, signal))
  }

  /**
   * Read one file from a selected commit.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('show')
  async show(request: GitShowRequest, signal: AbortSignal): Promise<GitShowResult> {
    return this.run('show', signal, owner => owner.show(request, signal))
  }

  /**
   * Read the patch of a selected commit.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('commitDiff')
  async commitDiff(request: GitRevisionRequest, signal: AbortSignal): Promise<GitDiffResult> {
    return this.run('commitDiff', signal, owner => owner.commitDiff(request, signal))
  }

  /**
   * Discard one tracked path after explicit confirmation.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('discard')
  async discard(request: GitDiscardRequest, signal: AbortSignal): Promise<GitMutationResult> {
    return this.run('discard', signal, owner => owner.discard(request, signal))
  }

  /**
   * Revert an explicitly selected commit.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('revert')
  async revert(request: GitRevisionMutationRequest, signal: AbortSignal): Promise<GitMutationResult> {
    return this.run('revert', signal, owner => owner.revert(request, signal))
  }

  /**
   * Cherry-pick an explicitly selected commit.
   * @param request - Session identity and operation-specific user intent.
   * @param signal - caller cancellation forwarded to the concrete owner.
   * @returns the owner result; failures retain their stable sidebar-git code.
   */
  @Remote('cherryPick')
  async cherryPick(request: GitRevisionMutationRequest, signal: AbortSignal): Promise<GitMutationResult> {
    return this.run('cherryPick', signal, owner => owner.cherryPick(request, signal))
  }

  private async run<T>(operation: string, signal: AbortSignal, invoke: (owner: SidebarGit) => Promise<T>): Promise<T> {
    const isAborted = (): boolean => signal.aborted
    if (isAborted()) throw new RemoteError('sidebar-git/cancelled', 'Git operation was cancelled', { operation })
    const owner = this.ctx.get('sidebarGit')
    if (owner === undefined) throw new RemoteError('sidebar-git/unavailable', 'The sidebar Git capability is unavailable', { operation })
    try {
      return await invoke(owner)
    } catch (error) {
      if (isAborted()) throw new RemoteError('sidebar-git/cancelled', 'Git operation was cancelled', { operation })
      if (error instanceof SidebarGitError) throw new RemoteError(REMOTE_ERROR_CODES[error.code], error.message, { operation })
      throw new RemoteError('sidebar-git/git-error', error instanceof Error ? error.message : String(error), { operation })
    }
  }
}

export default SidebarGitController
