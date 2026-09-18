// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DiffTab } from '../src/client/DiffTab.tsx'
import { api } from '../src/client/api.ts'
import { t } from '../src/client/locales.ts'
import { gitCallbacks, logEntry, patch, scope } from './git-fixture.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('DiffTab injected Git callbacks', () => {
  it.each([true, false])('keeps requested worktree/index side staged=%s', async (staged) => {
    const git = gitCallbacks()
    const fsRead = vi.spyOn(api, 'fsRead')
    render(<DiffTab {...scope} cwd={scope.cwd} git={git} diff={{ kind: 'worktree', path: 'source.ts', staged }} />)
    await screen.findByText('new source')
    expect(git.gitDiff).toHaveBeenCalledExactlyOnceWith(scope, 'source.ts', staged, expect.any(AbortSignal))
    expect(fsRead).not.toHaveBeenCalled()
    expect(git.gitCompare).not.toHaveBeenCalled()
  })

  it('preserves the existing other-side fallback when the selected side is empty', async () => {
    const git = gitCallbacks()
    git.gitDiff.mockResolvedValueOnce({ diff: '' }).mockResolvedValueOnce({ diff: patch })
    render(<DiffTab {...scope} cwd={scope.cwd} git={git} diff={{ kind: 'worktree', path: 'source.ts', staged: true }} />)
    await screen.findByText('new source')
    expect(git.gitDiff.mock.calls.map(call => call[2])).toEqual([true, false])
  })

  it('keeps untracked file content on the existing filesystem preview path', async () => {
    const git = gitCallbacks()
    git.gitDiff.mockResolvedValue({ diff: '' })
    const fsRead = vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'text', content: 'untracked source\n', truncated: false })
    render(<DiffTab {...scope} cwd={scope.cwd} git={git} diff={{ kind: 'worktree', path: 'new.ts', staged: false, untracked: true }} />)
    await screen.findByText('untracked source')
    expect(fsRead).toHaveBeenCalledWith(scope, 'new.ts', expect.any(AbortSignal))
    expect(git.gitDiff.mock.calls.map(call => call[2])).toEqual([false, true])
  })

  it('shows no text changes for tracked files and binary untracked files', async () => {
    const git = gitCallbacks()
    git.gitDiff.mockResolvedValue({ diff: '' })
    const fsRead = vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'binary', size: 100, truncated: false, head: '' })
    const view = render(<DiffTab {...scope} cwd={scope.cwd} git={git} diff={{ kind: 'worktree', path: 'tracked.ts', staged: false }} />)
    await screen.findByText(t('diffEmpty'))
    expect(fsRead).not.toHaveBeenCalled()
    view.rerender(<DiffTab {...scope} cwd={scope.cwd} git={git} diff={{ kind: 'worktree', path: 'binary.png', staged: false, untracked: true }} />)
    await waitFor(() => { expect(fsRead).toHaveBeenCalledOnce() })
    await screen.findByText(t('diffEmpty'))
  })

  it('loads a commit by its full hash and refreshes that same revision', async () => {
    const git = gitCallbacks()
    const diff = { kind: 'commit' as const, hash: logEntry.hash, hashFull: logEntry.hashFull, subject: logEntry.subject }
    render(<DiffTab {...scope} cwd={scope.cwd} git={git} diff={diff} />)
    await screen.findByText('new source')
    expect(git.gitCommitDiff).toHaveBeenCalledWith(scope, logEntry.hashFull, expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: t('refresh') }))
    await waitFor(() => { expect(git.gitCommitDiff).toHaveBeenCalledTimes(2) })
    expect(git.gitDiff).not.toHaveBeenCalled()
    expect(git.gitCompare).not.toHaveBeenCalled()
  })

  it('shows Remote errors and suppresses stale responses after changing session', async () => {
    const delayed = Promise.withResolvers<{ diff: string }>()
    const git = gitCallbacks()
    git.gitDiff.mockReturnValueOnce(delayed.promise).mockRejectedValueOnce(new Error('Session is unavailable'))
    const diff = { kind: 'worktree' as const, path: 'source.ts', staged: false }
    const view = render(<DiffTab {...scope} cwd={scope.cwd} git={git} diff={diff} />)
    const firstSignal = git.gitDiff.mock.calls[0]?.[3]
    view.rerender(<DiffTab sessionId="other-session" cwd="/other" git={git} diff={diff} />)
    await screen.findByText(/Session is unavailable/)
    await act(async () => { delayed.resolve({ diff: patch }); await delayed.promise })
    expect(firstSignal?.aborted).toBe(true)
    expect(screen.queryByText('new source')).toBeNull()
    expect(screen.getByText(/Session is unavailable/)).toBeTruthy()
    expect(git.gitDiff).toHaveBeenCalledTimes(2)
  })
})
