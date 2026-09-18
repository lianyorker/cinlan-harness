/** Notification preference writes require Host acceptance and confirmed user values. */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotificationSettings } from '@deepseek-ai/dsh-notifications/types'
import type { NotificationRuntimeFace } from './runtime.ts'

const FIELDS = [
  'enabled', 'agentCompletion', 'terminalBell', 'sound', 'suppressWhenFocused', 'customSoundName',
  'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd',
] as const

/**
 * Check for an explicit notification override, including values equal to defaults.
 * @param user - raw user layer from the settings snapshot.
 * @returns whether reset has a notification override to remove.
 */
export function hasNotificationOverrides(user: unknown): boolean {
  return typeof user === 'object' && user !== null && FIELDS.some(field => Object.hasOwn(user, field))
}

/**
 * Project preference commands without exposing the settings service to components.
 * @param settings - durable notification namespace.
 * @param runtime - browser-local sound registration.
 * @returns commands resolving false when Host acceptance or the persisted choice is missing.
 */
export function createNotificationSettingsActions(settings: SettingsScope<NotificationSettings>, runtime: NotificationRuntimeFace): {
  writePreference<K extends keyof NotificationSettings>(field: K, value: NotificationSettings[K]): Promise<boolean>
  writeQuietHours(start: string, end: string, expectedRevision?: number): Promise<boolean>
  selectCustomSound(file: File): Promise<boolean>
  resetPreferences(): Promise<boolean>
} {
  const writable = (): boolean => {
    const snapshot = settings.getSnapshot()
    return snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  }
  const matches = (expected: Partial<NotificationSettings>): boolean => {
    const snapshot = settings.getSnapshot()
    return snapshot.status === 'ready' && FIELDS.every((field) => {
      if (!Object.hasOwn(expected, field)) return true
      const user = snapshot.user
      return snapshot.value?.[field] === expected[field]
        && typeof user === 'object' && user !== null && Object.hasOwn(user, field)
        && (user as Partial<NotificationSettings>)[field] === expected[field]
    })
  }
  return {
    writePreference: async <K extends keyof NotificationSettings>(field: K, value: NotificationSettings[K]): Promise<boolean> => {
      if (!writable()) return false
      const expected = { [field]: value }
      if (matches(expected)) return true
      const accepted = await settings.mutate([{ op: 'set', path: [field], value }])
      return accepted && matches(expected)
    },
    /**
     * Save both times atomically; the Host validates HH:mm input before persistence.
     * @param start - inclusive daily start in browser-local time.
     * @param end - exclusive daily end; matching start and end suppress alerts all day.
     * @param expectedRevision - revision where editing began; omit on explicit retry to use the latest Host view.
     * @returns whether the Host accepted both overrides and the current snapshot confirms them.
     */
    writeQuietHours: async (start: string, end: string, expectedRevision?: number): Promise<boolean> => {
      if (!writable()) return false
      const expected = { quietHoursStart: start, quietHoursEnd: end }
      if (matches(expected)) return true
      const accepted = await settings.mutate([
        { op: 'set', path: ['quietHoursStart'], value: start },
        { op: 'set', path: ['quietHoursEnd'], value: end },
      ], expectedRevision)
      return accepted && matches(expected)
    },
    selectCustomSound: async (file: File): Promise<boolean> => {
      if (!writable()) return false
      const expected = { sound: 'custom', customSoundName: file.name } as const
      if (!matches(expected)) {
        const accepted = await settings.mutate([
          { op: 'set', path: ['sound'], value: 'custom' },
          { op: 'set', path: ['customSoundName'], value: file.name },
        ])
        if (!accepted || !matches(expected)) return false
      }
      runtime.registerCustomSound(file.name, file)
      return true
    },
    resetPreferences: async (): Promise<boolean> => {
      if (!writable()) return false
      if (!hasNotificationOverrides(settings.getSnapshot().user)) return true
      const accepted = await settings.mutate(FIELDS.map(field => ({ op: 'unset', path: [field] })))
      return accepted && matches({}) && !hasNotificationOverrides(settings.getSnapshot().user)
    },
  }
}
