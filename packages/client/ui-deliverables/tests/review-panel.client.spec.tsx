// @vitest-environment jsdom
/** Recorded comparisons remain scoped to the selected file and survive later navigation safely. */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ReviewPanel, hunkRows, splitRows, renderedHunks, MAX_RENDERED_LINES } from '../src/client/ReviewPanel.tsx'
import { ChangedFiles } from '../src/client/ChangedFiles.tsx'
import { changesReviewAddress, parseChangesReviewAddress, type ChangesSummary, type ChangesDiff } from '../src/changes.ts'
import { en } from '../src/client/locales.ts'
import type { ReviewReader, ReviewRead } from '../src/client/review-read.ts'

const sessionId = SessionId('review-session')
const t = makeTranslate(en)
const summary: ChangesSummary = {
  turn: 1, total: 4, added: 3, deleted: 1,
  files: ['a.ts', 'b.ts', 'c.bin', 'd.txt'].map(path => ({ path, display: path, added: 1, deleted: 0 })),
}
const text: ChangesDiff = {
  kind: 'text', path: 'a.ts', display: 'a.ts', before: true, after: true, coarse: false,
  hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' shared', '-before', '+after', '+extra'] }],
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(reader: ReviewReader) {
  const openFile = vi.fn()
  return { ...render(<ReviewPanel sessionId={sessionId} seq={8} turn={1} initialIndex={0}
    summary={reader.summary} diff={reader.diff} openFile={openFile} t={t} />), openFile }
}

describe('turn comparison review', () => {
  it('shows a retryable sidebar failure beside the current file', async () => {
    const openFile = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('cwd unavailable')).mockResolvedValueOnce()
    const view = render(<ReviewPanel sessionId={SessionId('fork')} seq={8} turn={2} initialIndex={0}
      summary={async () => summary} diff={async () => text} openFile={openFile} t={t} />)
    const button = await view.findByRole('button', { name: 'Open a.ts in sidebar' })
    fireEvent.click(button)
    await view.findByText('Could not preview. Click to retry.')
    fireEvent.click(button)
    await waitFor(() => { expect(view.queryByRole('status')).toBeNull() })
    expect(openFile).toHaveBeenCalledTimes(2)
  })

  it('opens only the selected comparison, changes view, and opens its whole file', async () => {
    const diff = vi.fn<ReviewReader['diff']>(async (_session, _seq, index) => index === 2
      ? { kind: 'binary', path: 'c.bin', display: 'c.bin' } : text)
    const view = mount({ summary: async () => summary, diff })
    await view.findByText('after')
    expect(diff).toHaveBeenCalledTimes(1)
    expect(diff.mock.calls[0]?.slice(0, 3)).toEqual([sessionId, 8, 0])
    fireEvent.click(view.getByRole('button', { name: 'Split view' }))
    expect(view.container.querySelector('[data-review-view="split"]')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Line wrap' }))
    expect(view.container.querySelector('[data-review-wrap]')).not.toBeNull()
    fireEvent.change(view.getByRole('combobox'), { target: { value: '2' } })
    await view.findByText('Binary file; changes cannot be shown')
    fireEvent.click(view.getByRole('button', { name: 'Open c.bin in sidebar' }))
    expect(view.openFile).toHaveBeenCalledWith('c.bin')
  })

  it('ignores an older file read after switching and cancels both on unmount', async () => {
    const pending: Array<{ signal: AbortSignal; resolve(value: ReviewRead<ChangesDiff>): void }> = []
    const view = mount({ summary: async () => summary,
      diff: (_session, _seq, _index, signal) => new Promise((resolve) => { pending.push({ signal, resolve }) }),
    })
    await waitFor(() => { expect(pending).toHaveLength(1) })
    fireEvent.change(view.getByRole('combobox'), { target: { value: '1' } })
    await waitFor(() => { expect(pending).toHaveLength(2) })
    expect(pending[0]?.signal.aborted).toBe(true)
    await act(async () => { pending[1]!.resolve({ kind: 'oversized', path: 'b.ts', display: 'b.ts' }) })
    await view.findByText('File too large; changes cannot be shown')
    await act(async () => { pending[0]!.resolve(text) })
    expect(view.queryByText('after')).toBeNull()
    view.unmount()
    expect(pending[1]?.signal.aborted).toBe(true)
  })

  it('offers retry for a failed read and distinguishes an expired record', async () => {
    const diff = vi.fn<ReviewReader['diff']>().mockResolvedValueOnce('error').mockResolvedValueOnce('missing')
    const view = mount({ summary: async () => summary, diff })
    fireEvent.click(await view.findByRole('button', { name: 'Retry' }))
    await view.findByText('The contents of this turn’s changes are no longer available')
    expect(view.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(diff).toHaveBeenCalledTimes(2)
  })

  it('folds a card and passes original summary indexes to its review opener', () => {
    const openReview = vi.fn()
    const view = render(<ChangedFiles changes={{ ...summary, seq: 8 }} cwd="/workspace" openReview={openReview} t={t} />)
    expect(view.queryByRole('button', { name: 'View changes to d.txt' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Show all 4 changed files' }))
    fireEvent.click(view.getByRole('button', { name: 'View changes to d.txt' }))
    expect(openReview).toHaveBeenCalledWith(3)
    fireEvent.click(view.getByRole('button', { name: 'Review this turn’s changes in the sidebar' }))
    expect(openReview).toHaveBeenLastCalledWith(0)
  })

  it('numbers unified lines, pairs split replacements, and bounds rendering', () => {
    if (text.kind !== 'text') throw new Error('text fixture expected')
    expect(hunkRows(text.hunks[0]!)).toEqual([
      { kind: 'context', old: 1, new: 1, text: 'shared' },
      { kind: 'del', old: 2, new: undefined, text: 'before' },
      { kind: 'add', old: undefined, new: 2, text: 'after' },
      { kind: 'add', old: undefined, new: 3, text: 'extra' },
    ])
    expect(splitRows(text.hunks[0]!)[1]).toEqual({ left: { no: 2, text: 'before', kind: 'del' }, right: { no: 2, text: 'after', kind: 'add' } })
    const cut = renderedHunks([{ oldStart: 1, oldLines: 0, newStart: 1, newLines: MAX_RENDERED_LINES + 1,
      lines: Array.from({ length: MAX_RENDERED_LINES + 1 }, () => '+line') }])
    expect(cut.truncated).toBe(true)
    expect(cut.hunks[0]?.lines).toHaveLength(MAX_RENDERED_LINES)
  })

  it('encodes session identity in review addresses and refuses malformed coordinates', () => {
    const coordinates = { sessionId: SessionId('session/one'), seq: 8, turn: 1 }
    expect(parseChangesReviewAddress(changesReviewAddress(coordinates))).toEqual(coordinates)
    for (const address of ['dsh-resource://changes-review/session/x/8/0', 'dsh-resource://changes-review/session/%E0/8/1']) {
      expect(parseChangesReviewAddress(address)).toBeUndefined()
    }
  })
})
