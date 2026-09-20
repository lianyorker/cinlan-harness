/** A per-turn comparison view shared by the registered sidebar extensions. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceDiffHunk } from '@deepseek-ai/dsh-workspace-changes/types'
import type { ChangesDiff, ChangesReviewCoordinates, ChangesSummary } from '../changes.ts'
import type { ReviewReader, ReviewRead } from './review-read.ts'
import type { NS } from './locales.ts'
import css from './ReviewTab.module.css'

/** Lines drawn before the tab stops; a coarse comparison of a file near the byte cap would otherwise draw every line. */
export const MAX_RENDERED_LINES = 5000

const GROUPED = new Intl.NumberFormat('en-US')

/** One drawn line of a hunk with its line numbers on each side. */
export interface DiffRow {
  kind: 'add' | 'del' | 'context'
  old: number | undefined
  new: number | undefined
  text: string
}

/** One side-by-side row: the old side, the new side, or both. */
export interface SplitRow {
  left?: { no: number; text: string; kind: 'del' | 'context' }
  right?: { no: number; text: string; kind: 'add' | 'context' }
}

/**
 * Number a hunk's lines: context lines count on both sides, deletions on the
 * old side, additions on the new side.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function hunkRows(hunk: WorkspaceDiffHunk): DiffRow[] {
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  return hunk.lines.map((line) => {
    const text = line.slice(1)
    switch (line[0]) {
      case '+': return { kind: 'add', old: undefined, new: newNo++, text }
      case '-': return { kind: 'del', old: oldNo++, new: undefined, text }
      default: return { kind: 'context', old: oldNo++, new: newNo++, text }
    }
  })
}

/**
 * Pair a hunk's lines for the side-by-side view: each run of deletions is
 * aligned with the run of additions that follows it, row by row, and context
 * lines sit on both sides.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function splitRows(hunk: WorkspaceDiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: NonNullable<SplitRow['left']>[] = []
  let adds: NonNullable<SplitRow['right']>[] = []
  const flush = (): (void) => {
    for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
      const left = dels[at]
      const right = adds[at]
      rows.push({ ...left === undefined ? {} : { left }, ...right === undefined ? {} : { right } })
    }
    dels = []
    adds = []
  }
  for (const row of hunkRows(hunk)) {
    if (row.kind === 'del') dels.push({ no: row.old as number, text: row.text, kind: 'del' })
    else if (row.kind === 'add') adds.push({ no: row.new as number, text: row.text, kind: 'add' })
    else {
      flush()
      rows.push({ left: { no: row.old as number, text: row.text, kind: 'context' }, right: { no: row.new as number, text: row.text, kind: 'context' } })
    }
  }
  flush()
  return rows
}

/**
 * The hunks to draw, cut at {@link MAX_RENDERED_LINES} lines in total.
 * @param hunks - served hunks.
 * @returns the hunks with the last one shortened as needed, and whether anything was cut.
 */
export function renderedHunks(hunks: readonly WorkspaceDiffHunk[]): { hunks: WorkspaceDiffHunk[]; truncated: boolean } {
  let budget = MAX_RENDERED_LINES
  const kept: WorkspaceDiffHunk[] = []
  for (const hunk of hunks) {
    if (budget === 0) return { hunks: kept, truncated: true }
    kept.push(hunk.lines.length <= budget ? hunk : { ...hunk, lines: hunk.lines.slice(0, budget) })
    budget -= Math.min(budget, hunk.lines.length)
  }
  return { hunks: kept, truncated: hunks.some((hunk, at) => kept[at] !== hunk) }
}

/** The one-line fact about a text comparison worth stating above its hunks, if any. */
function noteOf(diff: Extract<ChangesDiff, { kind: 'text' }>): 'diff.created' | 'diff.deleted' | 'diff.unchanged' | undefined {
  if (!diff.before) return 'diff.created'
  if (!diff.after) return 'diff.deleted'
  if (diff.hunks.length === 0) return 'diff.unchanged'
  return undefined
}

/** Plain data and callbacks accepted by both sidebar adapters. */
export interface ReviewPanelProps extends ChangesReviewCoordinates, ReviewReader, PropsLocale<typeof NS> {
  initialIndex: number
  openFile: (path: string) => void | Promise<void>
}

/**
 * Read the selected file only; selection changes and unmount abort outstanding reads.
 * @param props - recorded coordinates, read callbacks, localized copy, and a file opener.
 * @returns the selector, presentation controls, and selected comparison.
 */
