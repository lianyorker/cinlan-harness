// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { GitCommitPreview, GitCompareResult, GitStatusResult } from '@deepseek-ai/dsh-sidebar-git/types'
import { GitView } from '../src/client/GitView.tsx'
import { builtinTabs } from '../src/client/builtins/tabs.tsx'
import { createSidebarStore, type SidebarTab } from '../src/client/state.ts'
import { Context } from '@deepseek-ai/cordis'
import type { Context as SidebarContext } from '../src/context-types.ts'
import { t } from '../src/client/locales.ts'
import { gitCallbacks, logEntry, patch, preview, repository, scope, status } from './git-fixture.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function panel(git = gitCallbacks()) {
  const onOpenDiff = vi.fn()
  const onOpenFile = vi.fn()
  const props = { scope, git, onOpenDiff, onOpenFile }
  const view = render(<GitView {...props} />)
  await screen.findByRole('region', { name: t('staged') })
  return { ...view, props, git, onOpenDiff, onOpenFile }
}

function message(value: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: t('commitPlaceholder') }), { target: { value } })
}

async function openReview(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: t('commit') }))
  const dialog = screen.getByRole('dialog', { name: t('gitCommitReview') })
  await within(dialog).findByLabelText(t('gitCommitMessage'))
  return dialog
}

function cancel(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByText(t('cancel'), { selector: 'button' }))
}

describe('builtin Git callback threading', () => {
  it('opens a changed file through the registered Git and Diff descriptors', async () => {
    const git = gitCallbacks()
    const ctx = new Context() as SidebarContext
    const store = createSidebarStore()
    const tabs = builtinTabs(ctx, { git })
    const gitTab = tabs.find(tab => tab.id === 'git')!
    const diffTab = tabs.find(tab => tab.id === 'diff')!
    const onOpenDiff = vi.fn<(tab: SidebarTab) => void>()
    const view = render(gitTab.component({ ctx, store, scope, tab: { id: 'git', type: 'git', title: 'Git' }, visible: true, onOpenDiff }))
    await screen.findByRole('region', { name: t('unstaged') })
    fireEvent.click(within(screen.getByRole('region', { name: t('unstaged') })).getByRole('button', { name: /tracked.ts/ }))
    const opened = onOpenDiff.mock.calls[0]![0]
    expect(opened).toEqual({ id: 'diff:w:u:tracked.ts', type: 'diff', title: 'tracked.ts', diff: { kind: 'worktree', path: 'tracked.ts', staged: false, untracked: false } })
    view.rerender(diffTab.component({ ctx, store, scope, tab: opened, visible: true }))
    await screen.findByText('new source')
    expect(git.gitDiff).toHaveBeenCalledWith(scope, 'tracked.ts', false, expect.any(AbortSignal))
  })
})

