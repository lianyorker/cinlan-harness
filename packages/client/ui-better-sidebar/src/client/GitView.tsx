/** Source-control groups, pinned branch comparison, and explicitly reviewed repository mutations. */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconBranchOutline16, IconCodeOutline16, IconCopyOutline16, IconRefreshOutline16,
  IconTrashOutline16, Menu, Modal, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitCommitPreview, GitCompareResult, GitLogEntry, GitRepositoryState, GitStatusEntry, GitStatusResult,
  SessionScope, SidebarGitClient,
} from './api.ts'
import { DiffView } from './DiffView.tsx'
import { relativeTo } from './paths.ts'
import { relativeTime, t } from './locales.ts'
import type { SidebarTab } from './state.ts'
import css from './sidebar.module.css'
import gitCss from './git-view.module.css'

/** The status letter for the row's selected index or worktree side. */
function badgeOf(entry: GitStatusEntry, staged: boolean): string {
  const letter = entry.xy[staged ? 0 : 1]
  return letter === undefined || letter === ' ' ? '?' : letter
}

/** Whether the entry carries STAGED (index) changes — the X letter is set. */
function isStagedEntry(entry: GitStatusEntry): boolean {
  const index = entry.xy[0]
  return index !== undefined && index !== ' ' && index !== '?'
}

/** Tracked worktree changes; an MM entry appears on both index and worktree sides. */
function isUnstagedEntry(entry: GitStatusEntry): boolean {
  const worktree = entry.xy[1]
  return worktree !== undefined && worktree !== ' ' && worktree !== '?'
}

/** Whether the entry is untracked (`??`): git diff never includes it. */
function isUntracked(entry: GitStatusEntry): boolean {
  return entry.xy === '??'
}

/** The last path segment (tab title for a file's diff). */
function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** The ref names of one log row's decorations (`HEAD -> main` → `main`), deduped. */
function refNames(refs: string): string[] {
  return [...new Set(
    refs
      .split(',')
      .map(ref => ref.trim())
      .filter(ref => ref !== '')
      .map(ref => (ref.includes(' -> ') ? ref.slice(ref.indexOf(' -> ') + 4) : ref))
      .map(ref => (ref.startsWith('tag: ') ? ref.slice(5) : ref)),
  )]
}

/** The pending destructive action (discard / revert / cherry-pick), gated by a confirm modal. */
interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  repository: GitRepositoryState
  onConfirm: () => Promise<unknown>
}

/** History batch size: the log loads lazily in pages so a long history never
 *  floods the panel at once (the end of the log is reached by paging). */
const LOG_BATCH = 20

type CommitReview = { status: 'preparing' } | { status: 'ready'; preview: GitCommitPreview }
type Comparison = { status: 'loading' } | { status: 'loaded'; result: GitCompareResult } | { status: 'error'; message: string }
type Group = 'unstaged' | 'staged' | 'untracked'
const GROUP_ORDER: Record<GitStatusResult['groupOrder'], readonly Group[]> = {
  'changes-first': ['unstaged', 'staged', 'untracked'],
  'staged-first': ['staged', 'unstaged', 'untracked'],
  'untracked-first': ['untracked', 'unstaged', 'staged'],
}
const COMPARE_REASON = {
  unborn: 'gitCompareUnborn',
  detached: 'gitCompareDetached',
  'no-default-branch': 'gitCompareNoDefault',
  'no-merge-base': 'gitCompareNoMergeBase',
} as const

interface GitViewProps {
  scope: SessionScope
  git: SidebarGitClient
  onOpenFile: (path: string) => void
  /** Open a diff tab (the shell places it below the git pane on first use). */
  onOpenDiff: (tab: SidebarTab) => void
}

/**
 * Render Git operations for one Session; switching scope discards pending reviews.
 * @param props - Session scope, plain Git callbacks, and file/tab navigation.
 * @returns the source-control panel.
 */
export function GitView(props: GitViewProps) {
  return <GitPanel key={JSON.stringify([props.scope.sessionId, props.scope.cwd])} {...props} />
}