export function ReviewPanel({
  sessionId, seq, turn, initialIndex, summary: readSummary, diff: readDiff, openFile, t,
}: ReviewPanelProps): ReactNode {
  const [summary, setSummary] = useState<ReviewRead<ChangesSummary> | 'loading'>('loading')
  const [index, setIndex] = useState(initialIndex)
  const [openError, setOpenError] = useState<string>()
  const preview = async (path: string) => {
    setOpenError(undefined)
    try { await openFile(path) }
    catch { setOpenError(path) } // The sidebar reports a failed Session directory or file lookup.
  }
  const [split, setSplit] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [summaryRevision, retrySummary] = useState(0)
  const [diffRevision, retryDiff] = useState(0)
  const [comparison, setComparison] = useState<ReviewRead<ChangesDiff> | 'loading'>('loading')
  useEffect(() => {
    const controller = new AbortController()
    setSummary('loading')
    void readSummary(sessionId, seq, controller.signal).then((value) => {
      if (!controller.signal.aborted) setSummary(value)
    })
    return () => { controller.abort() }
  }, [sessionId, seq, readSummary, summaryRevision])
  useEffect(() => { setIndex(initialIndex) }, [initialIndex, sessionId, seq])
  const files = typeof summary === 'object' ? summary.files : []
  const selected = files[index] === undefined ? 0 : index
  const file = files[selected]
  useEffect(() => {
    const controller = new AbortController()
    setComparison('loading')
    if (file !== undefined) void readDiff(sessionId, seq, selected, controller.signal).then((value) => {
      if (!controller.signal.aborted) setComparison(value)
    })
    return () => { controller.abort() }
  }, [sessionId, seq, selected, file, readDiff, diffRevision])
  return <div className={css.root} data-changes-review data-review-state={typeof summary === 'object' ? 'ready' : summary}>
    <div className={css.header}>
      {file === undefined ? <span className={css.selectorLabel}>{t('review.title', { turn: String(turn) })}</span>
        : <select className={css.selectorButton} value={selected} aria-label={t('review.selectFile')}
          data-review-file={file.path} onChange={(event) => { setIndex(Number(event.target.value)) }}>
          {files.map((entry, at) => <option key={entry.path} value={at}>{entry.display}</option>)}
        </select>}
      {file !== undefined && <span className={css.counts}>
        {file.binary === true ? t('changes.binary') : file.oversized === true ? t('changes.oversized') : <>
          <span className={css.added}>{t('changes.added', { count: GROUPED.format(file.added) })}</span>
          <span className={css.deleted}>{t('changes.deleted', { count: GROUPED.format(file.deleted) })}</span>
        </>}
      </span>}
    </div>
    <div className={css.header}>
      <Button size="sm" aria-pressed={split} aria-label={t('review.splitAria')} data-review-tool="split"
        onClick={() => { setSplit(value => !value) }}>{t(split ? 'review.unified' : 'review.split')}</Button>
      <Button size="sm" aria-pressed={wrap} aria-label={t('review.wrapAria')} data-review-tool="wrap"
        onClick={() => { setWrap(value => !value) }}>{t(wrap ? 'review.nowrap' : 'review.wrap')}</Button>
      {file !== undefined && <Button size="sm" aria-label={t('review.openFileAria', { name: file.display })}
        data-review-tool="open-file" onClick={() => { void preview(file.path) }}>{t('review.openFile')}</Button>}
    </div>
    {file !== undefined && openError === file.path && <p className={css.status} role="status">{t('presented.previewError')}</p>}
    {typeof summary === 'string' ? <ReadStatus state={summary} retry={() => { retrySummary(value => value + 1) }} t={t} />
      : file === undefined ? <p className={css.status}>{t('diff.unchanged')}</p>
        : typeof comparison === 'string' ? <ReadStatus state={comparison} retry={() => { retryDiff(value => value + 1) }} t={t} />
          : comparison.kind === 'binary' || comparison.kind === 'oversized'
            ? <p className={css.status}>{t(comparison.kind === 'binary' ? 'diff.binary' : 'diff.oversized')}</p>
            : <TextDiff diff={comparison} split={split} wrap={wrap} t={t} />}
  </div>
}

function ReadStatus({ state, retry, t }: { state: 'loading' | 'missing' | 'error'; retry: () => void } & PropsLocale<typeof NS>): ReactNode {
  return <div className={css.status} role="status">
    <span>{t(state === 'loading' ? 'diff.loading' : state === 'missing' ? 'diff.missing' : 'diff.error')}</span>
    {state === 'error' && <Button size="sm" onClick={retry}>{t('diff.retry')}</Button>}
  </div>
}

