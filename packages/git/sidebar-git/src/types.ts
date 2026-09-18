/** JSON data shared by the sidebar Git owner and its HTTP and Remote callers. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SourceControlGroupOrder } from '@deepseek-ai/dsh-git-settings/types'

/** One attached Session whose authoritative cwd selects the repository. */
export interface GitSessionRequest { sessionId: SessionId }
/** A literal repository-relative file path, or all paths when omitted. */
export interface GitPathRequest extends GitSessionRequest { path?: string }
/** Worktree or index diff selection. */
export interface GitDiffRequest extends GitPathRequest { staged: boolean }
/** A mutation tied to the repository displayed to the user. */
export interface GitMutationRequest extends GitSessionRequest { repositoryRoot: string }
/** A mutation of a literal file path, or an explicit all-files action. */
export interface GitPathMutationRequest extends GitMutationRequest { path?: string }
/** Discard a path only while the displayed HEAD still names the same commit. */
export interface GitDiscardRequest extends GitPathMutationRequest { head: string | null }
/** Switch to one existing local branch. */
export interface GitCheckoutRequest extends GitMutationRequest { branch: string }
/** One commit selected from the repository's history. */
export interface GitRevisionRequest extends GitSessionRequest { hash: string }
/** A history mutation tied to the displayed HEAD as well as repository. */
export interface GitRevisionMutationRequest extends GitMutationRequest { hash: string; head: string | null }
/** File content at one revision. */
export interface GitShowRequest extends GitSessionRequest { ref: string; path: string }
/** A bounded history page. */
export interface GitLogRequest extends GitSessionRequest { count?: number; skip?: number }
/** The message the user asks to preview before committing. */
export interface GitPrepareCommitRequest extends GitSessionRequest { repositoryRoot: string; message: string }
/** Index/worktree status for one literal path, including rename source when present. */
export interface GitStatusEntry { path: string; xy: string; previousPath?: string }
/** Canonical repository and Session facts captured for a user operation. */
export interface GitRepositoryState {
  root: string
  gitDirectory: string
  sessionCwd: string
  head: string | null
  branch: string | null
  indexFingerprint: string
}
/** The source-control panel's current repository observation and display preference. */
export interface GitStatusResult {
  isRepo: boolean
  branch?: string
  entries: GitStatusEntry[]
  repository?: GitRepositoryState
  groupOrder: SourceControlGroupOrder
}
/** One git log row. */
export interface GitLogEntry {
  hash: string
  hashFull: string
  subject: string
  author: string
  date: string
  refs: string
}
/** Existing local branches and the currently checked-out name. */
export interface GitBranchesResult { current: string; names: string[] }
/** Unified diff text. */
export interface GitDiffResult { diff: string }
/** File content, absent when the revision has no such file. */
export interface GitShowResult { content: string | null }
/** Successful completion of an explicitly requested mutation. */
export interface GitMutationResult { ok: true }
/** Exact message and repository state presented for the user's commit confirmation. */
export interface GitCommitPreview extends GitRepositoryState {
  sessionId: SessionId
  message: string
  attributed: boolean
}
/** The complete reviewed intent; execution refuses any changed repository facts. */
export interface GitCommitRequest { preview: GitCommitPreview }
/** Commit identity and the message actually recorded by Git. */
export interface GitCommitResult { repositoryRoot: string; head: string; message: string }
/** A pinned, committed-change comparison or the reason no comparison can be resolved. */
export type GitCompareResult =
  | {
    status: 'ready'
    repositoryRoot: string
    baseRef: string
    baseHead: string
    head: string
    usedFallback: boolean
    diff: string
  }
  | { status: 'unavailable'; reason: 'unborn' | 'detached' | 'no-default-branch' | 'no-merge-base' }
/** Stable operation failures carried unchanged by both transports. */
export type SidebarGitErrorCode =
  | 'unavailable' | 'not-repository' | 'invalid-request' | 'stale' | 'conflict' | 'git-error' | 'output-limit' | 'cancelled'
