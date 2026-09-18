/** Owner-local Git data and callback fixtures; no repository or transport side effects. */
import { vi } from 'vitest'
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { GitCommitPreview, GitLogEntry, GitRepositoryState, GitStatusResult } from '@deepseek-ai/dsh-sidebar-git/types'
import type { SidebarGitClient } from '../src/client/api.ts'

export const scope = { sessionId: 'git-session', cwd: '/workspace/subdir' }
export const repository: GitRepositoryState = {
  root: '/canonical/workspace', gitDirectory: '/canonical/workspace/.git', sessionCwd: '/canonical/workspace/subdir',
  head: 'a'.repeat(40), branch: 'topic', indexFingerprint: 'reviewed-index',
}
export const preview: GitCommitPreview = {
  ...repository, sessionId: scope.sessionId as GitCommitPreview['sessionId'],
  message: 'Reviewed subject\n\nDetailed body\n\nCo-authored-by: DeepSeek <noreply@deepseek.com>\n', attributed: true,
}
export const status: GitStatusResult = {
  isRepo: true, branch: 'topic', groupOrder: 'changes-first', repository,
  entries: [
    { path: 'both.ts', xy: 'MM' }, { path: 'tracked.ts', xy: ' M' }, { path: 'staged.ts', xy: 'A ' },
    { path: 'renamed.ts', previousPath: 'before.ts', xy: 'R ' }, { path: 'new.ts', xy: '??' },
  ],
}
export const logEntry: GitLogEntry = {
  hash: 'bbbbbbb', hashFull: 'b'.repeat(40), subject: 'History subject', author: 'Git User', date: '2026-01-01T00:00:00Z', refs: 'HEAD -> topic',
}
export const patch = [
  'diff --git a/source.ts b/source.ts', '--- a/source.ts', '+++ b/source.ts', '@@ -1 +1 @@', '-old source', '+new source',
].join('\n')

/** Plain callbacks passed through the same component props as production. */
export function gitCallbacks(snapshot: GitStatusResult = status) {
  return {
    gitStatus: vi.fn<SidebarGitClient['gitStatus']>().mockResolvedValue(snapshot),
    gitDiff: vi.fn<SidebarGitClient['gitDiff']>().mockResolvedValue({ diff: patch }),
    gitStage: vi.fn<SidebarGitClient['gitStage']>().mockResolvedValue({ ok: true }),
    gitUnstage: vi.fn<SidebarGitClient['gitUnstage']>().mockResolvedValue({ ok: true }),
    gitBranch: vi.fn<SidebarGitClient['gitBranch']>().mockResolvedValue({ current: 'topic', names: ['topic', 'main'] }),
    gitCheckout: vi.fn<SidebarGitClient['gitCheckout']>().mockResolvedValue({ ok: true }),
    gitPrepareCommit: vi.fn<SidebarGitClient['gitPrepareCommit']>().mockResolvedValue(preview),
    gitCommit: vi.fn<SidebarGitClient['gitCommit']>().mockResolvedValue({ repositoryRoot: repository.root, head: 'c'.repeat(40), message: preview.message }),
    gitCompare: vi.fn<SidebarGitClient['gitCompare']>().mockResolvedValue({
      status: 'ready', repositoryRoot: repository.root, baseRef: 'origin/main', baseHead: 'd'.repeat(40), head: repository.head!, usedFallback: false, diff: patch,
    }),
    gitLog: vi.fn<SidebarGitClient['gitLog']>().mockResolvedValue([logEntry]),
    gitShow: vi.fn<SidebarGitClient['gitShow']>().mockResolvedValue({ content: 'source' }),
    gitCommitDiff: vi.fn<SidebarGitClient['gitCommitDiff']>().mockResolvedValue({ diff: patch }),
    gitDiscard: vi.fn<SidebarGitClient['gitDiscard']>().mockResolvedValue({ ok: true }),
    gitRevert: vi.fn<SidebarGitClient['gitRevert']>().mockResolvedValue({ ok: true }),
    gitCherryPick: vi.fn<SidebarGitClient['gitCherryPick']>().mockResolvedValue({ ok: true }),
  } satisfies SidebarGitClient
}

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
type GitRemote = ClientRemote['sidebarGit']

/** Exact generated unary answers, including their RemoteResult envelope. */
export function gitRemote() {
  return {
    status: vi.fn<GitRemote['status']>().mockResolvedValue(ok(status)),
    diff: vi.fn<GitRemote['diff']>().mockResolvedValue(ok({ diff: patch })),
    stage: vi.fn<GitRemote['stage']>().mockResolvedValue(ok({ ok: true })),
    unstage: vi.fn<GitRemote['unstage']>().mockResolvedValue(ok({ ok: true })),
    branches: vi.fn<GitRemote['branches']>().mockResolvedValue(ok({ current: 'topic', names: ['topic', 'main'] })),
    checkout: vi.fn<GitRemote['checkout']>().mockResolvedValue(ok({ ok: true })),
    prepareCommit: vi.fn<GitRemote['prepareCommit']>().mockResolvedValue(ok(preview)),
    commit: vi.fn<GitRemote['commit']>().mockResolvedValue(ok({ repositoryRoot: repository.root, head: 'c'.repeat(40), message: preview.message })),
    compare: vi.fn<GitRemote['compare']>().mockResolvedValue(ok({ status: 'unavailable', reason: 'detached' })),
    log: vi.fn<GitRemote['log']>().mockResolvedValue(ok([logEntry])),
    show: vi.fn<GitRemote['show']>().mockResolvedValue(ok({ content: null })),
    commitDiff: vi.fn<GitRemote['commitDiff']>().mockResolvedValue(ok({ diff: patch })),
    discard: vi.fn<GitRemote['discard']>().mockResolvedValue(ok({ ok: true })),
    revert: vi.fn<GitRemote['revert']>().mockResolvedValue(ok({ ok: true })),
    cherryPick: vi.fn<GitRemote['cherryPick']>().mockResolvedValue(ok({ ok: true })),
  } satisfies GitRemote
}
