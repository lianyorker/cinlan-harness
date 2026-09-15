/** Host entry for the Keybindings settings contributor. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { KEYBINDINGS_NAMESPACE, KeybindingsSettingsSchema } from './types.ts'

export {
  KEYBINDINGS_NAMESPACE, KeybindingsSettingsSchema,
  type KeyBinding, type KeybindingDefinition, type KeybindingOverride,
  type KeybindingsSettings,
  serializeBinding, parseKeyEvent, detectConflicts,
} from './types.ts'

/** Register durable settings namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(KEYBINDINGS_NAMESPACE, KeybindingsSettingsSchema)
  })
}
