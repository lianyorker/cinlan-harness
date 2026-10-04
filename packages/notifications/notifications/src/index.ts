/** Host registration for browser notification preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { NotificationSettingsConfig } from './settings.ts'

export {
  NOTIFICATIONS_SETTINGS_NAMESPACE,
  NOTIFICATION_SOUNDS,
  NotificationSettingsConfig,
  NotificationSettingsSchema,
} from './settings.ts'
export type { NotificationSettings, NotificationSound } from './types.ts'

/** Cordis function-plugin name. */
export const name = 'notifications'

/** Entry schema the settings document serves; its live-editable wrapper carries the volatile marker. */
export const Config = NotificationSettingsConfig

/** Register the durable notification namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.configure({ auto: true })
  })
}