describe('Git change groups', () => {
  it.each([
    ['changes-first', ['unstaged', 'staged', 'untracked']],
    ['staged-first', ['staged', 'unstaged', 'untracked']],
    ['untracked-first', ['untracked', 'unstaged', 'staged']],
  ] as const)('orders %s and stages only the displayed group paths', async (groupOrder, order) => {
    const f = await panel(gitCallbacks({ ...status, groupOrder }))
    expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-label'))).toEqual(order.map(key => t(key)))
    const tracked = screen.getByRole('region', { name: t('unstaged') })
    const staged = screen.getByRole('region', { name: t('staged') })
    const untracked = screen.getByRole('region', { name: t('untracked') })
    expect(tracked.textContent).toContain('both.ts')
    expect(staged.textContent).toContain('both.ts')
    expect(tracked.textContent).not.toContain('new.ts')
    expect(untracked.textContent).toContain('new.ts')
    fireEvent.click(within(tracked).getByRole('button', { name: t('stageAll') }))
    await waitFor(() => { expect(f.git.gitStage).toHaveBeenCalledTimes(2) })
    expect(f.git.gitStage.mock.calls).toEqual([[scope, repository.root, 'both.ts'], [scope, repository.root, 'tracked.ts']])
    await waitFor(() => { expect(within(untracked).getByRole<HTMLButtonElement>('button', { name: t('stageAll') }).disabled).toBe(false) })
    fireEvent.click(within(untracked).getByRole('button', { name: t('stageAll') }))
    await waitFor(() => { expect(f.git.gitStage).toHaveBeenCalledTimes(3) })
    expect(f.git.gitStage).toHaveBeenLastCalledWith(scope, repository.root, 'new.ts')
    await waitFor(() => { expect(within(staged).getByRole<HTMLButtonElement>('button', { name: t('unstageAll') }).disabled).toBe(false) })
    fireEvent.click(within(staged).getByRole('button', { name: t('unstageAll') }))
    await waitFor(() => { expect(f.git.gitUnstage).toHaveBeenCalledTimes(3) })
    expect(f.git.gitUnstage.mock.calls.map(call => call[2])).toEqual(['both.ts', 'staged.ts', 'renamed.ts'])
  })

  it('preserves rename display, per-row staging, and worktree/index/commit tab references', async () => {
    const f = await panel()
    const staged = screen.getByRole('region', { name: t('staged') })
    fireEvent.click(within(staged).getByRole('button', { name: /before.ts → renamed.ts/ }))
    expect(f.onOpenDiff).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'diff:w:s:renamed.ts', diff: { kind: 'worktree', path: 'renamed.ts', staged: true, untracked: false },
    }))
    fireEvent.click(within(screen.getByRole('region', { name: t('unstaged') })).getByRole('button', { name: /both.ts/ }))
    expect(f.onOpenDiff).toHaveBeenLastCalledWith(expect.objectContaining({ diff: { kind: 'worktree', path: 'both.ts', staged: false, untracked: false } }))
    const untracked = screen.getByRole('region', { name: t('untracked') })
    fireEvent.click(within(untracked).getByRole('button', { name: /new.ts/ }))
    expect(f.onOpenDiff).toHaveBeenLastCalledWith(expect.objectContaining({ diff: { kind: 'worktree', path: 'new.ts', staged: false, untracked: true } }))
    fireEvent.click(within(untracked).getByRole('button', { name: t('stage') }))
    await waitFor(() => { expect(f.git.gitStage).toHaveBeenCalledWith(scope, repository.root, 'new.ts') })
    fireEvent.click(screen.getByRole('button', { name: /History subject/ }))
    expect(f.onOpenDiff).toHaveBeenLastCalledWith(expect.objectContaining({ diff: { kind: 'commit', hash: logEntry.hash, hashFull: logEntry.hashFull, subject: logEntry.subject } }))
  })

  it('surfaces stage errors without losing the draft', async () => {
    const git = gitCallbacks()
    git.gitStage.mockRejectedValue(new Error('index locked'))
    await panel(git)
    message('Keep my draft')
    fireEvent.click(within(screen.getByRole('region', { name: t('untracked') })).getByRole('button', { name: t('stageAll') }))
    await screen.findByText('index locked')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Keep my draft')
  })

  it('shows a non-repository result without requesting branches or history', async () => {
    const git = gitCallbacks({ isRepo: false, entries: [], groupOrder: 'changes-first' })
    render(<GitView scope={scope} git={git} onOpenFile={vi.fn()} onOpenDiff={vi.fn()} />)
    await screen.findByText(t('notRepo'))
    expect(git.gitBranch).not.toHaveBeenCalled()
    expect(git.gitLog).not.toHaveBeenCalled()
  })
})

