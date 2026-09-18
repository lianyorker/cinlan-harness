// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestRemote, TestSessions, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { MutableSessionEventSource, SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { NotificationSettings } from '@deepseek-ai/dsh-notifications/types'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createNotificationRuntime, isQuietHours } from '../src/client/runtime.ts'
import { NotificationSettingsSchema } from '@deepseek-ai/dsh-notifications/src/settings.ts'

interface OwnedRuntime {
  ctx: Context
  runtime?: ReturnType<typeof createNotificationRuntime>
  sessions?: TestSessions
}
const active: OwnedRuntime[] = []

afterEach(async () => {
  for (const { ctx, runtime, sessions } of active.splice(0)) {
    runtime?.dispose()
    await sessions?.disposeScopes()
    await ctx.fiber.dispose()
  }
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function browser(permission: NotificationPermission = 'granted') {
  const delivered = vi.fn()
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
  class BrowserNotification {
    static permission = permission
    static requestPermission = requestPermission
    constructor(title: string, options: NotificationOptions) { delivered(title, options) }
  }
  vi.stubGlobal('Notification', BrowserNotification)
  return { delivered, requestPermission }
}

async function bench(overrides: Partial<NotificationSettings> = {}) {
  const ctx = new Context()
  const owned: OwnedRuntime = { ctx }
  active.push(owned)
  const remote = new TestRemote(ctx)
  const sessions = new TestSessions(async (fn) => { await fn() }, ctx)
  owned.sessions = sessions
  ctx.provide('sessions', sessions)
  const sessionId = await sessions.add({ id: 'notification-session', summary: { displayTitle: 'Build UI' } })
  const settings = stubSettingsScope<NotificationSettings>()
  settings.publish({ status: 'ready', writable: true, value: NotificationSettingsSchema({
    ...NotificationSettingsSchema(), enabled: true, agentCompletion: true, terminalBell: true, ...overrides,
  }) })
  let locale = 'en'
  const runtime = createNotificationRuntime(ctx, settings.scope, {
    get completionTitle() { return locale === 'en' ? 'Agent finished' : '智能体已停止运行' },
    completionBody: title => title,
    bellTitle: 'Terminal bell', bellBody: title => title,
    testTitle: 'Test', testBody: 'Test delivery',
  })
  owned.runtime = runtime
  return { ctx, remote, sessions, sessionId, settings, runtime, setLocale: (next: string) => { locale = next } }
}

function result(seq: number, text: string): SessionLiveEventEntry {
  const callId = ToolCallId(`call-${seq}`)
  return { type: 'event', event: {
    type: 'tool/result', seq: SessionSeq(seq), time: 1, surfaceOp: 'append',
    data: { turn: 1, step: 1, message: {
      id: MessageId(`result-${seq}`), role: 'user', source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError: false }],
    } },
  } }
}

describe('daily local quiet hours', () => {
  it.each([
    ['22:00', '08:00', 21, 59, false],
    ['22:00', '08:00', 22, 0, true],
    ['22:00', '08:00', 23, 59, true],
    ['22:00', '08:00', 0, 0, true],
    ['22:00', '08:00', 7, 59, true],
    ['22:00', '08:00', 8, 0, false],
    ['09:30', '17:45', 9, 29, false],
    ['09:30', '17:45', 9, 30, true],
    ['09:30', '17:45', 17, 44, true],
    ['09:30', '17:45', 17, 45, false],
    ['08:00', '08:00', 7, 59, true],
    ['08:00', '08:00', 8, 0, true],
    ['08:00', '08:00', 23, 59, true],
  ] as const)('%s–%s at %i:%i suppresses = %s', (quietHoursStart, quietHoursEnd, hour, minute, quiet) => {
    const settings = NotificationSettingsSchema({ ...NotificationSettingsSchema(),
      quietHoursEnabled: true, quietHoursStart, quietHoursEnd })
    expect(isQuietHours(settings, new Date(2026, 0, 15, hour, minute, 59))).toBe(quiet)
    expect(isQuietHours({ ...settings, quietHoursEnabled: false }, new Date(2026, 0, 15, hour, minute))).toBe(false)
  })
})

