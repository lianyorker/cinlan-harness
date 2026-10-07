// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionListState, SessionSummary as ClientSessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate, registerDomSnapshotSerializer } from '@deepseek-ai/dsh-client-test-runtime'
import { ArchivedSessionsSection } from '../src/client/ArchivedSessionsSection.tsx'
import type { ArchivedSessionsSectionProps } from '../src/client/ArchivedSessionsSection.tsx'
import { en, zh } from '../src/client/locales.ts'

registerDomSnapshotSerializer()

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-19T12:00:00Z')) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const DAY = 86_400_000
const sid = (id: string): SessionId => id as SessionId

const t = makeTranslate(en)

function summary(id: string, title: string, updatedAt: number): SessionSummary {
  return {
    sessionId: sid(id), updatedAt, running: false, blank: false, cwd: '/work/Project',
    projections: { kind: 'cached', asOfSeq: 0, values: { title } },
  }
}

function sessionState(sessions: readonly SessionSummary[], phase: SessionListState['phase'] = 'ready'): SessionListState {
  const clientRows: readonly ClientSessionSummary[] = sessions.map(session => ({
    id: session.sessionId,
    displayTitle: typeof session.projections?.values.title === 'string' ? session.projections.values.title : session.sessionId,
    running: session.running, blank: session.blank, updatedAt: session.updatedAt, retainedBy: {},
  }))
  return {
    ids: clientRows.map(session => session.id),
    byId: Object.fromEntries(clientRows.map(session => [session.id, session])),
    phase,
    projectionsBySession: {},
  }
}

function snapshot(archivedSessionIds: readonly string[], items: readonly WorkspaceView[] = []): WorkspaceSnapshot {
  return { items, archivedSessionIds: archivedSessionIds.map(sid), pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }
}

