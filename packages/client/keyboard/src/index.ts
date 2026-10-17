/** Host half: publishes the live-editable keybindings settings schema. */
import { KeybindingsSettingsSchema } from './settings-schema.ts'

export type { KeyBinding, KeybindingOverride, KeybindingsSettings } from './types.ts'

/**
 * The entry's live-editable preferences. The settings document serves a schema
 * only when it carries a volatile field, and the Loader entry id `keybindings`
 * is the namespace the Client half binds through `settingsScope`.
 */
export const Config = KeybindingsSettingsSchema.volatile()

/** Register the browser package without adding Host behavior. */
export function apply(): void {}
