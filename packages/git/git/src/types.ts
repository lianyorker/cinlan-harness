import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity for one canonical Git repository. */
export type GitRepositoryId = Branded<'GitRepositoryId'>

/**
 * Brand a validated repository id.
 * @param value - provider-owned canonical repository identity.
 * @returns the value branded as a Git repository id.
 */
export function GitRepositoryId(value: string): GitRepositoryId {
  return value as GitRepositoryId
}

/** Canonical repository identity returned by a provider. */
export interface GitRepository {
  readonly id: GitRepositoryId
  readonly root: string
  readonly head: string | undefined
}

/** A bounded request to resolve the repository containing a directory. */
export interface GitResolveRequest {
  readonly path: string
  readonly signal?: AbortSignal
}

/** Structured status counts; the provider never exposes porcelain text as the API. */
export interface GitStatus {
  /** Current branch name, including an unborn branch, or `undefined` for detached HEAD. */
  readonly branch: string | undefined
  readonly ahead: number
  readonly behind: number
  readonly staged: number
  readonly unstaged: number
  readonly untracked: number
  readonly conflicted: number
  readonly clean: boolean
}

/** A bounded diff observation. */
export interface GitDiff {
  readonly text: string
  readonly truncated: boolean
}

/** One log entry with stable commit identity and display fields. */
export interface GitLogEntry {
  readonly hash: string
  readonly authorName: string
  readonly committedAt: string
  /** Commit subject with embedded control characters preserved and trailing whitespace removed. */
  readonly subject: string
}

/** Request for a bounded diff. */
export interface GitDiffRequest {
  readonly repository: GitRepository
  readonly maxBytes?: number
  readonly signal?: AbortSignal
}

/** Request for a bounded commit log. */
export interface GitLogRequest {
  readonly repository: GitRepository
  readonly limit?: number
  readonly signal?: AbortSignal
}

/** Stable failure codes exposed by Git providers. */
export type GitErrorCode = 'NOT_REPOSITORY' | 'COMMAND_FAILED' | 'OUTPUT_TOO_LARGE' | 'INVALID_REQUEST'

/** Provider-neutral Git failure. */
export class GitError extends Error {
  constructor(readonly code: GitErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GitError'
  }
}
