/** Host ownership of durable keyboard command overrides. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { KEYBINDINGS_NAMESPACE, KeybindingsSettingsSchema } from './settings-schema.ts'

export type { KeyBinding, KeybindingOverride, KeybindingsSettings } from './types.ts'

/**
 * Register the existing namespace while a settings provider is available.
 * @param ctx - Host plugin context owning the schema registration.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(KEYBINDINGS_NAMESPACE, KeybindingsSettingsSchema)
  })
}
