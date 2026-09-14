/** Durable notification preferences shared by the Host settings provider and browser UI. */

import s from '@deepseek-ai/schemastery'

/** Settings namespace owned by the notification plugin. */
export const NOTIFICATIONS_SETTINGS_NAMESPACE = 'notifications'

/** Built-in notification sounds. */
export const NOTIFICATION_SOUNDS = [
  'system', 'two-tone', 'ding', 'pop', 'spark', 'flame', 't', 'click', 'custom',
] as const

/** Persisted sound selection. */
export type NotificationSound = typeof NOTIFICATION_SOUNDS[number]

/** User-controlled notification preferences. */
export interface NotificationSettings {
  /** Whether desktop notifications are enabled. */
  enabled: boolean
  /** Notify when an agent finishes and becomes idle. */
  agentCompletion: boolean
  /** Notify when a terminal emits a bell character. */
  terminalBell: boolean
  /** Sound played with desktop notifications. */
  sound: NotificationSound
  /** Skip notifications while the application is focused. */
  suppressWhenFocused: boolean
  /** Browser-local display name for a selected custom sound file. */
  customSoundName: string
}

/** Schema used by Host registration and Client settings decoding. */
export const NotificationSettingsSchema: s<NotificationSettings> = s.object({
  enabled: s.boolean().default(false),
  agentCompletion: s.boolean().default(false),
  terminalBell: s.boolean().default(false),
  sound: s.union([...NOTIFICATION_SOUNDS]).default('system'),
  suppressWhenFocused: s.boolean().default(false),
  customSoundName: s.string().default(''),
})