function GitPanel(props: GitViewProps) {
  const { scope, git, onOpenFile, onOpenDiff } = props
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [branchNames, setBranchNames] = useState<string[]>([])
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  /** Whether the history was fully paged (a batch shorter than LOG_BATCH). */
  const [logEnded, setLogEnded] = useState(false)
  const [logLoadingMore, setLogLoadingMore] = useState(false)

  /** The open file-row context menu (cursor position for the portaled Menu). */
  const [fileMenu, setFileMenu] = useState<{ entry: GitStatusEntry; staged: boolean; x: number; y: number } | null>(null)
  /** The open history-row context menu. */
  const [historyMenu, setHistoryMenu] = useState<{ entry: GitLogEntry; x: number; y: number } | null>(null)
  /** The pending destructive action awaiting confirmation. */
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [review, setReview] = useState<CommitReview | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const mounted = useRef(false)
  const mutationPending = useRef(false)
  const refreshRequest = useRef<AbortController | null>(null)
  const prepareRequest = useRef<AbortController | null>(null)
  const compareRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      refreshRequest.current?.abort()
      prepareRequest.current?.abort()
      compareRequest.current?.abort()
    }
  }, [git])

  const cancelReview = (): void => {
    prepareRequest.current?.abort()
    prepareRequest.current = null
    setReview(null)
  }

  const closeComparison = (): void => {
    compareRequest.current?.abort()
    compareRequest.current = null
    setComparison(null)
  }

  const refresh = useCallback(async (): Promise<void> => {
    refreshRequest.current?.abort()
    const controller = new AbortController()
    refreshRequest.current = controller
    const cancelled = (): boolean => controller.signal.aborted
    setLoading(true)
    setError(null)
    try {
      const statusResult = await git.gitStatus(scope, controller.signal)
      if (cancelled()) return
      setStatus(statusResult)
      if (!statusResult.isRepo) {
        setBranchNames([])
        setLogEntries([])
        setLogEnded(true)
        return
      }
      const [branchResult, logResult] = await Promise.all([
        git.gitBranch(scope, controller.signal),
        git.gitLog(scope, LOG_BATCH, 0, controller.signal),
      ])
      if (cancelled()) return
      setBranchNames(branchResult.names)
      setLogEntries(logResult)
      setLogEnded(logResult.length < LOG_BATCH)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [git, scope.sessionId, scope.cwd])

  useEffect(() => { void refresh() }, [refresh])

  /** Append the next history page (lazy: only when the user asks for more). */
  const loadMoreLog = async (): Promise<void> => {
    if (logLoadingMore || logEnded) return
    setLogLoadingMore(true)
    const signal = refreshRequest.current?.signal
    try {
      const next = await git.gitLog(scope, LOG_BATCH, logEntries.length, signal)
      if (!mounted.current || signal?.aborted) return
      setLogEntries(entries => [...entries, ...next])
      if (next.length < LOG_BATCH) setLogEnded(true)
    } catch (reason) {
      if (mounted.current && !signal?.aborted) setCommitError(`${t('historyLoadError')}: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      if (mounted.current) setLogLoadingMore(false)
    }
  }

  /** The diff tab for one changed file (one tab per path+side; same id = focused). */
  const openWorktreeDiff = (entry: GitStatusEntry, staged: boolean): void => {
    onOpenDiff({
      id: `diff:w:${staged ? 's' : 'u'}:${entry.path}`,
      type: 'diff',
      title: baseName(entry.path),
      diff: { kind: 'worktree', path: entry.path, staged, untracked: isUntracked(entry) },
    })
  }

  /** The diff tab for one commit (one tab per commit). */
  const openCommitDiff = (entry: GitLogEntry): void => {
    onOpenDiff({
      id: `diff:c:${entry.hashFull}`,
      type: 'diff',
      title: `${entry.hash} ${entry.subject}`,
      diff: { kind: 'commit', hash: entry.hash, hashFull: entry.hashFull, subject: entry.subject },
    })
  }

  const runMutation = async (operation: () => Promise<unknown>, onSuccess?: () => void): Promise<void> => {
    if (mutationPending.current) return
    mutationPending.current = true
    cancelReview()
    setBusy(true)
    setCommitError(null)
    try {
      await operation()
      if (!mounted.current) return
      onSuccess?.()
      await refresh()
    } catch (reason) {
      if (mounted.current) setCommitError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      mutationPending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const stageEntries = async (entries: GitStatusEntry[], staged: boolean): Promise<void> => {
    const repository = status?.repository
    if (repository === undefined) return
    await runMutation(async () => {
      for (const entry of entries) {
        if (!mounted.current) return
        if (staged) await git.gitUnstage(scope, repository.root, entry.path)
        else await git.gitStage(scope, repository.root, entry.path)
      }
    })
  }

  const prepareCommit = async (): Promise<void> => {
    const repository = status?.repository
    if (commitMsg.trim() === '' || busy || repository === undefined || stagedEntries.length === 0) return
    cancelReview()
    const controller = new AbortController()
    prepareRequest.current = controller
    setReview({ status: 'preparing' })
    setCommitError(null)
    try {
      const preview = await git.gitPrepareCommit(scope, repository.root, commitMsg, controller.signal)
      if (!controller.signal.aborted) setReview({ status: 'ready', preview })
    } catch (reason) {
      if (controller.signal.aborted) return
      setReview(null)
      setCommitError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const commit = async (): Promise<void> => {
    if (review?.status !== 'ready' || prepareRequest.current === null || prepareRequest.current.signal.aborted || busy) return
    const preview = review.preview
    await runMutation(() => git.gitCommit(preview), () => { setCommitMsg('') })
  }

  const compare = async (): Promise<void> => {
    closeComparison()
    const controller = new AbortController()
    compareRequest.current = controller
    setComparison({ status: 'loading' })
    try {
      const result = await git.gitCompare(scope, controller.signal)
      if (!controller.signal.aborted) setComparison({ status: 'loaded', result })
    } catch (reason) {
      if (!controller.signal.aborted) setComparison({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  const checkout = async (branch: string): Promise<void> => {
    const repository = status?.repository
    if (branch === status?.branch || repository === undefined) return
    await runMutation(() => git.gitCheckout(scope, repository.root, branch))
  }

  const runConfirmed = (confirmState: ConfirmState): void => {
    if (busy) return
    cancelReview()
    setConfirm(confirmState)
  }

  /** Copy `text` to the clipboard (best-effort; no visual feedback needed — the menu closes). */
  const copy = (text: string): void => {
    void writeClipboard(text)
  }

  const openFileMenu = (event: MouseEvent, entry: GitStatusEntry, staged: boolean): void => {
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ entry, staged, x: event.clientX, y: event.clientY })
  }

  const openHistoryMenu = (event: MouseEvent, entry: GitLogEntry): void => {
    event.preventDefault()
    event.stopPropagation()
    setHistoryMenu({ entry, x: event.clientX, y: event.clientY })
  }

  const stagedEntries = (status?.entries ?? []).filter(isStagedEntry)
  const unstagedEntries = (status?.entries ?? []).filter(isUnstagedEntry)
  const untrackedEntries = (status?.entries ?? []).filter(isUntracked)
  const groups = { staged: stagedEntries, unstaged: unstagedEntries, untracked: untrackedEntries }
  const repository = status?.repository
  const mutationDisabled = busy || repository === undefined

  const provenance = (facts: Pick<GitRepositoryState, 'root' | 'head' | 'branch'>): ReactNode => (
    <div className={gitCss.provenance}>
      <div>{t('gitRepository', { root: facts.root })}</div>
      <div>{t('gitBranch', { branch: facts.branch ?? t('gitDetached') })}</div>
      <div>{t('gitHead', { head: facts.head ?? t('gitNoHead') })}</div>
    </div>
  )

  const renderEntry = (entry: GitStatusEntry, staged: boolean): ReactNode => {
    return (
      <div key={`${staged ? 's' : 'u'}:${entry.path}`} className={css.gitRow}>
        <button
          type="button"
          className={css.gitRowMain}
          title={entry.previousPath === undefined ? entry.path : `${entry.previousPath} → ${entry.path}`}
          onClick={() => { openWorktreeDiff(entry, staged) }}
          onContextMenu={(event) => { openFileMenu(event, entry, staged) }}
        >
          <span className={css.gitBadge}>{badgeOf(entry, staged)}</span>
          <span className={css.gitName}>{entry.previousPath === undefined ? entry.path : `${entry.previousPath} → ${entry.path}`}</span>
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={staged ? t('unstage') : t('stage')}
          title={staged ? t('unstage') : t('stage')}
          disabled={mutationDisabled}
          onClick={() => { void stageEntries([entry], staged) }}
        >
          {staged ? <IconTrashOutline16 /> : <IconBranchOutline16 />}
        </button>
      </div>
    )
  }

  return (
    <div className={css.git}>
      <div className={css.gitHeader}>
        <select
          className={css.gitBranchSelect}
          value={status?.branch ?? ''}
          onChange={(event) => { void checkout(event.target.value) }}
          aria-label={t('branch')}
          disabled={mutationDisabled || (status !== null && !status.isRepo)}
        >
          {status?.branch !== undefined && status.branch !== '' && <option value={status.branch}>{status.branch}</option>}
          {branchNames.filter(name => name !== status?.branch).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button
          type="button"
          className={css.gitLink}
          disabled={status === null || !status.isRepo}
          onClick={() => { void compare() }}
        >
          {t('gitCompare')}
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={() => { void refresh() }}
        >
          <IconRefreshOutline16 size={14} />
        </button>
      </div>

      {loading && <div className={css.gitPlaceholder}>{t('loading')}</div>}
      {!loading && error !== null && <div className={css.gitError}>{error}</div>}
      {!loading && status !== null && !status.isRepo && (
        <div className={css.gitPlaceholder}>{t('notRepo')}</div>
      )}

      {status !== null && status.isRepo && (
        <>
          {GROUP_ORDER[status.groupOrder].map(group => (
            <section key={group} className={css.gitSection} aria-label={t(group)}>
              <div className={css.gitSectionHeader}>
                <span>{t(group)} ({groups[group].length})</span>
                {groups[group].length > 0 && (
                  <button
                    type="button"
                    className={css.gitLink}
                    disabled={mutationDisabled}
                    onClick={() => { void stageEntries(groups[group], group === 'staged') }}
                  >
                    {group === 'staged' ? t('unstageAll') : t('stageAll')}
                  </button>
                )}
              </div>
              {groups[group].length === 0 && <div className={css.gitEmpty}>{t('noChanges')}</div>}
              {groups[group].map(entry => renderEntry(entry, group === 'staged'))}
            </section>
          ))}

          <div className={css.gitCommit}>
            <textarea
              className={clsx(css.gitCommitInput, gitCss.messageInput)}
              placeholder={t('commitPlaceholder')}
              aria-label={t('commitPlaceholder')}
              rows={3}
              value={commitMsg}
              disabled={busy}
              onChange={(event) => { cancelReview(); setCommitMsg(event.target.value); setCommitError(null) }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void prepareCommit()
                }
              }}
            />
            <button
              type="button"
              className={css.gitCommitButton}
              disabled={mutationDisabled || review?.status === 'preparing' || commitMsg.trim() === '' || stagedEntries.length === 0}
              onClick={() => { void prepareCommit() }}
            >
              {t('commit')}
            </button>
          </div>
          {commitError !== null && <div className={css.gitError}>{commitError}</div>}

          <div className={css.gitSection}>
            <div className={css.gitSectionHeader}><span>{t('history')}</span></div>
            {logEntries.map(entry => (
              <div
                key={entry.hashFull}
                role="button"
                tabIndex={0}
                className={css.gitLogRow}
                title={`${entry.author} · ${entry.date}\n${entry.hashFull}`}
                onClick={() => { openCommitDiff(entry) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openCommitDiff(entry)
                  }
                }}
                onContextMenu={(event) => { openHistoryMenu(event, entry) }}
              >
                <span className={css.gitLogLine1}>
                  <span className={css.gitLogHash}>{entry.hash}</span>
                  <span className={css.gitLogSubject}>{entry.subject}</span>
                </span>
                <span className={css.gitLogLine2}>
                  {refNames(entry.refs).map(ref => (
                    <span key={ref} className={css.gitLogRef}>{ref}</span>
                  ))}
                  <span className={css.gitLogMeta}>{entry.author} · {relativeTime(entry.date)}</span>
                </span>
              </div>
            ))}
            {!logEnded && (
              <button
                type="button"
                className={css.gitLogMore}
                disabled={logLoadingMore || busy}
                onClick={() => { void loadMoreLog() }}
              >
                {logLoadingMore ? t('loading') : t('loadMore')}
              </button>
            )}
          </div>

          {/*
            The one shared file-row context menu, positioned at the right-click
            cursor (portal so the panel's overflow clip cannot crop it).
          */}
          <Menu
            open={fileMenu !== null}
            onClose={() => { setFileMenu(null) }}
            items={[
              { id: 'open', label: t('openEditor'), icon: <IconCodeOutline16 size={14} /> },
              fileMenu?.staged === true
                ? { id: 'stage', label: t('unstage'), icon: <IconTrashOutline16 size={14} /> }
                : { id: 'stage', label: t('stage'), icon: <IconBranchOutline16 size={14} /> },
              ...(fileMenu !== null && !isUntracked(fileMenu.entry)
                ? [{ id: 'discard', label: t('discard'), icon: <IconTrashOutline16 size={14} />, danger: true }]
                : []),
              { type: 'separator', id: 'sep1' },
              { id: 'relative', label: t('copyRelative'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'absolute', label: t('copyAbsolute'), icon: <IconCopyOutline16 size={14} /> },
            ]}
            onSelect={(id) => {
              const target = fileMenu
              if (target === null) return
              setFileMenu(null)
              if (id === 'open') {
                onOpenFile(target.entry.path)
                return
              }
              if (id === 'stage') {
                void stageEntries([target.entry], target.staged)
                return
              }
              if (id === 'discard' && repository !== undefined) {
                runConfirmed({
                  title: t('discardTitle'),
                  description: t('discardDesc', { path: target.entry.path }),
                  confirmLabel: t('discard'),
                  repository,
                  onConfirm: () => git.gitDiscard(scope, repository.root, repository.head, target.entry.path),
                })
                return
              }
              if (id === 'relative') {
                copy(relativeTo(scope.cwd ?? '', target.entry.path))
                return
              }
              if (id === 'absolute') copy(target.entry.path)
            }}
            portal
            align="start"
            getAnchorRect={() => (fileMenu === null ? null : new DOMRect(fileMenu.x, fileMenu.y, 0, 0))}
            anchor={<span />}
          />

          {/* The shared history-row context menu. */}
          <Menu
            open={historyMenu !== null}
            onClose={() => { setHistoryMenu(null) }}
            items={[
              { id: 'view', label: t('viewCommitDiff') },
              { id: 'copyShort', label: t('copyShortHash'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'copyFull', label: t('copyFullHash'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'copySubject', label: t('copySubject'), icon: <IconCopyOutline16 size={14} /> },
              { type: 'separator', id: 'sep2' },
              { id: 'revert', label: t('revertCommit'), danger: true },
              { id: 'cherryPick', label: t('cherryPickCommit'), danger: true },
            ]}
            onSelect={(id) => {
              const target = historyMenu
              if (target === null) return
              setHistoryMenu(null)
              if (id === 'view') {
                openCommitDiff(target.entry)
                return
              }
              if (id === 'copyShort') {
                copy(target.entry.hash)
                return
              }
              if (id === 'copyFull') {
                copy(target.entry.hashFull)
                return
              }
              if (id === 'copySubject') {
                copy(target.entry.subject)
                return
              }
              if (id === 'revert' && repository !== undefined) {
                runConfirmed({
                  title: t('revertTitle'),
                  description: t('revertDesc', { subject: target.entry.subject }),
                  confirmLabel: t('revertCommit'),
                  repository,
                  onConfirm: () => git.gitRevert(scope, repository.root, repository.head, target.entry.hashFull),
                })
                return
              }
              if (id === 'cherryPick' && repository !== undefined) {
                runConfirmed({
                  title: t('cherryPickTitle'),
                  description: t('cherryPickDesc', { subject: target.entry.subject }),
                  confirmLabel: t('cherryPickCommit'),
                  repository,
                  onConfirm: () => git.gitCherryPick(scope, repository.root, repository.head, target.entry.hashFull),
                })
              }
            }}
            portal
            align="start"
            getAnchorRect={() => (historyMenu === null ? null : new DOMRect(historyMenu.x, historyMenu.y, 0, 0))}
            anchor={<span />}
          />

          {/* Destructive actions land here first: Cancel / Confirm. */}
          <Modal
            open={confirm !== null}
            onClose={() => { setConfirm(null) }}
            title={confirm?.title ?? ''}
            closeLabel={t('cancel')}
            footer={(
              <>
                <Button variant="outline" onClick={() => { setConfirm(null) }}>{t('cancel')}</Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    const pending = confirm
                    if (pending === null) return
                    setConfirm(null)
                    void runMutation(pending.onConfirm)
                  }}
                >
                  {confirm?.confirmLabel ?? ''}
                </Button>
              </>
            )}
          >
            <p className={css.gitConfirmDesc}>{confirm?.description}</p>
            {confirm !== null && provenance(confirm.repository)}
          </Modal>
        </>
      )}
      <Modal
        open={review !== null}
        onClose={cancelReview}
        title={t('gitCommitReview')}
        closeLabel={t('cancel')}
        footer={(
          <>
            <Button variant="outline" onClick={cancelReview}>{t('cancel')}</Button>
            <Button variant="primary" disabled={review?.status !== 'ready' || busy} onClick={() => { void commit() }}>
              {t('gitCommitConfirm')}
            </Button>
          </>
        )}
      >
        {review?.status === 'preparing' && <div className={css.gitPlaceholder}>{t('loading')}</div>}
        {review?.status === 'ready' && (
          <>
            {provenance(review.preview)}
            <pre className={gitCss.reviewMessage} aria-label={t('gitCommitMessage')}>{review.preview.message}</pre>
          </>
        )}
      </Modal>
      <Modal
        open={comparison !== null}
        onClose={closeComparison}
        title={t('gitCompare')}
        closeLabel={t('close')}
        className={clsx(gitCss.compareDialog)}
      >
        {comparison?.status === 'loading' && <div className={css.gitPlaceholder}>{t('loading')}</div>}
        {comparison?.status === 'error' && <div role="alert" className={css.gitError}>{comparison.message}</div>}
        {comparison?.status === 'loaded' && (
          comparison.result.status === 'unavailable'
            ? <div className={css.gitPlaceholder}>{t(COMPARE_REASON[comparison.result.reason])}</div>
            : (
              <>
                <div className={gitCss.provenance}>
                  <div>{t('gitRepository', { root: comparison.result.repositoryRoot })}</div>
                  <div>{t('gitCompareBase', { ref: comparison.result.baseRef, head: comparison.result.baseHead })}</div>
                  <div>{t('gitHead', { head: comparison.result.head })}</div>
                </div>
                {comparison.result.usedFallback && (
                  <p role="status" className={css.gitConfirmDesc}>{t('gitCompareFallback', { ref: comparison.result.baseRef })}</p>
                )}
                <DiffView diff={comparison.result.diff} />
                {comparison.result.diff === '' && <div className={css.gitEmpty}>{t('diffEmpty')}</div>}
              </>
            )
        )}
      </Modal>
    </div>
  )
}
