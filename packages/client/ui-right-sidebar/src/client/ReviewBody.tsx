/** Git review panel backed by Workspace Isolation comparison data with line-level comments. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  WorkspaceIsolationComparisonView,
  WorkspaceIsolationFileChangeView,
  WorkspaceIsolationLeaseId,
  WorkspaceIsolationLeaseView,
} from '@deepseek-ai/dsh-api-workspace-isolation-controller/types'
import { useDiffPreferences } from './diff-preferences-store.ts'
import { PRChecksView } from './PRChecksView.tsx'
import { buildFixBrokenChecksPrompt, getBrokenChecks } from './pr-checks-fix-prompt.ts'
import type { PRSummary } from './pr-checks-types.ts'
import css from './SidebarContributors.module.css'

/** Structured comment anchored to a diff line. */
export interface DiffLineComment {
  /** Unique comment identity. */
  readonly id: string
  /** Repository-relative file path. */
  readonly filePath: string
  /** Anchored line number. */
  readonly line: number
  /** Diff side where comment applies. */
  readonly side: 'modified' | 'original'
  /** User-authored feedback text. */
  readonly text: string
  /** Milliseconds epoch timestamp. */
  readonly createdAt: number
  /** Review status lifecycle. */
  readonly status: 'draft' | 'saved' | 'sent'
}

/** Parsed single diff line with numbers and change classification. */
export interface ParsedDiffLine {
  readonly oldLineNumber?: number
  readonly newLineNumber?: number
  readonly type: 'context' | 'addition' | 'deletion'
  readonly text: string
}

/** Parsed hunk of continuous diff lines. */
export interface ParsedDiffHunk {
  readonly header: string
  readonly lines: readonly ParsedDiffLine[]
}

/** Parsed file diff containing path and hunks. */
export interface ParsedDiffFile {
  readonly path: string
  readonly hunks: readonly ParsedDiffHunk[]
}

/**
 * Parse unified git diff text into structured files, hunks, and lines.
 * @param patch - Raw unified diff text.
 * @returns Array of parsed diff files.
 */
export function parseDiff(patch: string): readonly ParsedDiffFile[] {
  if (!patch.trim()) return []
  const lines = patch.split('\n')
  const files: ParsedDiffFile[] = []
  let currentFile: { path: string; hunks: ParsedDiffHunk[] } | null = null
  let currentHunk: { header: string; lines: ParsedDiffLine[] } | null = null
  let oldLine = 1
  let newLine = 1

  for (const rawLine of lines) {
    if (rawLine.startsWith('diff --git')) {
      const match = rawLine.match(/diff --git a\/(.+) b\/(.+)/)
      const path = match ? match[2]! : rawLine.slice(11).trim()
      currentHunk = null
      currentFile = { path, hunks: [] }
      files.push(currentFile)
      continue
    }

    if (rawLine.startsWith('+++ b/')) {
      const path = rawLine.slice(6).trim()
      if (currentFile) {
        currentFile.path = path
      } else {
        currentFile = { path, hunks: [] }
        files.push(currentFile)
      }
      continue
    }

    if (rawLine.startsWith('@@ ')) {
      const match = rawLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1]!, 10)
        newLine = parseInt(match[2]!, 10)
      }
      currentHunk = { header: rawLine, lines: [] }
      if (!currentFile) {
        currentFile = { path: 'changes', hunks: [] }
        files.push(currentFile)
      }
      currentFile.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) {
      continue
    }

    if (rawLine.startsWith('+')) {
      currentHunk.lines.push({
        newLineNumber: newLine++,
        type: 'addition',
        text: rawLine.slice(1),
      })
    } else if (rawLine.startsWith('-')) {
      currentHunk.lines.push({
        oldLineNumber: oldLine++,
        type: 'deletion',
        text: rawLine.slice(1),
      })
    } else if (rawLine.startsWith(' ')) {
      currentHunk.lines.push({
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
        type: 'context',
        text: rawLine.slice(1),
      })
    }
  }

  return files
}

/** Paired diff lines aligned for side-by-side presentation. */
export interface SideBySideRow {
  readonly left?: ParsedDiffLine
  readonly right?: ParsedDiffLine
}

/**
 * Align diff lines into side-by-side rows matching deletions with additions.
 * @param lines - Hunk lines in unified diff order.
 * @returns Array of paired lines.
 */
