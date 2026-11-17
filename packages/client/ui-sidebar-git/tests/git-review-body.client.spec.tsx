// @vitest-environment jsdom
/** Git review body behavior: loading, generation, error mapping, and late-response guard. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GitReviewBody, type GitReviewBodyInjected, type GitReviewBodyProps } from '../src/client/GitReviewBody.tsx'
import type { GitAiGenerateResult } from '@cinlan/api-git-ai-controller/types'
import type { GitStatusResult } from '@cinlan/api-sidebar-git-controller/types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const STATUS: GitStatusResult = {
  isRepo: true, branch: 'main', entries: [], groupOrder: 'changes-first',
  repository: { root: 'D:\\repo', gitDirectory: 'D:\\repo\\.git', sessionCwd: 'D:\\repo', head: 'abc123', branch: 'main', indexFingerprint: 'f' },
}

const draft = (text: string, head = 'abc123'): GitAiGenerateResult => ({
  action: 'diff-review', selection: 'staged', text, childSessionId: 'child-1' as never,
  repository: { repositoryRoot: 'D:\\repo', branch: 'main', head },
  omittedFiles: [], truncated: false,
})

const base = (): GitReviewBodyInjected => ({
  status: async () => STATUS,
  diff: async () => ({ diff: 'diff --git a/f.txt b/f.txt\n+changed' }),
  compare: async () => ({ status: 'ready', repositoryRoot: 'D:\\repo', baseRef: 'main', baseHead: 'base1', head: 'abc123', usedFallback: false, diff: 'd' }),
  generate: async () => draft('the generated draft'),
})

type BodyProps = GitReviewBodyProps & GitReviewBodyInjected

// 组件只消费这几个 share；框架提供的其余 share 在测试里为空，整体一次断言。
const props = (injected: GitReviewBodyInjected, sessionId = 'session-1'): BodyProps => ({
  useTabInfo: () => ({ tab: { id: 'tab1', actions: { bindCommands: () => () => {} } }, panel: { id: 'p1', isFloating: false } }),
  sessionId,
  useSessions: (selector: (sessions: { byId: Record<string, { cwd?: string }> }) => unknown) =>
    selector({ byId: { [sessionId]: { cwd: 'D:\\repo' } } }),
  t: (key: never) => String(key),
  ...injected,
} as unknown as BodyProps)

describe('GitReviewBody', () => {
  it('renders repository state and the selected diff', async () => {
    render(<GitReviewBody {...props(base())} />)
    await waitFor(() => { expect(screen.getByText('branchLabel')).toBeTruthy() })
    expect(screen.getByLabelText('patchTitle').textContent?.includes('diff --git a/f.txt b/f.txt')).toBeTruthy()
  })

  it('renders a generated draft with its child session id', async () => {
    render(<GitReviewBody {...props(base())} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'reviewAction' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'reviewAction' }))
    await waitFor(() => { expect((screen.getByLabelText('draftTitle') as HTMLTextAreaElement).value === 'the generated draft').toBe(true) })
    expect(screen.getByText(/child-1/)).toBeTruthy()
  })

  it('maps a git-ai error code to localized copy', async () => {
    const injected: GitReviewBodyInjected = {
      ...base(),
      generate: async () => { throw Object.assign(new Error('no key'), { code: 'git-ai/no-model' }) },
    }
    render(<GitReviewBody {...props(injected)} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'reviewAction' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'reviewAction' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent?.includes('error.no-model')).toBe(true) })
  })

  it('aborts generation from the cancel button', async () => {
    let aborted = false
    const injected: GitReviewBodyInjected = {
      ...base(),
      generate: (_action, _selection, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
      }),
    }
    render(<GitReviewBody {...props(injected)} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'reviewAction' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'reviewAction' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'cancel' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(aborted).toBe(true)
  })

  it('asks before regenerating an edited draft', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    let calls = 0
    const injected: GitReviewBodyInjected = { ...base(), generate: async () => { calls += 1; return draft('draft text') } }
    render(<GitReviewBody {...props(injected)} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'reviewAction' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'reviewAction' }))
    const editor = await screen.findByLabelText('draftTitle')
    fireEvent.change(editor, { target: { value: 'edited draft text' } })
    fireEvent.click(screen.getByRole('button', { name: 'regenerate' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(calls).toBe(1)
  })

  it('drops a late response after the session changed', async () => {
    let release: (value: GitAiGenerateResult | PromiseLike<GitAiGenerateResult>) => void = () => {}
    const gate = new Promise<GitAiGenerateResult>((resolve) => { release = resolve })
    const injected: GitReviewBodyInjected = { ...base(), generate: () => gate }
    const { rerender } = render(<GitReviewBody {...props(injected)} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'reviewAction' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'reviewAction' }))
    // 换 Session 重挂载：epoch 递增，旧响应不再落盘
    rerender(<GitReviewBody {...props(injected, 'session-2')} />)
    release(draft('late draft'))
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20) }) })
    expect(screen.queryByLabelText('draftTitle')).not.toBeTruthy()
  })

  it('notifies when the repository HEAD moved during generation', async () => {
    const injected: GitReviewBodyInjected = { ...base(), generate: async () => draft('moved', 'def456') }
    render(<GitReviewBody {...props(injected)} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'reviewAction' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'reviewAction' }))
    await waitFor(() => { expect(screen.getByText('staleNotice')).toBeTruthy() })
  })
})
