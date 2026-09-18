/** Browser notification delivery and completion-event wiring. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotificationSettings, NotificationSound } from '@deepseek-ai/dsh-notifications/types'

/** User-visible notification payload. */
export interface NotificationPayload {
  readonly title: string
  readonly body: string
}

/** Localized notification copy supplied by the client plugin. */
export interface NotificationRuntimeCopy {
  readonly completionTitle: string
  readonly completionBody: (sessionTitle: string) => string
  readonly bellTitle: string
  readonly bellBody: (sessionTitle: string) => string
  readonly testTitle: string
  readonly testBody: string
}

/** Runtime face used by the settings page and event consumers. */
export interface NotificationRuntimeFace {
  /** Deliver one background notification, respecting current preferences. */
  notify: (payload: NotificationPayload) => Promise<boolean>
  /** Deliver a test notification from a user gesture, ignoring focus and scheduled quieting. */
  test: () => Promise<boolean>
  /** Keep a browser-local custom sound file for this runtime. */
  registerCustomSound: (name: string, file: File) => void
  /** Release event listeners and object URLs. */
  dispose: () => void
}

/**
 * Build browser delivery over live notification preferences.
 * @param ctx - plugin context providing status events and session event sources.
 * @param settings - persisted preferences read before each delivery.
 * @param copy - localized notification copy; getters may follow locale changes.
 * @returns notification commands and a disposer for listeners and custom audio URLs.
 */
export function createNotificationRuntime(
  ctx: ClientContext,
  settings: SettingsScope<NotificationSettings>,
  copy: NotificationRuntimeCopy,
): NotificationRuntimeFace {
  const running = new Map<SessionId, boolean>()
  const customAudio = new Map<string, string>()
  let disposed = false

  const play = (value: NotificationSettings): void => {
    if (value.sound === 'system') return
    const source = value.sound === 'custom' ? customAudio.get(value.customSoundName) : undefined
    if (source !== undefined && typeof Audio !== 'undefined') {
      try { void new Audio(source).play().catch(() => {}) } catch { /* browser denied autoplay */ }
      return
    }
    playTone(value.sound)
  }

  const permission = async (request: boolean): Promise<boolean> => {
    if (typeof Notification === 'undefined') return false
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied' || !request) return false
    try { return await Notification.requestPermission() === 'granted' } catch { return false }
  }

  const currentPreferences = (userGesture: boolean): NotificationSettings | undefined => {
    const snapshot = settings.getSnapshot()
    const value = snapshot.value
    if (disposed || snapshot.status !== 'ready' || value?.enabled !== true) return undefined
    if (!userGesture && isQuietHours(value, new Date())) return undefined
    if (!userGesture && value.suppressWhenFocused && typeof document !== 'undefined' && document.hasFocus()) return undefined
    return value
  }

  const deliver = async (payload: NotificationPayload, userGesture: boolean): Promise<boolean> => {
    if (currentPreferences(userGesture) === undefined || !await permission(userGesture)) return false
    const value = currentPreferences(userGesture)
    if (value === undefined || typeof Notification === 'undefined') return false
    try {
      new Notification(payload.title, { body: payload.body })
      play(value)
      return true
    } catch { return false }
  }

  const offStatus = ctx.remote.$on('api-session/status', (sessionId, isRunning) => {
    const previous = running.get(sessionId)
    running.set(sessionId, isRunning)
    if (previous !== true || isRunning) return
    const value = settings.getSnapshot().value
    if (value?.agentCompletion !== true) return
    const title = ctx.sessions.list.getSnapshot().byId[sessionId]?.displayTitle ?? String(sessionId)
    void deliver({ title: copy.completionTitle, body: copy.completionBody(title) }, false)
  })
  const offReset = ctx.on('connection/reset', () => { running.clear() })

  const eventUnsubs = new Map<SessionId, () => void>()
  const checkBell = (sessionId: SessionId): void => {
    const value = settings.getSnapshot().value
    if (value?.terminalBell !== true) return
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return
    const window = binding.eventSource.getSnapshot()
    const delta = window.change
    if (delta.kind !== 'append') return
    for (const entry of delta.entries) {
      if (entry.type !== 'event') continue
      if (entry.event.type !== 'tool/result') continue
      for (const block of entry.event.data.message.content) {
        for (const inner of block.content) {
          if (inner.type === 'text' && inner.text.includes('\u0007')) {
            const title = ctx.sessions.list.getSnapshot().byId[sessionId]?.displayTitle ?? String(sessionId)
            void deliver({ title: copy.bellTitle, body: copy.bellBody(title) }, false)
            return
          }
        }
      }
    }
  }
  const syncEventSources = (): void => {
    const ids = ctx.sessions.list.getSnapshot().ids
    const seen = new Set<SessionId>()
    for (const id of ids) {
      seen.add(id)
      if (eventUnsubs.has(id)) continue
      const binding = ctx.sessions.binding(id)
      if (binding === undefined) continue
      eventUnsubs.set(id, binding.eventSource.subscribe(() => { checkBell(id) }))
    }
    for (const [id, unsub] of eventUnsubs) {
      if (seen.has(id)) continue
      unsub()
      eventUnsubs.delete(id)
    }
  }
  const offList = ctx.sessions.list.subscribe(syncEventSources)
  syncEventSources()

  return {
    notify: payload => deliver(payload, false),
    test: () => deliver({ title: copy.testTitle, body: copy.testBody }, true),
    registerCustomSound: (name, file) => {
      if (disposed) return
      const url = URL.createObjectURL(file)
      const previous = customAudio.get(name)
      if (previous !== undefined) URL.revokeObjectURL(previous)
      customAudio.set(name, url)
    },
    dispose: () => {
      disposed = true
      offStatus()
      offReset()
      offList()
      for (const unsub of eventUnsubs.values()) unsub()
      eventUnsubs.clear()
      for (const url of customAudio.values()) URL.revokeObjectURL(url)
      customAudio.clear()
      running.clear()
    },
  }
}

/**
 * Check the configured daily interval in the browser's current local time.
 * @param value - schema-validated notification preferences.
 * @param now - current local wall-clock time; no catch-up alerts are queued.
 * @returns whether automatic alerts are suppressed, including the start but excluding the end.
 */
export function isQuietHours(value: NotificationSettings, now: Date): boolean {
  if (!value.quietHoursEnabled) return false
  const minute = now.getHours() * 60 + now.getMinutes()
  const start = Number(value.quietHoursStart.slice(0, 2)) * 60 + Number(value.quietHoursStart.slice(3))
  const end = Number(value.quietHoursEnd.slice(0, 2)) * 60 + Number(value.quietHoursEnd.slice(3))
  if (start === end) return true
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

function playTone(sound: NotificationSound): void {
  if (typeof window === 'undefined') return
  const AudioContextCtor = (window as { AudioContext?: typeof AudioContext }).AudioContext
  if (AudioContextCtor === undefined) return
  const frequencies: Partial<Record<NotificationSound, readonly number[]>> = {
    'two-tone': [660, 880], ding: [880], pop: [220], spark: [1046], flame: [392, 523], t: [600], click: [180],
  }
  const notes = frequencies[sound]
  if (notes === undefined) return
  try {
    const audio = new AudioContextCtor()
    const now = audio.currentTime
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.05, now + index * 0.08)
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.12)
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.start(now + index * 0.08)
      oscillator.stop(now + index * 0.08 + 0.12)
    })
    const lastEnd = notes.length * 0.08 + 0.12
    setTimeout(() => { void audio.close().catch(() => {}) }, (lastEnd + 0.05) * 1000)
  } catch { /* a browser may reject AudioContext construction */ }
}
