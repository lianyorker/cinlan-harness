// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceIsolationComparisonView, WorkspaceIsolationLeaseId, WorkspaceIsolationLeaseView } from '@deepseek-ai/dsh-api-workspace-isolation-controller/types'
import { buildSideBySideRows, parseDiff, ReviewBody, type DiffLineComment } from '../src/client/ReviewBody.tsx'
import { resetDiffPreferences } from '../src/client/diff-preferences-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  resetDiffPreferences()
})

const samplePatch = `diff --git a/src/example.ts b/src/example.ts
index 1234567..89abcdef 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 import { foo } from './foo'
-const oldVar = 1
+const newVar = 2
+const addedVar = 3
 export { foo }
`

function makeLease(leaseId: string, branch: string): WorkspaceIsolationLeaseView {
  return {
    leaseId: leaseId as WorkspaceIsolationLeaseId,
    sessionId: 'session-1' as any,
    sourcePath: '/workspaces/repo',
    checkoutPath: `/tmp/checkout-${leaseId}`,
    branch,
    phase: 'active',
    reviewState: 'clean',
    baseBranch: 'main',
    baseHead: '0123456789abcdef0123456789abcdef01234567',
    head: 'fedcba9876543210fedcba9876543210fedcba98',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
  }
}

function makeComparison(lease: WorkspaceIsolationLeaseView, patch: string): WorkspaceIsolationComparisonView {
  return {
    lease,
    targetHead: lease.baseHead,
    branchHead: lease.head,
    ahead: 1,
    behind: 0,
    commits: [{ id: lease.head, summary: 'feat: example update' }],
    changedFiles: [{ kind: 'modified', path: 'src/example.ts' }],
    patch,
    patchTruncated: false,
    includesWorkingTree: true,
    hasUntrackedFiles: false,
  }
}

describe('ReviewBody diff parser', () => {
  it('parses empty or blank patch text into an empty array', () => {
    expect(parseDiff('')).toEqual([])
    expect(parseDiff('   \n  ')).toEqual([])
  })

  it('parses git diff patch into structured files, hunks, and lines with line numbers', () => {
    const files = parseDiff(samplePatch)
    expect(files).toHaveLength(1)
    expect(files[0]!.path).toBe('src/example.ts')
    expect(files[0]!.hunks).toHaveLength(1)

    const hunk = files[0]!.hunks[0]!
    expect(hunk.header).toContain('@@ -1,4 +1,5 @@')
    expect(hunk.lines).toHaveLength(5)

    // Context line: line 1
    expect(hunk.lines[0]).toEqual({
      oldLineNumber: 1,
      newLineNumber: 1,
      type: 'context',
      text: "import { foo } from './foo'",
    })

    // Deletion line: old line 2
    expect(hunk.lines[1]).toEqual({
      oldLineNumber: 2,
      type: 'deletion',
      text: 'const oldVar = 1',
    })

    // Addition line: new line 2
    expect(hunk.lines[2]).toEqual({
      newLineNumber: 2,
      type: 'addition',
      text: 'const newVar = 2',
    })

    // Addition line: new line 3
    expect(hunk.lines[3]).toEqual({
      newLineNumber: 3,
      type: 'addition',
      text: 'const addedVar = 3',
    })

    // Context line: old 3, new 4
    expect(hunk.lines[4]).toEqual({
      oldLineNumber: 3,
      newLineNumber: 4,
      type: 'context',
      text: 'export { foo }',
    })
  })
})