/** The kind a paired row carries: a deletion or addition on either side, otherwise context. */
function splitRowKind(row: SplitRow): DiffRow['kind'] {
  return row.left?.kind === 'del' ? 'del' : row.right?.kind === 'add' ? 'add' : 'context'
}

function hunkHeader(hunk: WorkspaceDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

/**
 * The side-by-side view without wrapping: two columns that clip their long
 * lines and scroll sideways together, so a long line on one side never runs
 * under the other and both sides show the same columns of text. Every line is
 * one fixed-height row, which keeps the sides aligned.
 */
function SplitColumns({ hunks }: { hunks: readonly WorkspaceDiffHunk[] }): ReactNode {
  const paired = useMemo(() => hunks.map(hunk => ({ header: hunkHeader(hunk), rows: splitRows(hunk) })), [hunks])
  const columns = useRef<Record<'left' | 'right', HTMLDivElement | null>>({ left: null, right: null })
  // Mirror one side's horizontal offset onto the other; the mirrored side's own scroll event then finds nothing to change.
  const follow = (side: 'left' | 'right') => (event: UIEvent<HTMLDivElement>): (void) => {
    const other = columns.current[side === 'left' ? 'right' : 'left']
    if (other !== null && other.scrollLeft !== event.currentTarget.scrollLeft) other.scrollLeft = event.currentTarget.scrollLeft
  }
  return (
    <div className={css.columns}>
      {(['left', 'right'] as const).map(side => (
        <div key={side} className={css.column} data-diff-side={side}
          ref={(element) => { columns.current[side] = element }} onScroll={follow(side)}>
          {paired.map((hunk, position) => (
            <section key={position} className={css.hunk}>
              <div className={css.hunkHeader}>{hunk.header}</div>
              {hunk.rows.map((row, at) => {
                const cell = row[side]
                return (
                  <div key={at} className={`${css.sideLine} ${cell === undefined ? css.empty : css[cell.kind]}`} data-diff-line={splitRowKind(row)}>
                    <span className={css.number}>{cell?.no ?? ''}</span>
                    <span className={css.text}>{cell?.text ?? ''}</span>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The hunks of a text comparison with their line numbers, unified or side by side. */
function TextDiff({ diff, split, wrap, t }: { diff: Extract<ChangesDiff, { kind: 'text' }>; split: boolean; wrap: boolean } & PropsLocale<typeof NS>): ReactNode {
  const note = noteOf(diff)
  const { hunks, truncated } = useMemo(() => renderedHunks(diff.hunks), [diff.hunks])
  return (
    <div className={css.body} data-review-view={split ? 'split' : 'unified'} data-review-wrap={wrap || undefined}>
      {note !== undefined && <p className={css.note}>{t(note)}</p>}
      {diff.coarse && <p className={css.note} data-diff-coarse>{t('diff.coarse')}</p>}
      {truncated && <p className={css.note} data-diff-truncated>{t('diff.truncated', { count: String(MAX_RENDERED_LINES) })}</p>}
      {split && !wrap ? <SplitColumns hunks={hunks} /> : hunks.map((hunk, position) => (
        <section key={position} className={css.hunk}>
          <div className={css.hunkHeader}>{hunkHeader(hunk)}</div>
          {split ? splitRows(hunk).map((row, at) => (
            <div key={at} className={css.splitLine} data-diff-line={splitRowKind(row)}>
              <span className={`${css.cell} ${row.left === undefined ? css.empty : css[row.left.kind]}`}>
                <span className={css.number}>{row.left?.no ?? ''}</span>
                <span className={css.text}>{row.left?.text ?? ''}</span>
              </span>
              <span className={`${css.cell} ${row.right === undefined ? css.empty : css[row.right.kind]}`}>
                <span className={css.number}>{row.right?.no ?? ''}</span>
                <span className={css.text}>{row.right?.text ?? ''}</span>
              </span>
            </div>
          )) : hunkRows(hunk).map((row, at) => (
            <div key={at} className={`${css.line} ${css[row.kind]}`} data-diff-line={row.kind}>
              <span className={css.number}>{row.old ?? ''}</span>
              <span className={css.number}>{row.new ?? ''}</span>
              <span className={css.sign}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
              <span className={css.text}>{row.text}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
