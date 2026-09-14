/** Host registration for browser notification preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { NOTIFICATIONS_SETTINGS_NAMESPACE, NotificationSettingsSchema } from './types.ts'

export {
  NOTIFICATIONS_SETTINGS_NAMESPACE,
  NOTIFICATION_SOUNDS,
  NotificationSettingsSchema,
  type NotificationSettings,
  type NotificationSound,
} from './types.ts'

/** Cordis function-plugin name. */
export const name = 'notifications'

/** Register the durable notification namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(NOTIFICATIONS_SETTINGS_NAMESPACE, NotificationSettingsSchema)
  })
}
