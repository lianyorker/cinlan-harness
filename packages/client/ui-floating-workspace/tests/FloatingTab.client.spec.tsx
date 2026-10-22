// @vitest-environment jsdom
/** Side-chat tab binding, creation, retry, and close ownership. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarRightTabActions, UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FloatingTab, type FloatingTabProps } from '../src/client/FloatingTab.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(createSession: () => Promise<SessionReference>) {
  const abort = new AbortController()
  const openTab = vi.fn()
  const actions: SidebarRightTabActions = { bindCommands: () => () => {}, openResource: () => {}, openTab, close: () => {} }
  const useTabInfo = (() => ({
    sidebar: { expanded: true, fullscreen: false }, panel: { id: 'pane' as PaneId },
    tab: { id: 'tab' as TabId, kind: 'floatingWorkspace', contentId: 'sidebar://floatingWorkspace/1', title: en.sideChat,
      visible: true, navigation: { address: 'sidebar://floatingWorkspace/1', params: undefined, revision: 0 },
      signal: abort.signal, actions },
  })) as UseSidebarRightTabInfo
  const unused = (() => { throw new Error('unused standard hook') }) as never
  const props = {
    useSessions: unused, useWorkspaces: unused, usePanelInfo: unused, useSessionStatus: unused,
    useSessionRetainInfo: unused, useResource: unused,
    useTabInfo, createSession, t: makeTranslate(en),
    SessionProvider: ({ session, children }: { session?: SessionReference; children: React.ReactNode }) =>
      <div data-session-id={session?.sessionId}>{children}</div>,
    renderSlot: () => <div data-chat />,
  } as FloatingTabProps
  return { ...render(<FloatingTab {...props} />), abort, openTab }
}

describe('side chat tabs', () => {
  it('creates an independent Session, exposes a new-tab action, and releases its Session on close', async () => {
    let resolve: ((value: SessionReference) => void) | undefined
    const release = vi.fn()
    const reference = { sessionId: 'side-chat-1', release } as never as SessionReference
    const h = mount(() => new Promise<SessionReference>((done) => { resolve = done }))
    expect(screen.getByRole('status').textContent).toBe(en.sessionLoading)
    fireEvent.click(screen.getByRole('button', { name: en.newSideChat }))
    expect(h.openTab).toHaveBeenCalledWith('floatingWorkspace', { revealIfOpened: false })
    await act(async () => { resolve?.(reference) })
    expect(screen.getByRole('button', { name: en.newSideChat })).toBeTruthy()
    expect(document.querySelector('[data-session-id="side-chat-1"] [data-chat]')).toBeTruthy()
    h.unmount()
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases a Session when the sidebar tab occurrence is aborted', async () => {
    const release = vi.fn()
    const reference = { sessionId: 'side-chat-2', release } as never as SessionReference
    const h = mount(async () => reference)
    await act(async () => { await Promise.resolve() })
    act(() => { h.abort.abort() })
    expect(release).toHaveBeenCalledOnce()
    h.unmount()
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps a failed tab visible and retries creation', async () => {
    const release = vi.fn()
    const reference = { sessionId: 'side-chat-retry', release } as never as SessionReference
    const createSession = vi.fn<() => Promise<SessionReference>>()
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reference)
    const h = mount(createSession)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toContain(en.sessionFailed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await act(async () => { await Promise.resolve() })
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-session-id="side-chat-retry"] [data-chat]')).toBeTruthy()
    h.unmount()
    expect(release).toHaveBeenCalledOnce()
  })
})
