/** Host entry for the browser-only Security Research settings contributor. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { MOBILE_DEVICE_NAMESPACE, MobileDeviceSettingsSchema } from './types.ts'

export { MOBILE_DEVICE_NAMESPACE, MobileDeviceSettingsSchema, type MobileDeviceSettings } from './types.ts'

/** Register durable settings namespaces when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(MOBILE_DEVICE_NAMESPACE, MobileDeviceSettingsSchema)
  })
}