export function buildSideBySideRows(lines: readonly ParsedDiffLine[]): readonly SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.type === 'context') {
      rows.push({ left: line, right: line })
      i++
    } else if (line.type === 'deletion') {
      const dels: ParsedDiffLine[] = []
      while (i < lines.length && lines[i]!.type === 'deletion') {
        dels.push(lines[i]!)
        i++
      }
      const adds: ParsedDiffLine[] = []
      while (i < lines.length && lines[i]!.type === 'addition') {
        adds.push(lines[i]!)
        i++
      }
      const maxLen = Math.max(dels.length, adds.length)
      for (let k = 0; k < maxLen; k++) {
        const left = dels[k]
        const right = adds[k]
        rows.push({
          ...(left !== undefined ? { left } : {}),
          ...(right !== undefined ? { right } : {}),
        })
      }
    } else if (line.type === 'addition') {
      rows.push({ right: line })
      i++
    } else {
      i++
    }
  }
  return rows
}

function renderDiffText(text: string, showWhitespace: boolean): React.ReactNode {
  if (!showWhitespace) return text
  return text.split('').map((char, idx) => {
    if (char === ' ') return <span key={idx} className={css.whitespaceSpace}>·</span>
    if (char === '\t') return <span key={idx} className={css.whitespaceTab}>→   </span>
    return char
  })
}

export interface ReviewBodyInjected {
  readonly list: () => Promise<{ readonly items: readonly WorkspaceIsolationLeaseView[] }>
  readonly compare: (leaseId: WorkspaceIsolationLeaseId) => Promise<{ readonly comparison: WorkspaceIsolationComparisonView }>
  readonly sendCommentToAgent?: ((comment: DiffLineComment) => Promise<void> | void) | undefined
  readonly sendPromptToAgent?: ((prompt: string) => Promise<void> | void) | undefined
  readonly prSummary?: PRSummary | null | undefined
  readonly getPRSummary?: ((branch?: string) => Promise<PRSummary | null> | PRSummary | null) | undefined
  readonly rerunChecks?: ((pr: PRSummary) => Promise<void> | void) | undefined
}

type ReviewBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'rightSidebarContributors'> & ReviewBodyInjected

interface ActiveDraft {
  readonly filePath: string
  readonly line: number
  readonly side: 'modified' | 'original'
  readonly text: string
}