function workspace(title: string, sessionIds: readonly string[]): WorkspaceView {
  return {
    workspaceId: title as WorkspaceView['workspaceId'],
    path: `/work/${title}`,
    title,
    sessionIds: sessionIds.map(sid),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function props(options: {
  sessions: SessionListState
  workspaces: WorkspaceSnapshot
  unarchive?: (sessionId: SessionId) => Promise<void>
  requestSessionDelete?: (sessionId: SessionId, currentTitle: string) => void
}): ArchivedSessionsSectionProps {
  const summaries: readonly SessionSummary[] = options.sessions.ids.map(id => options.sessions.byId[id]).filter(Boolean).map(row => ({
    sessionId: row.id, updatedAt: row.updatedAt, running: row.running, blank: row.blank,
    projections: { kind: 'cached', asOfSeq: 0, values: { title: row.displayTitle } },
  }))
  return {
    t,
    loadArchived: async () => summaries,
    unarchive: options.unarchive ?? (async () => {}),
    requestSessionDelete: options.requestSessionDelete ?? (() => {}),
    useSessions: ((select: (state: SessionListState) => unknown) => select(options.sessions)),
    useWorkspaces: ((select: (state: WorkspaceSnapshot) => unknown) => select(options.workspaces)),
  } as unknown as ArchivedSessionsSectionProps
}

/** Two archived sessions in one Workspace, archived oldest first. */
function twoRows(): ArchivedSessionsSectionProps {
  return props({
    sessions: sessionState([
      summary('older', 'Older session', Date.now() - 2 * DAY),
      summary('newer', 'Newer session', Date.now()),
    ]),
    workspaces: snapshot(['older', 'newer'], [workspace('Project', ['older', 'newer'])]),
  })
}

describe('ArchivedSessionsSection', () => {
  it.each([['English', en], ['Chinese', zh]] as const)('renders the %s list, search, and restore controls', async (_locale, dictionary) => {
    const view = render(<ArchivedSessionsSection {...twoRows()} t={makeTranslate(dictionary)} />)
    await screen.findAllByRole('listitem')
    expect(view.container.firstElementChild).toMatchSnapshot()
  })

  it('lists the newest archive first with its Workspace and last activity', async () => {
    render(<ArchivedSessionsSection {...twoRows()} />)
    await screen.findAllByRole('listitem')

    expect(screen.getAllByRole('listitem').map(row => row.textContent)).toEqual([
      'Newer sessionProject · nowUnarchive',
      'Older sessionProject · 2dUnarchive',
    ])
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      'Delete Newer session', 'Unarchive Newer session', 'Delete Older session', 'Unarchive Older session',
    ])
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('searchbox').getAttribute('data-settings-anchor')).toBe('archived-sessions-search')
  })

  it('labels a session outside every Workspace and preserves an entry whose session is gone', async () => {
    render(<ArchivedSessionsSection {...props({
      sessions: sessionState([summary('loose', 'Loose session', Date.now())]),
      workspaces: snapshot(['gone', 'loose']),
    })} />)

    await screen.findAllByRole('listitem')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Loose session')).toBeTruthy()
    expect(screen.getByText('Ungrouped · now')).toBeTruthy()
    expect(screen.getByText('gone')).toBeTruthy()
  })

  it('reads sessions until the list arrives, then reports an empty archive', async () => {
    const pending = render(<ArchivedSessionsSection {...props({
      sessions: sessionState([], 'pending'),
      workspaces: snapshot([]),
    })} />)
    expect(screen.getByText(en.loading)).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    pending.unmount()

    render(<ArchivedSessionsSection {...props({ sessions: sessionState([]), workspaces: snapshot([]) })} />)
    await screen.findByText(en.empty)
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('waits for the Workspace archive baseline before reporting an empty archive', () => {
    render(<ArchivedSessionsSection {...props({
      sessions: sessionState([]),
      workspaces: { ...snapshot([]), phase: 'pending' },
    })} />)
    expect(screen.getByText(en.loading)).toBeTruthy()
    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('keeps missing-log archive entries addressable', async () => {
    render(<ArchivedSessionsSection {...props({
      sessions: sessionState([]),
      workspaces: snapshot(['gone', 'vanished']),
    })} />)

    await screen.findAllByRole('listitem')
    expect(screen.getAllByRole('listitem').some(row => row.textContent?.includes(en.missingLog))).toBe(true)
    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('filters by title and Workspace and reports a query with no match', async () => {
    render(<ArchivedSessionsSection {...twoRows()} />)
    await screen.findByRole('searchbox')
    const search = screen.getByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: '  OLDER  ' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Older session')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'project' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    fireEvent.change(search, { target: { value: 'absent' } })
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('unarchives the clicked row and keeps a rejection as a console diagnostic', async () => {
    const unarchive = vi.fn(async () => {})
    render(<ArchivedSessionsSection {...twoRows()} unarchive={unarchive} />)
    await screen.findByRole('button', { name: 'Unarchive Newer session' })
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive Newer session' }))
    expect(unarchive).toHaveBeenCalledWith('newer')

    cleanup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failure = new Error('transport down')
    render(<ArchivedSessionsSection {...props({
      sessions: sessionState([summary('older', 'Older session', Date.now())]),
      workspaces: snapshot(['older']),
      unarchive: async () => { throw failure },
    })} />)
    await screen.findByRole('button', { name: 'Unarchive Older session' })
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive Older session' }))
    await waitFor(() => { expect(warn).toHaveBeenCalledWith('session unarchive rejected:', failure) })
    warn.mockRestore()
  })

  it('the delete icon asks for the confirmation dialog with the row title', async () => {
    const requestSessionDelete = vi.fn()
    render(<ArchivedSessionsSection {...twoRows()} requestSessionDelete={requestSessionDelete} />)
    await screen.findByRole('button', { name: 'Delete Newer session' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Newer session' }))
    expect(requestSessionDelete).toHaveBeenCalledWith('newer', 'Newer session')
  })
})
