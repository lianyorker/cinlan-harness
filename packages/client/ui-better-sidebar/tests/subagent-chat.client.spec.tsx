// @vitest-environment jsdom
/** Child tabs retain ordinary Conversation scopes without selecting their sessions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '../src/context-types.ts'
import { SubagentChatView, registerSubagentChat, type SubagentChatViewProps } from '../src/client/SubagentChatView.tsx'
import { parseSubagentChatAddress, subagentChatAddress, SUBAGENT_CHAT_TYPE } from '../src/client/subagent-chat.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore, splitPane } from '../src/client/state.ts'

const address = { parentSessionId: 'parent' as SessionId, childSessionId: 'child' as SessionId, mode: 'continuable' as const }
const path = subagentChatAddress(address)
const disposers: (() => void)[] = []
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0).reverse()) dispose(); vi.restoreAllMocks() })

function reference() {
  const release = vi.fn()
  return { sessionId: address.childSessionId, ready: Promise.resolve(), release } satisfies SessionReference
}

function sidebar() {
  const store = createSidebarStore()
  store.setSession('parent')
  const service = createBetterSidebarService(store)
  const renderSessionView = vi.fn(() => <div data-testid="child-conversation" />)
  const retained = reference()
  const sessions = {
    list: { getSnapshot: () => ({ subagentsByParent: {}, byId: {} }) },
    refreshSubagents: vi.fn(async () => {}),
    retainSubagent: vi.fn((_address: unknown, _options: { signal: AbortSignal }) => retained),
    openSubagent: vi.fn(),
  }
  const ctx = { sessions, slots: { renderSessionView }, betterSidebar: service,
    effect: (effect: () => () => void) => { disposers.push(effect()) },
  } as unknown as Context
  registerSubagentChat(ctx)
  return { store, service, sessions, retained, renderSessionView }
}

describe('parallel child resource tabs', () => {
  it('round-trips routing data and rejects malformed persisted resources', () => {
    expect(parseSubagentChatAddress(subagentChatAddress({ ...address, childSessionId: 'a /?#' }))).toEqual({ ...address, childSessionId: 'a /?#' })
    for (const invalid of ['x', 'https://subagentchat/session/c?parent=p&mode=one-shot',
      'dsh-resource://other/session/c?parent=p&mode=one-shot',
      'dsh-resource://subagentchat/session/c?parent=p&mode=other',
      'dsh-resource://subagentchat/session/c?mode=one-shot',
      'dsh-resource://subagentchat/session/%zz?parent=p&mode=one-shot']) {
      expect(parseSubagentChatAddress(invalid)).toBeUndefined()
    }
  })

  it('keeps parent selection and deduplicates an existing child across splits', () => {
    const { store, service, sessions } = sidebar()
    service.openSubagentChat(address)
    store.reduce(state => splitPane(state, 'row'))
    const secondPane = allLeaves(store.getSnapshot().state!.splits)[1].id
    store.reduce(state => ({ ...state, activePane: secondPane }))
    service.openSubagentChat({ ...address, childSessionId: 'other' })
    service.openSubagentChat(address)
    const snapshot = store.getSnapshot()
    expect(snapshot.sessionId).toBe('parent')
    expect(allLeaves(snapshot.state!.splits).flatMap(leaf => leaf.tabs).filter(tab => tab.type === SUBAGENT_CHAT_TYPE).map(tab => tab.title)).toEqual(['child', 'other'])
    const leaves = allLeaves(snapshot.state!.splits)
    const tabs = leaves.flatMap(leaf => leaf.tabs).filter(tab => tab.type === SUBAGENT_CHAT_TYPE)
    expect(tabs.map(tab => tab.path)).toEqual([path, subagentChatAddress({ ...address, childSessionId: 'other' })])
    expect(snapshot.state!.activePane).not.toBe(secondPane)
    expect(sessions.openSubagent).not.toHaveBeenCalled()
    expect(service.getTabs().find(tab => tab.id === SUBAGENT_CHAT_TYPE)?.hidden).toBe(true)
  })

  it('waits for standard Session opening before invoking the scoped Conversation renderer', async () => {
    const { service, sessions, retained, renderSessionView } = sidebar()
    const descriptor = service.getTab(SUBAGENT_CHAT_TYPE)!
    const tab = { id: path, type: SUBAGENT_CHAT_TYPE, title: 'child', path }
    let view: ReturnType<typeof render>
    await act(async () => { view = render(<>{descriptor.component({ tab } as never)}</>) })
    expect(sessions.refreshSubagents).toHaveBeenCalledWith(address.parentSessionId)
    expect(sessions.retainSubagent.mock.calls[0][0]).toEqual(address)
    expect(sessions.retainSubagent.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(renderSessionView).toHaveBeenCalledWith('conversation', { embedded: true }, address.childSessionId)
    expect(sessions.openSubagent).not.toHaveBeenCalled()
    view!.unmount()
    expect(retained.release).toHaveBeenCalledOnce()
  })

  it('releases a late reference when a loading tab closes', async () => {
    let resolve!: (value: SessionReference) => void
    const promise = new Promise<SessionReference>((done) => { resolve = done })
    const open = vi.fn<SubagentChatViewProps['open']>(() => promise)
    const renderConversation = vi.fn(() => null)
    const view = render(<SubagentChatView path={path} open={open} renderConversation={renderConversation} />)
    const signal = open.mock.calls[0][1]
    view.unmount()
    expect(signal.aborted).toBe(true)
    const retained = reference()
    await act(async () => { resolve(retained); await promise })
    expect(retained.release).toHaveBeenCalledOnce()
    expect(renderConversation).not.toHaveBeenCalled()
  })

  it('shows an opening error and retries with a new lifetime', async () => {
    const retained = reference()
    const open = vi.fn<SubagentChatViewProps['open']>().mockRejectedValueOnce(new Error('child unavailable')).mockResolvedValueOnce(retained)
    const renderConversation = vi.fn(() => <div>transcript</div>)
    await act(async () => { render(<SubagentChatView path={path} open={open} renderConversation={renderConversation} />) })
    expect(screen.getByRole('alert').textContent).toContain('child unavailable')
    await act(async () => { fireEvent.click(screen.getByRole('button')) })
    expect(screen.getByText('transcript')).toBeTruthy()
    expect(open.mock.calls[0][1].aborted).toBe(true)
    expect(open.mock.calls[1][1].aborted).toBe(false)
  })
})
