/** Runtime schema and defaults owned by notification preferences. */
import s from '@deepseek-ai/schemastery'
import type { NotificationSettings } from './types.ts'

/** Settings namespace owned by the notification plugin. */
export const NOTIFICATIONS_SETTINGS_NAMESPACE = 'notifications'

/** Built-in notification sounds. */
export const NOTIFICATION_SOUNDS = [
  'system', 'two-tone', 'ding', 'pop', 'spark', 'flame', 't', 'click', 'custom',
] as const

/** Plain preference shape shared by Host registration and Client settings decoding. */
export const NotificationSettingsSchema: s<Partial<NotificationSettings>, NotificationSettings> = s.object({
  enabled: s.boolean().default(false),
  agentCompletion: s.boolean().default(false),
  terminalBell: s.boolean().default(false),
  sound: s.union([...NOTIFICATION_SOUNDS]).default('system'),
  suppressWhenFocused: s.boolean().default(false),
  customSoundName: s.string().default(''),
  quietHoursEnabled: s.boolean().default(false),
  quietHoursStart: s.string().pattern(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).default('22:00'),
  quietHoursEnd: s.string().pattern(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).default('08:00'),
})

/**
 * Live-editable registration schema for this entry. The settings document
 * serves only a schema that carries a volatile field, so the Host entry
 * registers this wrapper; consumers keep reading plain values through
 * {@link NotificationSettingsSchema} and the served namespace.
 */
export const NotificationSettingsConfig = NotificationSettingsSchema.volatile()
