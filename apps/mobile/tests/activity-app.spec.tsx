// @vitest-environment jsdom
/** Production application routes authenticated activity through the live reminder preferences. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DesktopSchema, HostIdSchema, SessionIdSchema } from '@cinlan/mobile-relay/protocol'
import App from '../src/App'
import { useDesktops } from '../src/transport/use-desktops'
import { SavedHostSchema } from '../src/transport/client'
import type { MobileActivity } from '../src/transport/activity'
import zh from '../src/locales/zh-CN.json'

vi.mock('../src/transport/use-desktops', () => ({ useDesktops: vi.fn() }))
let receive: (activity: MobileActivity) => void
const activity: MobileActivity = { hostId: HostIdSchema.parse('desktop'), sessionId: SessionIdSchema.parse('session'), kind: 'approval' }
const saved = SavedHostSchema.parse({ hostId: 'desktop', name: 'Desktop', publicKey: 'a'.repeat(44), deviceId: 'device',
  token: 'b'.repeat(43), relayToken: 'c'.repeat(43), directUrl: 'ws://localhost/' })
const desktop = DesktopSchema.parse({ hostId: 'desktop', name: 'Desktop', os: 'Windows', workspaces: [],
  sessions: [{ id: 'session', title: 'Review', cwd: '', running: true, updatedAt: 0 }] })

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.mocked(useDesktops).mockImplementation((callback) => {
    receive = callback
    return { hosts: { desktop: { saved, desktop, status: 'paired' } }, approvals: {}, transcripts: {}, streams: {},
      error: '', pairing: false, pair: vi.fn(async () => {}), subscribe: vi.fn(async () => {}),
      prompt: vi.fn(async () => {}), decide: vi.fn(async () => {}), create: vi.fn(async () => 'session'),
      disconnect: vi.fn(), deleteHost: vi.fn(), reconnect: vi.fn(async () => {}), reportError: vi.fn() }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it('renders a live activity reminder, dismisses it with a button and honors disabled preferences', () => {
  render(<App />)
  act(() => { receive(activity) })
  expect(screen.getByRole('alert').textContent).toContain(zh.notifications.approval)
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.dismiss }))
  expect(screen.queryByRole('alert')).toBeNull()
  localStorage.setItem('cinlan-mobile:notifications-enabled', 'false')
  act(() => { receive(activity) })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('does not display background activity or disabled-storage activity later as a new reminder', () => {
  render(<App />)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  act(() => { receive(activity) })
  expect(screen.queryByRole('alert')).toBeNull()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  expect(screen.queryByRole('alert')).toBeNull()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied') })
  act(() => { receive(activity) })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('mutes only the exact session being viewed, preserving other desktops and sessions', () => {
  localStorage.setItem('cinlan-mobile:notifications-focused', 'true')
  render(<App />)
  fireEvent.click(screen.getByText('Desktop', { exact: true }))
  fireEvent.click(screen.getByText('Review', { exact: true }))
  act(() => { receive(activity) })
  expect(screen.queryByRole('alert')).toBeNull()
  act(() => { receive({ ...activity, sessionId: SessionIdSchema.parse('other-session'), kind: 'idle' }) })
  expect(screen.getByRole('alert').textContent).toContain(zh.notifications.idle)
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.dismiss }))
  act(() => { receive({ ...activity, hostId: HostIdSchema.parse('other-desktop') }) })
  expect(screen.getByRole('alert').textContent).toContain(zh.notifications.approval)
})

it('opens application settings before pairing and returns to the connection screen', () => {
  const connected = vi.mocked(useDesktops).getMockImplementation()!
  vi.mocked(useDesktops).mockImplementation(callback => ({ ...connected(callback), hosts: {} }))
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: zh.settings.title, exact: true }))
  fireEvent.click(screen.getByRole('button', { name: zh.settings.notifications, exact: true }))
  expect(screen.getByRole('switch', { name: zh.notifications.enabled })).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh.settings.back }))
  fireEvent.click(screen.getByRole('button', { name: '返回' }))
  expect(screen.getByRole('button', { name: zh.settings.title, exact: true })).toBeDefined()
})