describe('ReviewBody component with diff-line-comments', () => {
  const t = (key: keyof typeof en, params?: Record<string, unknown>) => {
    let val = en[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        val = val.replaceAll(`{${k}}`, String(v))
      }
    }
    return val
  }

  it('renders empty state when no leases exist', async () => {
    const list = vi.fn(async () => ({ items: [] }))
    const compare = vi.fn()

    render(<ReviewBody t={t as any} list={list} compare={compare} />)
    expect(await screen.findByText(en['review.empty'])).toBeTruthy()
    expect(list).toHaveBeenCalledOnce()
  })

  it('renders leases and inspects selected lease comparison', async () => {
    const lease = makeLease('lease-1', 'feature/test-branch')
    const list = vi.fn(async () => ({ items: [lease] }))
    const compare = vi.fn(async () => ({ comparison: makeComparison(lease, samplePatch) }))

    render(<ReviewBody t={t as any} list={list} compare={compare} />)

    const select = await screen.findByRole('combobox', { name: en['review.title'] })
    expect(select).toBeTruthy()

    fireEvent.change(select, { target: { value: 'lease-1' } })
    expect(compare).toHaveBeenCalledWith('lease-1')

    expect(await screen.findByText(/feature\/test-branch/)).toBeTruthy()
    expect(screen.getAllByText('src/example.ts').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("import { foo } from './foo'")).toBeTruthy()
    expect(screen.getByText('const newVar = 2')).toBeTruthy()
  })

  it('supports creating, canceling, deleting, and sending line comments to agent', async () => {
    const lease = makeLease('lease-1', 'feature/test-branch')
    const list = vi.fn(async () => ({ items: [lease] }))
    const compare = vi.fn(async () => ({ comparison: makeComparison(lease, samplePatch) }))
    const sendCommentToAgent = vi.fn<[DiffLineComment], Promise<void>>(async () => {})

    render(
      <ReviewBody
        t={t as any}
        list={list}
        compare={compare}
        sendCommentToAgent={sendCommentToAgent}
      />
    )

    const select = await screen.findByRole('combobox', { name: en['review.title'] })
    fireEvent.change(select, { target: { value: 'lease-1' } })

    // Find add comment button for line 2
    const addButtons = await screen.findAllByTitle(en['review.addLineComment'])
    expect(addButtons.length).toBeGreaterThan(0)

    // Click "+" to open draft
    fireEvent.click(addButtons[2]!) // on addition line 2

    const textarea = screen.getByPlaceholderText(en['review.commentPlaceholder'])
    expect(textarea).toBeTruthy()

    // Cancel draft first
    const cancelButton = screen.getByText(en['review.cancelComment'])
    fireEvent.click(cancelButton)
    expect(screen.queryByPlaceholderText(en['review.commentPlaceholder'])).toBeNull()

    // Reopen draft and save comment
    fireEvent.click(addButtons[2]!)
    const activeTextarea = screen.getByPlaceholderText(en['review.commentPlaceholder'])
    fireEvent.change(activeTextarea, { target: { value: 'Please rename newVar to meaningfulName' } })

    const saveButton = screen.getByText(en['review.saveComment'])
    fireEvent.click(saveButton)

    // Comment appears
    expect(await screen.findByText('Please rename newVar to meaningfulName')).toBeTruthy()
    expect(screen.getByText(/L2 \(modified\)/)).toBeTruthy()

    // Overview heading appears
    expect(screen.getByText(/Line Comments \(1\)/)).toBeTruthy()

    // Send to agent
    const sendBtn = screen.getByText(en['review.sendToAgent'])
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(sendCommentToAgent).toHaveBeenCalledOnce()
    })

    expect(sendCommentToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'src/example.ts',
        line: 2,
        side: 'modified',
        text: 'Please rename newVar to meaningfulName',
        status: 'sent',
      })
    )

    expect(screen.getByText(en['review.sentStatus'])).toBeTruthy()

    // Delete comment
    const deleteBtn = screen.getByText(en['review.deleteComment'])
    fireEvent.click(deleteBtn)

    expect(screen.queryByText('Please rename newVar to meaningfulName')).toBeNull()
    expect(screen.queryByText(/Line Comments/)).toBeNull()
  })

  it('supports sending all comments to agent in bulk', async () => {
    const lease = makeLease('lease-1', 'feature/test-branch')
    const list = vi.fn(async () => ({ items: [lease] }))
    const compare = vi.fn(async () => ({ comparison: makeComparison(lease, samplePatch) }))
    const sendCommentToAgent = vi.fn(async () => {})

    render(
      <ReviewBody
        t={t as any}
        list={list}
        compare={compare}
        sendCommentToAgent={sendCommentToAgent}
      />
    )

    const select = await screen.findByRole('combobox', { name: en['review.title'] })
    fireEvent.change(select, { target: { value: 'lease-1' } })

    const addButtons = await screen.findAllByTitle(en['review.addLineComment'])

    // Add first comment
    fireEvent.click(addButtons[1]!)
    fireEvent.change(screen.getByPlaceholderText(en['review.commentPlaceholder']), {
      target: { value: 'Comment 1' },
    })
    fireEvent.click(screen.getByText(en['review.saveComment']))

    // Add second comment
    fireEvent.click(addButtons[3]!)
    fireEvent.change(screen.getByPlaceholderText(en['review.commentPlaceholder']), {
      target: { value: 'Comment 2' },
    })
    fireEvent.click(screen.getByText(en['review.saveComment']))

    expect(screen.getByText(/Line Comments \(2\)/)).toBeTruthy()

    // Click "Send All to Agent"
    const sendAllBtn = screen.getByText(en['review.sendAllToAgent'])
    fireEvent.click(sendAllBtn)

    await waitFor(() => {
      expect(sendCommentToAgent).toHaveBeenCalledTimes(2)
    })
  })

  it('aligns deletions and additions properly in buildSideBySideRows', () => {
    const files = parseDiff(samplePatch)
    const hunk = files[0]!.hunks[0]!
    const rows = buildSideBySideRows(hunk.lines)

    // Context line 1
    expect(rows[0]!.left?.text).toBe("import { foo } from './foo'")
    expect(rows[0]!.right?.text).toBe("import { foo } from './foo'")

    // Deletion 1 paired with Addition 1
    expect(rows[1]!.left?.text).toBe('const oldVar = 1')
    expect(rows[1]!.right?.text).toBe('const newVar = 2')

    // Addition 2 with empty left
    expect(rows[2]!.left).toBeUndefined()
    expect(rows[2]!.right?.text).toBe('const addedVar = 3')

    // Context line 4
    expect(rows[3]!.left?.text).toBe('export { foo }')
    expect(rows[3]!.right?.text).toBe('export { foo }')
  })

  it('supports side-by-side view mode, toolbar options, and commenting on original vs modified side', async () => {
    const lease = makeLease('lease-1', 'feature/test-branch')
    const list = vi.fn(async () => ({ items: [lease] }))
    const compare = vi.fn(async () => ({ comparison: makeComparison(lease, samplePatch) }))
    const sendCommentToAgent = vi.fn(async () => {})

    render(
      <ReviewBody
        t={t as any}
        list={list}
        compare={compare}
        sendCommentToAgent={sendCommentToAgent}
      />
    )

    const select = await screen.findByRole('combobox', { name: en['review.title'] })
    fireEvent.change(select, { target: { value: 'lease-1' } })

    expect(await screen.findByText(/feature\/test-branch/)).toBeTruthy()

    // Check toolbar buttons are present
    const sideBySideBtn = screen.getByRole('button', { name: en['review.viewSideBySide'] })
    const inlineBtn = screen.getByRole('button', { name: en['review.viewInline'] })
    const wordWrapBtn = screen.getByRole('button', { name: en['review.wordWrap'] })
    const whitespaceBtn = screen.getByRole('button', { name: en['review.showWhitespace'] })

    // Switch to side-by-side mode first
    fireEvent.click(sideBySideBtn)

    // In side-by-side mode, both oldVar (deletion) and newVar (addition) are visible
    expect(screen.getByText(/const oldVar = 1/)).toBeTruthy()
    expect(screen.getByText(/const newVar = 2/)).toBeTruthy()

    // Toggle whitespace on and verify dot spans appear
    fireEvent.click(whitespaceBtn)
    expect(document.querySelector('._whitespaceSpace_f21b3f, span[class*="whitespaceSpace"]')).toBeTruthy()

    // Toggle word wrap
    fireEvent.click(wordWrapBtn)

    // Add comment on left side (original deletion)
    const leftAddComments = screen.getAllByLabelText(`${en['review.addLineComment']} src/example.ts:2`)
    expect(leftAddComments.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(leftAddComments[0]!)

    const textarea = screen.getByPlaceholderText(en['review.commentPlaceholder'])
    fireEvent.change(textarea, { target: { value: 'Why was oldVar removed?' } })
    fireEvent.click(screen.getByText(en['review.saveComment']))

    expect(await screen.findByText('Why was oldVar removed?')).toBeTruthy()
    expect(screen.getByText(/L2 \(original\)/)).toBeTruthy()

    // Send comment to agent
    fireEvent.click(screen.getByText(en['review.sendToAgent']))
    await waitFor(() => {
      expect(sendCommentToAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: 'src/example.ts',
          line: 2,
          side: 'original',
          text: 'Why was oldVar removed?',
        })
      )
    })
  })
})

