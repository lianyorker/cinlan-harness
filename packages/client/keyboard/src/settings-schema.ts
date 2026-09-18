/** Host schema for the existing keybindings preference namespace. */
import s from '@deepseek-ai/schemastery'
import type { KeybindingsSettings } from './types.ts'

/** Durable namespace shared by command consumers and the settings page. */
export const KEYBINDINGS_NAMESPACE = 'keybindings'

/** Preserve legacy ids and modifier flags; mod adds portable platform defaults. */
export const KeybindingsSettingsSchema: s<KeybindingsSettings> = s.object({
  overrides: s.array(s.object({
    commandId: s.string(),
    binding: s.union([
      s.object({
        key: s.string(),
        modifiers: s.object({
          ctrl: s.boolean().default(false), shift: s.boolean().default(false),
          alt: s.boolean().default(false), meta: s.boolean().default(false), mod: s.boolean().default(false),
        }),
      }),
      s.const(null),
    ]),
  })).default([]),
})