export function ReviewBody({
  t,
  list,
  compare,
  sendCommentToAgent,
  sendPromptToAgent,
  prSummary,
  getPRSummary,
  rerunChecks,
}: ReviewBodyProps): JSX.Element {
  const [prefs, setPrefs] = useDiffPreferences()
  const [leases, setLeases] = useState<readonly WorkspaceIsolationLeaseView[]>([])
  const [comparison, setComparison] = useState<WorkspaceIsolationComparisonView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [comments, setComments] = useState<readonly DiffLineComment[]>([])
  const [draft, setDraft] = useState<ActiveDraft | null>(null)
  const [activeSubtab, setActiveSubtab] = useState<'diff' | 'checks'>('diff')
  const [pr, setPr] = useState<PRSummary | null>(prSummary ?? null)

  useEffect(() => {
    if (prSummary !== undefined) {
      setPr(prSummary)
    }
  }, [prSummary])

  const refreshPR = useCallback(async () => {
    if (getPRSummary) {
      try {
        const result = await getPRSummary(comparison?.lease.branch)
        setPr(result)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }, [getPRSummary, comparison?.lease.branch])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setError(undefined)
      setLeases((await list()).items)
      setComparison(undefined)
      setComments([])
      setDraft(null)
      if (getPRSummary) {
        const result = await getPRSummary()
        setPr(result)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [list, getPRSummary])

  useEffect(() => { void refresh() }, [refresh])

  const inspect = useCallback(async (leaseId: WorkspaceIsolationLeaseId) => {
    setBusy(true)
    try {
      setError(undefined)
      const res = await compare(leaseId)
      setComparison(res.comparison)
      setComments([])
      setDraft(null)
      if (getPRSummary) {
        const result = await getPRSummary(res.comparison.lease.branch)
        setPr(result)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [compare, getPRSummary])

  const sendComment = useCallback(async (comment: DiffLineComment) => {
    try {
      const sentComment: DiffLineComment = { ...comment, status: 'sent' }
      if (sendCommentToAgent) {
        await sendCommentToAgent(sentComment)
      }
      setComments(prev => prev.map(c => (c.id === comment.id ? sentComment : c)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [sendCommentToAgent])

  const sendAllComments = useCallback(async () => {
    for (const comment of comments) {
      if (comment.status !== 'sent') {
        await sendComment(comment)
      }
    }
  }, [comments, sendComment])

  const handleFixBrokenChecks = useCallback(async (targetPR: PRSummary) => {
    try {
      const prompt = buildFixBrokenChecksPrompt(targetPR)
      if (sendPromptToAgent) {
        await sendPromptToAgent(prompt)
      } else if (sendCommentToAgent) {
        await sendCommentToAgent({
          id: `pr-fix-${Date.now()}`,
          filePath: 'CI',
          line: 1,
          side: 'modified',
          text: prompt,
          createdAt: Date.now(),
          status: 'sent',
        })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [sendPromptToAgent, sendCommentToAgent])

  const parsedFiles = useMemo(() => {
    return comparison?.patch ? parseDiff(comparison.patch) : []
  }, [comparison?.patch])

  const brokenChecksCount = pr ? getBrokenChecks(pr.checks).length : 0

  return (
    <section className={css.panel}>
      <div className={css.subtabs}>
        <button
          type="button"
          className={`${css.subtabBtn} ${activeSubtab === 'diff' ? css.subtabBtnActive : ''}`}
          onClick={() => { setActiveSubtab('diff') }}
        >
          {t('review.subtabDiff')}
        </button>
        <button
          type="button"
          className={`${css.subtabBtn} ${activeSubtab === 'checks' ? css.subtabBtnActive : ''}`}
          onClick={() => { setActiveSubtab('checks') }}
        >
          {t('review.subtabChecks')}
          {brokenChecksCount > 0 ? (
            <span className={css.subtabBadgeError}>{brokenChecksCount}</span>
          ) : null}
        </button>
      </div>

      {activeSubtab === 'checks' ? (
        <PRChecksView
          pr={pr}
          onFixBrokenChecks={handleFixBrokenChecks}
          onRerunChecks={rerunChecks}
          onRefresh={refreshPR}
          busy={busy}
          t={t}
        />
      ) : (
        <>
          <div className={css.toolbar}>
            <button type="button" className={css.button} onClick={() => { void refresh() }} disabled={busy}>
              {t('review.refresh')}
            </button>
          </div>
      {leases.length === 0 && !busy ? <p className={css.muted}>{t('review.empty')}</p> : null}
      {leases.length > 0 ? (
        <select
          className={css.select}
          defaultValue=""
          onChange={event => {
            if (event.target.value !== '') void inspect(event.target.value as WorkspaceIsolationLeaseId)
          }}
          aria-label={t('review.title')}
        >
          <option value="">{t('review.select')}</option>
          {leases.map(lease => <option key={lease.leaseId} value={lease.leaseId}>{lease.branch}</option>)}
        </select>
      ) : null}
      {comparison !== undefined ? (
        <>
          <p className={css.muted}>{t('review.branch')}: {comparison.lease.branch}</p>
          <h3 className={css.heading}>{t('review.changedFiles')}</h3>
          <ul className={css.items}>
            {comparison.changedFiles.map((file: WorkspaceIsolationFileChangeView) => (
              <li key={file.path} className={css.item}>{file.path}</li>
            ))}
          </ul>

          {comments.length > 0 ? (
            <div className={css.commentsOverview}>
              <h3 className={css.heading}>
                {t('review.commentsTitle').replace('{count}', String(comments.length))}
              </h3>
              <button type="button" className={css.primaryButton} onClick={() => { void sendAllComments() }}>
                {t('review.sendAllToAgent')}
              </button>
            </div>
          ) : null}

          <h3 className={css.heading}>{t('review.diffViewer')}</h3>
          <div className={css.diffToolbar}>
            <div className={css.diffToolbarGroup}>
              <button
                type="button"
                className={`${css.diffToolbarBtn} ${prefs.diffViewMode === 'inline' ? css.diffToolbarBtnActive : ''}`}
                onClick={() => { setPrefs({ diffViewMode: 'inline' }) }}
                aria-label={t('review.viewInline')}
              >
                {t('review.viewInline')}
              </button>
              <button
                type="button"
                className={`${css.diffToolbarBtn} ${prefs.diffViewMode === 'side-by-side' ? css.diffToolbarBtnActive : ''}`}
                onClick={() => { setPrefs({ diffViewMode: 'side-by-side' }) }}
                aria-label={t('review.viewSideBySide')}
              >
                {t('review.viewSideBySide')}
              </button>
            </div>
            <button
              type="button"
              className={`${css.diffToolbarBtn} ${prefs.diffWordWrap ? css.diffToolbarBtnActive : ''}`}
              onClick={() => { setPrefs({ diffWordWrap: !prefs.diffWordWrap }) }}
              aria-label={t('review.wordWrap')}
            >
              {t('review.wordWrap')}
            </button>
            <button
              type="button"
              className={`${css.diffToolbarBtn} ${prefs.showWhitespace ? css.diffToolbarBtnActive : ''}`}
              onClick={() => { setPrefs({ showWhitespace: !prefs.showWhitespace }) }}
              aria-label={t('review.showWhitespace')}
            >
              {t('review.showWhitespace')}
            </button>
          </div>
          {parsedFiles.length > 0 ? (
            <div className={css.diffViewer}>
              {parsedFiles.map(file => (
                <div key={file.path} className={css.diffFile}>
                  <div className={css.diffFileHeader}>{file.path}</div>
                  {file.hunks.map((hunk, hunkIdx) => (
                    <div key={hunkIdx}>
                      <div className={css.diffHunkHeader}>{hunk.header}</div>
                      {prefs.diffViewMode === 'side-by-side' ? (
                        buildSideBySideRows(hunk.lines).map((row, rowIdx) => {
                          const leftLineNum = row.left?.oldLineNumber
                          const rightLineNum = row.right?.newLineNumber
                          return (
                            <div key={rowIdx}>
                              <div className={css.diffSideBySideRow}>
                                {row.left ? (
                                  <div className={`${css.diffSideLeft} ${row.left.type === 'deletion' ? css.diffDeletion : ''}`}>
                                    <span className={css.diffLineOldNum}>{row.left.oldLineNumber ?? ''}</span>
                                    <span className={css.diffLineSign}>{row.left.type === 'deletion' ? '-' : ' '}</span>
                                    <span className={`${css.diffLineContent} ${prefs.diffWordWrap ? css.diffLineWrap : css.diffLineNoWrap}`}>
                                      {renderDiffText(row.left.text, prefs.showWhitespace)}
                                    </span>
                                    <button
                                      type="button"
                                      className={css.diffAddCommentBtn}
                                      title={t('review.addLineComment')}
                                      aria-label={`${t('review.addLineComment')} ${file.path}:${row.left.oldLineNumber}`}
                                      onClick={() => { setDraft({ filePath: file.path, line: row.left!.oldLineNumber ?? 1, side: 'original', text: '' }) }}
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : (
                                  <div className={css.diffEmptyCol} />
                                )}
                                {row.right ? (
                                  <div className={`${css.diffSideRight} ${row.right.type === 'addition' ? css.diffAddition : ''}`}>
                                    <span className={css.diffLineNewNum}>{row.right.newLineNumber ?? ''}</span>
                                    <span className={css.diffLineSign}>{row.right.type === 'addition' ? '+' : ' '}</span>
                                    <span className={`${css.diffLineContent} ${prefs.diffWordWrap ? css.diffLineWrap : css.diffLineNoWrap}`}>
                                      {renderDiffText(row.right.text, prefs.showWhitespace)}
                                    </span>
                                    <button
                                      type="button"
                                      className={css.diffAddCommentBtn}
                                      title={t('review.addLineComment')}
                                      aria-label={`${t('review.addLineComment')} ${file.path}:${row.right.newLineNumber}`}
                                      onClick={() => { setDraft({ filePath: file.path, line: row.right!.newLineNumber ?? 1, side: 'modified', text: '' }) }}
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : (
                                  <div className={css.diffEmptyCol} />
                                )}
                              </div>
                              {leftLineNum ? (
                                <>
                                  {draft !== null && draft.filePath === file.path && draft.line === leftLineNum && draft.side === 'original' ? (
                                    <div className={css.commentBox}>
                                      <textarea
                                        className={css.commentTextarea}
                                        placeholder={t('review.commentPlaceholder')}
                                        value={draft.text}
                                        onChange={e => { setDraft(prev => (prev ? { ...prev, text: e.target.value } : null)) }}
                                      />
                                      <div className={css.commentActions}>
                                        <button type="button" className={css.button} onClick={() => { setDraft(null) }}>
                                          {t('review.cancelComment')}
                                        </button>
                                        <button
                                          type="button"
                                          className={css.primaryButton}
                                          disabled={!draft.text.trim()}
                                          onClick={() => {
                                            if (!draft.text.trim()) return
                                            setComments(prev => [
                                              ...prev,
                                              {
                                                id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                                filePath: draft.filePath,
                                                line: draft.line,
                                                side: draft.side,
                                                text: draft.text.trim(),
                                                createdAt: Date.now(),
                                                status: 'saved',
                                              },
                                            ])
                                            setDraft(null)
                                          }}
                                        >
                                          {t('review.saveComment')}
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                  {comments.filter(c => c.filePath === file.path && c.line === leftLineNum && c.side === 'original').map(c => (
                                    <div key={c.id} className={css.commentCard}>
                                      <div className={css.commentHeader}>
                                        <span>{t('review.lineRef', { line: c.line, side: c.side })}</span>
                                        <span className={`${css.badge} ${c.status === 'sent' ? css.badgeSent : css.badgeSaved}`}>
                                          {c.status === 'sent' ? t('review.sentStatus') : t('review.savedStatus')}
                                        </span>
                                      </div>
                                      <div className={css.commentText}>{c.text}</div>
                                      <div className={css.commentActions}>
                                        <button
                                          type="button"
                                          className={css.button}
                                          onClick={() => { setComments(prev => prev.filter(item => item.id !== c.id)) }}
                                        >
                                          {t('review.deleteComment')}
                                        </button>
                                        {c.status !== 'sent' ? (
                                          <button
                                            type="button"
                                            className={css.primaryButton}
                                            onClick={() => { void sendComment(c) }}
                                          >
                                            {t('review.sendToAgent')}
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </>
                              ) : null}
                              {rightLineNum ? (
                                <>
                                  {draft !== null && draft.filePath === file.path && draft.line === rightLineNum && draft.side === 'modified' ? (
                                    <div className={css.commentBox}>
                                      <textarea
                                        className={css.commentTextarea}
                                        placeholder={t('review.commentPlaceholder')}
                                        value={draft.text}
                                        onChange={e => { setDraft(prev => (prev ? { ...prev, text: e.target.value } : null)) }}
                                      />
                                      <div className={css.commentActions}>
                                        <button type="button" className={css.button} onClick={() => { setDraft(null) }}>
                                          {t('review.cancelComment')}
                                        </button>
                                        <button
                                          type="button"
                                          className={css.primaryButton}
                                          disabled={!draft.text.trim()}
                                          onClick={() => {
                                            if (!draft.text.trim()) return
                                            setComments(prev => [
                                              ...prev,
                                              {
                                                id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                                filePath: draft.filePath,
                                                line: draft.line,
                                                side: draft.side,
                                                text: draft.text.trim(),
                                                createdAt: Date.now(),
                                                status: 'saved',
                                              },
                                            ])
                                            setDraft(null)
                                          }}
                                        >
                                          {t('review.saveComment')}
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                  {comments.filter(c => c.filePath === file.path && c.line === rightLineNum && c.side === 'modified').map(c => (
                                    <div key={c.id} className={css.commentCard}>
                                      <div className={css.commentHeader}>
                                        <span>{t('review.lineRef', { line: c.line, side: c.side })}</span>
                                        <span className={`${css.badge} ${c.status === 'sent' ? css.badgeSent : css.badgeSaved}`}>
                                          {c.status === 'sent' ? t('review.sentStatus') : t('review.savedStatus')}
                                        </span>
                                      </div>
                                      <div className={css.commentText}>{c.text}</div>
                                      <div className={css.commentActions}>
                                        <button
                                          type="button"
                                          className={css.button}
                                          onClick={() => { setComments(prev => prev.filter(item => item.id !== c.id)) }}
                                        >
                                          {t('review.deleteComment')}
                                        </button>
                                        {c.status !== 'sent' ? (
                                          <button
                                            type="button"
                                            className={css.primaryButton}
                                            onClick={() => { void sendComment(c) }}
                                          >
                                            {t('review.sendToAgent')}
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </>
                              ) : null}
                            </div>
                          )
                        })
                      ) : (
                        hunk.lines.map((line, lineIdx) => {
                          const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 1
                          const side = line.type === 'deletion' ? 'original' : 'modified'
                          const lineComments = comments.filter(c => c.filePath === file.path && c.line === lineNum && c.side === side)
                          const isDrafting = draft !== null && draft.filePath === file.path && draft.line === lineNum && draft.side === side
                          return (
                            <div key={lineIdx}>
                              <div
                                className={`${css.diffLine} ${line.type === 'addition' ? css.diffAddition : line.type === 'deletion' ? css.diffDeletion : ''}`}
                              >
                                <span className={css.diffLineOldNum}>{line.oldLineNumber ?? ''}</span>
                                <span className={css.diffLineNewNum}>{line.newLineNumber ?? ''}</span>
                                <span className={css.diffLineSign}>
                                  {line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '}
                                </span>
                                <span className={`${css.diffLineContent} ${prefs.diffWordWrap ? css.diffLineWrap : css.diffLineNoWrap}`}>
                                  {renderDiffText(line.text, prefs.showWhitespace)}
                                </span>
                                <button
                                  type="button"
                                  className={css.diffAddCommentBtn}
                                  title={t('review.addLineComment')}
                                  aria-label={`${t('review.addLineComment')} ${file.path}:${lineNum}`}
                                  onClick={() => { setDraft({ filePath: file.path, line: lineNum, side, text: '' }) }}
                                >
                                  +
                                </button>
                              </div>
                              {isDrafting ? (
                                <div className={css.commentBox}>
                                  <textarea
                                    className={css.commentTextarea}
                                    placeholder={t('review.commentPlaceholder')}
                                    value={draft.text}
                                    onChange={e => { setDraft(prev => (prev ? { ...prev, text: e.target.value } : null)) }}
                                  />
                                  <div className={css.commentActions}>
                                    <button type="button" className={css.button} onClick={() => { setDraft(null) }}>
                                      {t('review.cancelComment')}
                                    </button>
                                    <button
                                      type="button"
                                      className={css.primaryButton}
                                      disabled={!draft.text.trim()}
                                      onClick={() => {
                                        if (!draft.text.trim()) return
                                        setComments(prev => [
                                          ...prev,
                                          {
                                            id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                            filePath: draft.filePath,
                                            line: draft.line,
                                            side: draft.side,
                                            text: draft.text.trim(),
                                            createdAt: Date.now(),
                                            status: 'saved',
                                          },
                                        ])
                                        setDraft(null)
                                      }}
                                    >
                                      {t('review.saveComment')}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              {lineComments.map(c => (
                                <div key={c.id} className={css.commentCard}>
                                  <div className={css.commentHeader}>
                                    <span>{t('review.lineRef', { line: c.line, side: c.side })}</span>
                                    <span className={`${css.badge} ${c.status === 'sent' ? css.badgeSent : css.badgeSaved}`}>
                                      {c.status === 'sent' ? t('review.sentStatus') : t('review.savedStatus')}
                                    </span>
                                  </div>
                                  <div className={css.commentText}>{c.text}</div>
                                  <div className={css.commentActions}>
                                    <button
                                      type="button"
                                      className={css.button}
                                      onClick={() => { setComments(prev => prev.filter(item => item.id !== c.id)) }}
                                    >
                                      {t('review.deleteComment')}
                                    </button>
                                    {c.status !== 'sent' ? (
                                      <button
                                        type="button"
                                        className={css.primaryButton}
                                        onClick={() => { void sendComment(c) }}
                                      >
                                        {t('review.sendToAgent')}
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        })
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <pre className={css.output}>{comparison.patch || t('review.noPatch')}</pre>
          )}
        </>
      ) : null}
        </>
      )}
      {busy && leases.length === 0 ? <p className={css.muted}>{t('review.loading')}</p> : null}
      {error !== undefined ? <p className={css.error} role="alert">{error}</p> : null}
    </section>
  )
}
