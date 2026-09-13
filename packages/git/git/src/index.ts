/** Provider-neutral read-only Git capability (`ctx.git`). */
import { Context, Service } from '@deepseek-ai/cordis'
import type { GitDiff, GitDiffRequest, GitLogEntry, GitLogRequest, GitRepository, GitResolveRequest, GitStatus } from './types.ts'

export { GitError, GitRepositoryId } from './types.ts'
export type { GitDiff, GitDiffRequest, GitErrorCode, GitLogEntry, GitLogRequest, GitRepository, GitResolveRequest, GitStatus } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { git: GitRuntime }
}

/**
 * Read-only Git Service Definition. Mutation, publication, and worktree
 * isolation are separate Consumers and providers and are not part of this seam.
 */
export abstract class GitRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /**
   * Resolve the canonical repository containing a directory.
   * @param request - directory and optional cancellation signal.
   * @returns canonical repository identity and current head when one exists.
   */
  abstract resolveRepository(request: GitResolveRequest): Promise<GitRepository>

  /**
   * Return structured working-tree status.
   * @param repository - canonical repository returned by this capability.
   * @param signal - optional cancellation signal.
   * @returns bounded branch and working-tree counts.
   */
  abstract status(repository: GitRepository, signal?: AbortSignal): Promise<GitStatus>

  /**
   * Return a bounded diff observation.
   * @param request - repository, caller byte bound, and cancellation signal.
   * @returns diff text plus truncation state.
   */
  abstract diff(request: GitDiffRequest): Promise<GitDiff>

  /**
   * Return recent commits within the provider and caller bounds.
   * @param request - repository, entry limit, and cancellation signal.
   * @returns structured commit entries in Git log order.
   */
  abstract log(request: GitLogRequest): Promise<readonly GitLogEntry[]>
}

export default GitRuntime
