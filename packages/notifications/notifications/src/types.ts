/** Pure notification preference data shared with browser consumers. */

/** Persisted sound selection. */
export type NotificationSound = 'system' | 'two-tone' | 'ding' | 'pop' | 'spark' | 'flame' | 't' | 'click' | 'custom'

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
  /** Suppress automatic alerts during the daily browser-local quiet window. */
  quietHoursEnabled: boolean
  /** Inclusive local start time in HH:mm form. */
  quietHoursStart: string
  /** Exclusive local end time; equal times suppress automatic alerts all day. */
  quietHoursEnd: string
}
