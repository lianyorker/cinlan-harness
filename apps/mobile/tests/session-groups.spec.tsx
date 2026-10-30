// @vitest-environment jsdom
/** Host-local workspace expansion survives navigation and malformed browser storage. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopSessionsScreen } from '../src/screens/DesktopSessions/DesktopSessionsScreen'
import type { WorkspaceGroup } from '../src/types'

vi.mock('../src/context/ThemeLanguageContext', () => ({
  useAppConfig: () => ({ language: 'zh-CN', t: (key: string) => key }),
}))
afterEach(() => { cleanup(); localStorage.clear() })
const workspaces: WorkspaceGroup[] = [
  { id: 'first', name: 'Project One', sessions: [{ id: 'one', title: 'First conversation', type: 'chat' }] },
  { id: 'second', name: 'Project Two', sessions: [{ id: 'two', title: 'Second conversation', type: 'chat' }] },
]
function mount(host = 'host-a') {
  return render(<DesktopSessionsScreen desktopId={host} workspaces={workspaces}
    onCreateSession={async () => {}} onBack={() => {}} onSelectSession={() => {}} />)
}
it('opens only the first group by default and restores choices only for the same Host', () => {
  const first = mount()
  expect(screen.getByText('First conversation')).toBeTruthy()
  expect(screen.queryByText('Second conversation')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Project One/ }))
  fireEvent.click(screen.getByRole('button', { name: /Project Two/ }))
  first.unmount()
  const second = mount('host-b')
  expect(screen.getByText('First conversation')).toBeTruthy()
  expect(screen.queryByText('Second conversation')).toBeNull()
  second.unmount()
  mount()
  expect(screen.queryByText('First conversation')).toBeNull()
  expect(screen.getByText('Second conversation')).toBeTruthy()
})
it.each(['null', '[]', '{"first":"false"}', '{broken'])('defaults safely with invalid expansion storage %s', (raw) => {
  localStorage.setItem('cinlan-mobile:workspace-expanded:host-a', raw)
  mount()
  expect(screen.getByText('First conversation')).toBeTruthy()
  expect(screen.queryByText('Second conversation')).toBeNull()
})