describe('Git commit review', () => {
  it('shows the exact attributed multiline Host message and confirms the entire preview once', async () => {
    const f = await panel()
    const draft = 'Subject\n\nBody with a second line'
    message(draft)
    const dialog = await openReview()
    expect(f.git.gitPrepareCommit).toHaveBeenCalledWith(scope, repository.root, draft, expect.any(AbortSignal))
    expect(within(dialog).getByLabelText(t('gitCommitMessage')).textContent).toBe(preview.message)
    expect(dialog.textContent).toContain(t('gitRepository', { root: repository.root }))
    expect(dialog.textContent).toContain(t('gitBranch', { branch: repository.branch! }))
    expect(dialog.textContent).toContain(repository.head)
    expect(f.git.gitCommit).not.toHaveBeenCalled()
    const confirm = within(dialog).getByRole('button', { name: t('gitCommitConfirm') })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => { expect(f.git.gitCommit).toHaveBeenCalledOnce() })
    expect(f.git.gitCommit.mock.calls[0]?.[0]).toBe(preview)
    await waitFor(() => { expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('') })
    expect(f.git.gitStage).not.toHaveBeenCalled()
  })

  it.each(['ctrlKey', 'metaKey'] as const)('%s Enter opens review and cancellation preserves the draft', async (modifier) => {
    const f = await panel()
    message('Keyboard draft')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', [modifier]: true })
    const dialog = await screen.findByRole('dialog', { name: t('gitCommitReview') })
    await within(dialog).findByLabelText(t('gitCommitMessage'))
    expect(f.git.gitCommit).not.toHaveBeenCalled()
    cancel(dialog)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Keyboard draft')
    expect(f.git.gitPrepareCommit.mock.calls[0]?.[3]?.aborted).toBe(true)
  })

  it('invalidates a displayed preview when the draft changes and requires another review', async () => {
    const f = await panel()
    message('First draft')
    await openReview()
    message('Edited draft')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(f.git.gitCommit).not.toHaveBeenCalled()
    const revised = { ...preview, message: 'Host message for edited draft\n' }
    f.git.gitPrepareCommit.mockResolvedValue(revised)
    const dialog = await openReview()
    expect(within(dialog).getByLabelText(t('gitCommitMessage')).textContent).toBe(revised.message)
    fireEvent.click(within(dialog).getByRole('button', { name: t('gitCommitConfirm') }))
    await waitFor(() => { expect(f.git.gitCommit).toHaveBeenCalledWith(revised) })
  })

  it('ignores a stale prepare response after editing, even when a newer preview already arrived', async () => {
    const delayed = Promise.withResolvers<GitCommitPreview>()
    const git = gitCallbacks()
    git.gitPrepareCommit.mockReturnValueOnce(delayed.promise)
    await panel(git)
    message('First draft')
    fireEvent.click(screen.getByRole('button', { name: t('commit') }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('gitCommitConfirm') }).disabled).toBe(true)
    message('Second draft')
    const revised = { ...preview, message: 'Reviewed second draft\n' }
    git.gitPrepareCommit.mockResolvedValue(revised)
    const dialog = await openReview()
    await act(async () => { delayed.resolve(preview); await delayed.promise })
    expect(within(dialog).getByLabelText(t('gitCommitMessage')).textContent).toBe(revised.message)
    expect(git.gitPrepareCommit.mock.calls[0]?.[3]?.aborted).toBe(true)
    expect(git.gitCommit).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'session', 'cwd', 'unmount'] as const)('invalidates a pending prepare on %s', async (action) => {
    const delayed = Promise.withResolvers<GitCommitPreview>()
    const git = gitCallbacks()
    git.gitPrepareCommit.mockReturnValue(delayed.promise)
    const f = await panel(git)
    message('Pending draft')
    fireEvent.click(screen.getByRole('button', { name: t('commit') }))
    const signal = git.gitPrepareCommit.mock.calls[0]?.[3]
    if (action === 'cancel') cancel(screen.getByRole('dialog'))
    if (action === 'session') f.rerender(<GitView {...f.props} scope={{ ...scope, sessionId: 'other-session' }} />)
    if (action === 'cwd') f.rerender(<GitView {...f.props} scope={{ ...scope, cwd: '/other' }} />)
    if (action === 'unmount') f.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { delayed.resolve(preview); await delayed.promise })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(git.gitCommit).not.toHaveBeenCalled()
  })

  it('discards an already displayed review when switching sessions', async () => {
    const f = await panel()
    message('Session draft')
    await openReview()
    f.rerender(<GitView {...f.props} scope={{ ...scope, sessionId: 'other-session' }} />)
    await screen.findByRole('textbox')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(f.git.gitCommit).not.toHaveBeenCalled()
  })

  it.each(['prepare', 'commit'] as const)('preserves the draft and displays a normal %s failure', async (phase) => {
    const git = gitCallbacks()
    if (phase === 'prepare') git.gitPrepareCommit.mockRejectedValue(new Error('Host refused the preview'))
    else git.gitCommit.mockRejectedValue(new Error('Repository changed since review'))
    await panel(git)
    message('Unsaved draft\n\nKeep this body')
    if (phase === 'prepare') fireEvent.click(screen.getByRole('button', { name: t('commit') }))
    else {
      const dialog = await openReview()
      fireEvent.click(within(dialog).getByRole('button', { name: t('gitCommitConfirm') }))
    }
    await screen.findByText(phase === 'prepare' ? 'Host refused the preview' : 'Repository changed since review')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Unsaved draft\n\nKeep this body')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('read-only branch comparison', () => {
  it.each([false, true])('renders pinned refs and patch with fallback=%s without opening a persisted tab', async (usedFallback) => {
    const git = gitCallbacks()
    const result: GitCompareResult = { status: 'ready', repositoryRoot: repository.root, baseRef: 'origin/main', baseHead: 'd'.repeat(40), head: repository.head!, usedFallback, diff: patch }
    git.gitCompare.mockResolvedValue(result)
    const f = await panel(git)
    expect(git.gitCompare).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t('gitCompare') }))
    const dialog = screen.getByRole('dialog', { name: t('gitCompare') })
    await within(dialog).findByText('new source')
    expect(dialog.textContent).toContain(result.repositoryRoot)
    expect(dialog.textContent).toContain(result.baseRef)
    expect(dialog.textContent).toContain(result.baseHead)
    expect(dialog.textContent).toContain(result.head)
    expect(within(dialog).queryByRole('status')?.textContent ?? null).toBe(usedFallback ? t('gitCompareFallback', { ref: result.baseRef }) : null)
    git.gitStatus.mockResolvedValue({ ...status, repository: { ...repository, head: 'e'.repeat(40) } })
    fireEvent.click(screen.getByRole('button', { name: t('refresh') }))
    await waitFor(() => { expect(git.gitStatus).toHaveBeenCalledTimes(2) })
    expect(dialog.textContent).toContain(result.head)
    expect(dialog.textContent).not.toContain('e'.repeat(40))
    expect(f.onOpenDiff).not.toHaveBeenCalled()
    expect(git.gitDiff).not.toHaveBeenCalled()
    expect(git.gitStage).not.toHaveBeenCalled()
    expect(git.gitCheckout).not.toHaveBeenCalled()
    expect(git.gitCommit).not.toHaveBeenCalled()
  })

  it.each([
    ['unborn', 'gitCompareUnborn'], ['detached', 'gitCompareDetached'],
    ['no-default-branch', 'gitCompareNoDefault'], ['no-merge-base', 'gitCompareNoMergeBase'],
  ] as const)('explains unavailable comparison: %s', async (reason, key) => {
    const git = gitCallbacks()
    git.gitCompare.mockResolvedValue({ status: 'unavailable', reason })
    await panel(git)
    fireEvent.click(screen.getByRole('button', { name: t('gitCompare') }))
    await within(screen.getByRole('dialog')).findByText(t(key))
    expect(git.gitCommit).not.toHaveBeenCalled()
  })

  it('ignores a comparison completed after the dialog is closed', async () => {
    const delayed = Promise.withResolvers<GitCompareResult>()
    const git = gitCallbacks()
    git.gitCompare.mockReturnValue(delayed.promise)
    await panel(git)
    fireEvent.click(screen.getByRole('button', { name: t('gitCompare') }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('close') }))
    await act(async () => { delayed.resolve({ status: 'unavailable', reason: 'detached' }); await delayed.promise })
    expect(git.gitCompare.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('confirmed Git history and discard actions', () => {
  it.each(['discard', 'revert', 'cherryPick'] as const)('passes displayed repository and HEAD only after %s confirmation', async (action) => {
    const f = await panel()
    const label = action === 'discard' ? t('discard') : action === 'revert' ? t('revertCommit') : t('cherryPickCommit')
    const open = (): void => {
      const row = action === 'discard'
        ? within(screen.getByRole('region', { name: t('unstaged') })).getByRole('button', { name: /tracked.ts/ })
        : screen.getByRole('button', { name: /History subject/ })
      fireEvent.contextMenu(row, { clientX: 10, clientY: 10 })
      fireEvent.click(screen.getByRole('menuitem', { name: label }))
    }
    const callback = action === 'discard' ? f.git.gitDiscard : action === 'revert' ? f.git.gitRevert : f.git.gitCherryPick
    open()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(repository.root)
    expect(dialog.textContent).toContain(repository.head)
    expect(callback).not.toHaveBeenCalled()
    cancel(dialog)
    expect(callback).not.toHaveBeenCalled()
    open()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }))
    await waitFor(() => { expect(callback).toHaveBeenCalledWith(scope, repository.root, repository.head, action === 'discard' ? 'tracked.ts' : logEntry.hashFull) })
  })

  it('keeps the new session status when an earlier status response arrives late', async () => {
    const delayed = Promise.withResolvers<GitStatusResult>()
    const git = gitCallbacks()
    git.gitStatus.mockReturnValueOnce(delayed.promise)
    const props = { scope, git, onOpenDiff: vi.fn(), onOpenFile: vi.fn() }
    const view = render(<GitView {...props} />)
    git.gitStatus.mockResolvedValue({ ...status, branch: 'new-session-branch' })
    view.rerender(<GitView {...props} scope={{ sessionId: 'new-session' }} />)
    await screen.findByRole('option', { name: 'new-session-branch' })
    await act(async () => { delayed.resolve(status); await delayed.promise })
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('new-session-branch')
  })
})
