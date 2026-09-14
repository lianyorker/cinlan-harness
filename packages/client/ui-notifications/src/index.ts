/** Host loader entry for the browser notification implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { NOTIFICATIONS_SETTINGS_NAMESPACE, NotificationSettingsSchema } from '@deepseek-ai/dsh-notifications/types'

export {
  NOTIFICATIONS_SETTINGS_NAMESPACE,
  NOTIFICATION_SOUNDS,
  NotificationSettingsSchema,
  type NotificationSettings,
  type NotificationSound,
} from '@deepseek-ai/dsh-notifications/types'

/** Register the durable notification namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(NOTIFICATIONS_SETTINGS_NAMESPACE, NotificationSettingsSchema)
  })
}
