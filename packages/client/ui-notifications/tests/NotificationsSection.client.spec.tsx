// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, stubSettingsScope, TestSessions, TestWorkspaces } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { NotificationSettings } from '@deepseek-ai/dsh-notifications/types'
import { NotificationsSection } from '../src/client/NotificationsSection.tsx'
import type { NotificationsSectionProps } from '../src/client/NotificationsSection.tsx'
import { en } from '../src/client/locales.ts'

function bench(value: Partial<NotificationSettings> = {}) {
  const ctx = new Context()
  const sessions = new TestSessions(async (fn) => { await fn() }, ctx)
  const workspaces = new TestWorkspaces(async (fn) => { await fn() })
  const interactions = createSnapshotStore<SessionPendingInteractionSnapshot>(new Map())
  onTestFinished(async () => { await sessions.disposeScopes(); await ctx.fiber.dispose() })
  const settings = stubSettingsScope<NotificationSettings>()
  settings.publish({
    status: 'ready', writable: true, mode: 'host', revision: 1,
    value: {
      enabled: true, agentCompletion: false, terminalBell: false, sound: 'system', suppressWhenFocused: false, customSoundName: '',
      quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00', ...value,
    },
  })
  const writePreference = vi.fn(() => Promise.resolve(true))
  const writeQuietHours = vi.fn((_start: string, _end: string, _revision?: number) => Promise.resolve(true))
  const selectCustomSound = vi.fn(() => Promise.resolve(true))
  const resetPreferences = vi.fn(() => Promise.resolve(true))
  const testNotification = vi.fn(() => Promise.resolve(true))
  const props: NotificationsSectionProps = {
    close: vi.fn(),
    t: makeTranslate(en, {}),
    useSessions: bindSnapshotSelector(sessions.list),
    useWorkspaces: bindSnapshotSelector(workspaces.list),
    useSessionPendingInteraction: bindSnapshotSelector(interactions),
    useResource: () => { throw new Error('Resource hook is not used by this fixture') },
    useSettings: bindSnapshotSelector(settings.scope),
    writePreference, writeQuietHours, selectCustomSound, resetPreferences, testNotification,
  }
  return { props, settings, writePreference, writeQuietHours, selectCustomSound, resetPreferences, testNotification }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('NotificationsSection', () => {
  it('renders one page heading and supported searchable rows', () => {
    const { container } = render(<NotificationsSection {...bench().props} />)
    expect(screen.getByRole('heading', { name: en.title, level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.desktopGroup, level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.soundsGroup, level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.quietHoursGroup, level: 2 })).toBeTruthy()
    expect([...container.querySelectorAll('[data-settings-anchor]')].map(node => node.getAttribute('data-settings-anchor'))).toEqual([
      'notifications-enabled', 'notifications-agent-completion', 'notifications-terminal-bell',
      'notifications-focus-suppression', 'notifications-test', 'notifications-quiet-hours',
      'notifications-quiet-start', 'notifications-quiet-end', 'notifications-sound',
      'notifications-custom-sound', 'notifications-reset',
    ])
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursStart).value).toBe('22:00')
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursEnd).value).toBe('08:00')
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursStart).disabled).toBe(true)
  })

  it('keeps dependent controls disabled until notifications are enabled', () => {
    render(<NotificationsSection {...bench({ enabled: false }).props} />)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.enabled }).disabled).toBe(false)
    for (const name of [en.agentCompletion, en.terminalBell, en.focusSuppression, en.quietHoursEnabled]) {
      expect(screen.getByRole<HTMLButtonElement>('switch', { name }).disabled).toBe(true)
    }
    expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.sendTest }).disabled).toBe(true)
  })

  it.each([
    ['loading', true, en.loading],
    ['unavailable', false, en.settingsUnavailable],
    ['ready', false, en.readOnly],
  ] as const)('reports %s settings availability and prevents edits', (status, writable, message) => {
    const b = bench()
    b.settings.publish({ status, writable, ...(status === 'loading' ? { value: undefined } : {}) })
    render(<NotificationsSection {...b.props} />)
    expect(screen.getByRole('status').textContent).toBe(message)
    fireEvent.click(screen.getByRole('switch', { name: en.enabled }))
    expect(b.writePreference).not.toHaveBeenCalled()
  })

  it.each([
    [en.enabled, 'enabled', false],
    [en.agentCompletion, 'agentCompletion', true],
    [en.terminalBell, 'terminalBell', true],
    [en.focusSuppression, 'suppressWhenFocused', true],
    [en.quietHoursEnabled, 'quietHoursEnabled', true],
  ])('writes the persisted field for %s', async (name, field, value) => {
    const b = bench()
    render(<NotificationsSection {...b.props} />)
    fireEvent.click(screen.getByRole('switch', { name }))
    await waitFor(() => { expect(b.writePreference).toHaveBeenCalledWith(field, value) })
    await waitFor(() => { expect(screen.getByRole('region', { name: en.title }).getAttribute('aria-busy')).toBe('false') })
  })

  it('holds controls while a write is pending and retries the rejected choice', async () => {
    const b = bench()
    let reject!: (error: Error) => void
    b.writePreference.mockImplementationOnce(() => new Promise<boolean>((_resolve, fail) => { reject = fail }))
    render(<NotificationsSection {...b.props} />)
    fireEvent.click(screen.getByRole('switch', { name: en.terminalBell }))
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.enabled }).disabled).toBe(true)
    await act(async () => { reject(new Error('host unavailable')) })
    expect(screen.getByRole('alert').textContent).toContain(en.saveFailed)
    expect(screen.getByRole('switch', { name: en.terminalBell }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(b.writePreference).toHaveBeenNthCalledWith(2, 'terminalBell', true)
  })

  it('reports an unconfirmed write and displays the recovered Host value', async () => {
    const b = bench()
    b.writePreference.mockResolvedValue(false)
    render(<NotificationsSection {...b.props} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ding' } })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.saveFailed) })
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('system')
    act(() => { b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, sound: 'pop' } }) })
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('pop')
  })

  it('submits both quiet times together and preserves the revision where editing began', async () => {
    const b = bench({ quietHoursEnabled: true })
    b.writeQuietHours.mockImplementation(async (start, end) => {
      b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, quietHoursStart: start, quietHoursEnd: end } })
      return true
    })
    render(<NotificationsSection {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.quietHoursStart), { target: { value: '23:30' } })
    act(() => { b.settings.publish({ revision: 2, value: { ...b.settings.scope.getSnapshot().value!, quietHoursEnd: '09:00' } }) })
    fireEvent.change(screen.getByLabelText(en.quietHoursEnd), { target: { value: '06:15' } })
    expect(b.writeQuietHours).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.saveQuietHours }))
    await waitFor(() => { expect(b.writeQuietHours).toHaveBeenCalledExactlyOnceWith('23:30', '06:15', 1) })
    await waitFor(() => { expect(screen.getByRole('region', { name: en.title }).getAttribute('aria-busy')).toBe('false') })
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursStart).value).toBe('23:30')
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursEnd).value).toBe('06:15')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.saveQuietHours }).disabled).toBe(true)
  })

  it.each(['refused', 'transport'] as const)('restores Host quiet times after a %s failure and retries with a fresh revision', async (failure) => {
    const b = bench({ quietHoursEnabled: true })
    b.writeQuietHours.mockImplementationOnce(async () => {
      b.settings.publish({ revision: 2, value: { ...b.settings.scope.getSnapshot().value!, quietHoursStart: '21:00' } })
      if (failure === 'transport') throw new Error('host unavailable')
      return false
    })
    render(<NotificationsSection {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.quietHoursStart), { target: { value: '23:30' } })
    fireEvent.change(screen.getByLabelText(en.quietHoursEnd), { target: { value: '06:15' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveQuietHours }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.saveFailed) })
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursStart).value).toBe('21:00')
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursEnd).value).toBe('08:00')
    b.writeQuietHours.mockImplementationOnce(async (start, end) => {
      b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, quietHoursStart: start, quietHoursEnd: end } })
      return true
    })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(b.writeQuietHours).toHaveBeenNthCalledWith(2, '23:30', '06:15')
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursStart).value).toBe('23:30')
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursEnd).value).toBe('06:15')
  })

  it('requires complete quiet times before saving and permits equal times for all-day quieting', async () => {
    const b = bench({ quietHoursEnabled: true })
    render(<NotificationsSection {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.quietHoursStart), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveQuietHours }))
    expect(b.writeQuietHours).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(en.quietHoursStart), { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveQuietHours }))
    await waitFor(() => { expect(b.writeQuietHours).toHaveBeenCalledExactlyOnceWith('08:00', '08:00', 1) })
    await waitFor(() => { expect(screen.getByRole('region', { name: en.title }).getAttribute('aria-busy')).toBe('false') })
  })

  it('discards an unsaved time draft on reset and leaves recovered values after a failed reset', async () => {
    const b = bench({ quietHoursEnabled: true, quietHoursStart: '23:00' })
    b.settings.publish({ user: { quietHoursEnabled: true, quietHoursStart: '23:00' } })
    b.resetPreferences.mockResolvedValueOnce(false)
    render(<NotificationsSection {...b.props} />)
    fireEvent.change(screen.getByLabelText(en.quietHoursStart), { target: { value: '19:00' } })
    fireEvent.click(screen.getByRole('button', { name: en.reset }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.saveFailed) })
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursStart).value).toBe('23:00')
    b.resetPreferences.mockImplementationOnce(async () => {
      b.settings.publish({ user: {}, value: { ...b.settings.scope.getSnapshot().value!, quietHoursEnabled: false, quietHoursStart: '22:00' } })
      return true
    })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(screen.getByRole('switch', { name: en.quietHoursEnabled }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByLabelText<HTMLInputElement>(en.quietHoursStart).value).toBe('22:00')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.reset }).disabled).toBe(true)
  })

  it('opens custom audio from either sound control and preserves a canceled choice', async () => {
    const b = bench()
    render(<NotificationsSection {...b.props} />)
    const input = screen.getByLabelText<HTMLInputElement>(en.soundCustom)
    const open = vi.spyOn(input, 'click')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } })
    fireEvent.click(screen.getByRole('button', { name: en.soundCustom }))
    expect(open).toHaveBeenCalledTimes(2)
    fireEvent.change(input, { target: { files: [] } })
    expect(b.selectCustomSound).not.toHaveBeenCalled()
    const file = new File(['audio'], 'alert.wav', { type: 'audio/wav' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => { expect(b.selectCustomSound).toHaveBeenCalledWith(file) })
    expect(b.writePreference).not.toHaveBeenCalled()
  })

  it('renders custom filenames as text and enables reset for explicit default-valued overrides', async () => {
    const b = bench({ sound: 'custom', customSoundName: '<alert>.wav' })
    b.settings.publish({ user: { enabled: false } })
    render(<NotificationsSection {...b.props} />)
    expect(screen.getByText('<alert>.wav')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.reset }))
    await waitFor(() => { expect(b.resetPreferences).toHaveBeenCalledOnce() })
    act(() => { b.settings.publish({ user: undefined }) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.reset }).disabled).toBe(true)
  })

  it.each([true, false])('reports the real notification test result %s', async (sent) => {
    const b = bench()
    b.testNotification.mockResolvedValue(sent)
    render(<NotificationsSection {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.sendTest }))
    await waitFor(() => { expect(screen.getByRole(sent ? 'status' : 'alert').textContent).toBe(sent ? en.testSent : en.testUnavailable) })
    expect(b.testNotification).toHaveBeenCalledOnce()
    expect(b.writePreference).not.toHaveBeenCalled()
  })
})