describe('notification delivery consumers', () => {
  it('notifies each running-to-idle edge, follows locale changes, and clears reconnect history', async () => {
    const api = browser()
    const b = await bench()
    b.remote.emit('api-session/status', [b.sessionId, false])
    b.remote.emit('api-session/status', [b.sessionId, true])
    b.remote.emit('api-session/status', [b.sessionId, false])
    b.remote.emit('api-session/status', [b.sessionId, false])
    await Promise.resolve()
    expect(api.delivered).toHaveBeenCalledExactlyOnceWith('Agent finished', { body: 'Build UI' })
    b.setLocale('zh')
    b.remote.emit('api-session/status', [b.sessionId, true])
    b.remote.emit('api-session/status', [b.sessionId, false])
    await Promise.resolve()
    expect(api.delivered).toHaveBeenLastCalledWith('智能体已停止运行', { body: 'Build UI' })
    b.remote.emit('api-session/status', [b.sessionId, true])
    b.ctx.emit('connection/reset')
    b.remote.emit('api-session/status', [b.sessionId, false])
    await Promise.resolve()
    expect(api.delivered).toHaveBeenCalledTimes(2)
    b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, agentCompletion: false } })
    b.remote.emit('api-session/status', [b.sessionId, true])
    b.remote.emit('api-session/status', [b.sessionId, false])
    await Promise.resolve()
    expect(api.delivered).toHaveBeenCalledTimes(2)
  })

  it('rings for new BEL tool results, excluding history replacement and paging', async () => {
    const api = browser()
    const b = await bench()
    await b.sessions.replaceEvents(b.sessionId, [result(2, '\u0007')], true)
    await b.sessions.prependEvents(b.sessionId, [result(1, '\u0007')], false)
    expect(api.delivered).not.toHaveBeenCalled()
    await b.sessions.appendEvent(b.sessionId, result(3, 'ordinary output'))
    expect(api.delivered).not.toHaveBeenCalled()
    await b.sessions.appendEvent(b.sessionId, result(4, '\u0007\u0007'))
    expect(api.delivered).toHaveBeenCalledExactlyOnceWith('Terminal bell', { body: 'Build UI' })
    b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, terminalBell: false } })
    await b.sessions.appendEvent(b.sessionId, result(5, '\u0007'))
    expect(api.delivered).toHaveBeenCalledTimes(1)
  })

  it('honors focus quieting for background events but allows an explicit test', async () => {
    const api = browser()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const b = await bench({ suppressWhenFocused: true })
    await expect(b.runtime.notify({ title: 'Background', body: '' })).resolves.toBe(false)
    await expect(b.runtime.test()).resolves.toBe(true)
    expect(api.delivered).toHaveBeenCalledExactlyOnceWith('Test', { body: 'Test delivery' })
    b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, enabled: false } })
    await expect(b.runtime.test()).resolves.toBe(false)
    expect(api.delivered).toHaveBeenCalledTimes(1)
  })

  it('suppresses completion, BEL, and custom sounds overnight without replaying missed alerts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 15, 22, 0))
    const api = browser()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:quiet-sound'), revokeObjectURL: vi.fn() })
    const play = vi.fn(() => Promise.resolve())
    vi.stubGlobal('Audio', class { play = play })
    const b = await bench({ quietHoursEnabled: true, sound: 'custom', customSoundName: 'alert.wav' })
    b.runtime.registerCustomSound('alert.wav', new File(['sound'], 'alert.wav'))
    b.remote.emit('api-session/status', [b.sessionId, true])
    b.remote.emit('api-session/status', [b.sessionId, false])
    await b.sessions.appendEvent(b.sessionId, result(1, '\u0007'))
    expect(api.delivered).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(2026, 0, 16, 7, 59))
    await expect(b.runtime.notify({ title: 'Quiet', body: '' })).resolves.toBe(false)
    vi.setSystemTime(new Date(2026, 0, 16, 8, 0))
    expect(api.delivered).not.toHaveBeenCalled()
    b.remote.emit('api-session/status', [b.sessionId, true])
    b.remote.emit('api-session/status', [b.sessionId, false])
    await b.sessions.appendEvent(b.sessionId, result(2, '\u0007'))
    expect(api.delivered.mock.calls).toEqual([
      ['Agent finished', { body: 'Build UI' }], ['Terminal bell', { body: 'Build UI' }],
    ])
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('lets an explicit test bypass all-day quiet hours and foreground suppression together', async () => {
    const api = browser('default')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const b = await bench({ quietHoursEnabled: true, quietHoursStart: '12:00', quietHoursEnd: '12:00', suppressWhenFocused: true })
    await expect(b.runtime.notify({ title: 'Automatic', body: '' })).resolves.toBe(false)
    expect(api.requestPermission).not.toHaveBeenCalled()
    await expect(b.runtime.test()).resolves.toBe(true)
    expect(api.requestPermission).toHaveBeenCalledOnce()
    expect(api.delivered).toHaveBeenCalledExactlyOnceWith('Test', { body: 'Test delivery' })
  })

  it.each(['quiet-time', 'quiet-setting', 'focus'] as const)('rechecks %s immediately before creating an automatic notification', async (change) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 15, 21, 59))
    const api = browser()
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const b = await bench({ quietHoursEnabled: true, suppressWhenFocused: true })
    const pending = b.runtime.notify({ title: 'Automatic', body: '' })
    if (change === 'quiet-time') vi.setSystemTime(new Date(2026, 0, 15, 22, 0))
    else if (change === 'focus') focus.mockReturnValue(true)
    else b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, quietHoursStart: '21:00' } })
    await expect(pending).resolves.toBe(false)
    expect(api.delivered).not.toHaveBeenCalled()
  })

  it('requests permission only for the user-triggered test', async () => {
    const api = browser('default')
    const b = await bench()
    await expect(b.runtime.notify({ title: 'Background', body: '' })).resolves.toBe(false)
    expect(api.requestPermission).not.toHaveBeenCalled()
    await expect(b.runtime.test()).resolves.toBe(true)
    expect(api.requestPermission).toHaveBeenCalledOnce()
    expect(api.delivered).toHaveBeenCalledOnce()
  })

  it.each(['disabled', 'disposed'] as const)('does not deliver after preferences become %s while permission is pending', async (state) => {
    const api = browser('default')
    let grant!: (value: NotificationPermission) => void
    api.requestPermission.mockImplementation(() => new Promise((resolve) => { grant = resolve }))
    const b = await bench()
    const pending = b.runtime.test()
    expect(api.requestPermission).toHaveBeenCalledOnce()
    if (state === 'disposed') b.runtime.dispose()
    else b.settings.publish({ value: { ...b.settings.scope.getSnapshot().value!, enabled: false } })
    grant('granted')
    await expect(pending).resolves.toBe(false)
    expect(api.delivered).not.toHaveBeenCalled()
  })

  it('reports denied, unsupported, and rejected browser permission without delivery', async () => {
    const api = browser('denied')
    const b = await bench()
    await expect(b.runtime.test()).resolves.toBe(false)
    expect(api.requestPermission).not.toHaveBeenCalled()
    vi.stubGlobal('Notification', undefined)
    await expect(b.runtime.test()).resolves.toBe(false)
    const denied = browser('default')
    denied.requestPermission.mockRejectedValue(new Error('permission unavailable'))
    await expect(b.runtime.test()).resolves.toBe(false)
    expect(denied.delivered).not.toHaveBeenCalled()
  })

  it('plays custom audio only in its browser lifetime and revokes replaced files', async () => {
    browser()
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const play = vi.fn(() => Promise.resolve())
    const sources: string[] = []
    vi.stubGlobal('Audio', class { constructor(source: string) { sources.push(source) } play = play })
    const b = await bench({ sound: 'custom', customSoundName: 'alert.wav' })
    await expect(b.runtime.test()).resolves.toBe(true)
    expect(play).not.toHaveBeenCalled()
    b.runtime.registerCustomSound('alert.wav', new File(['first'], 'alert.wav'))
    await expect(b.runtime.test()).resolves.toBe(true)
    expect(sources).toEqual(['blob:first'])
    b.runtime.registerCustomSound('alert.wav', new File(['second'], 'alert.wav'))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
    b.runtime.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second')
    await expect(b.runtime.test()).resolves.toBe(false)
  })

  it('plays the selected synthesized sound and closes its audio context', async () => {
    vi.useFakeTimers()
    browser()
    const frequencies: number[] = []
    const close = vi.fn(() => Promise.resolve())
    vi.stubGlobal('AudioContext', class {
      currentTime = 0
      destination = {}
      close = close
      createOscillator() {
        const frequency = { value: 0 }
        return { frequency, connect: vi.fn(), start: () => { frequencies.push(frequency.value) }, stop: vi.fn() }
      }
      createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() } }
    })
    const b = await bench({ sound: 'two-tone' })
    await expect(b.runtime.test()).resolves.toBe(true)
    expect(frequencies).toEqual([660, 880])
    await vi.runOnlyPendingTimersAsync()
    expect(close).toHaveBeenCalledOnce()
  })

  it('unsubscribes removed sessions and stops status delivery on disposal', async () => {
    const api = browser()
    const b = await bench()
    const binding = b.sessions.binding(b.sessionId)!
    const eventSource = binding.eventSource as MutableSessionEventSource
    await b.sessions.remove(b.sessionId)
    eventSource.append(result(1, '\u0007'))
    await Promise.resolve()
    expect(api.delivered).not.toHaveBeenCalled()
    b.runtime.dispose()
    b.remote.emit('api-session/status', [b.sessionId, true])
    b.remote.emit('api-session/status', [b.sessionId, false])
    await Promise.resolve()
    expect(api.delivered).not.toHaveBeenCalled()
  })
})
