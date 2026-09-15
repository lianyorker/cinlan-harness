/** Core keybindings types: binding, definition, override, and settings. */

import s from '@deepseek-ai/schemastery'

/** Settings namespace owned by the keybindings settings. */
export const KEYBINDINGS_NAMESPACE = 'keybindings'

/** A keyboard binding: a key plus optional modifier flags. */
export interface KeyBinding {
  key: string
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
}

/** A registered keybinding command. */
export interface KeybindingDefinition {
  id: string
  label: string
  category: string
  defaultBinding: KeyBinding | null
  description?: string
}

/** A user override for a command's binding. */
export interface KeybindingOverride {
  commandId: string
  binding: KeyBinding | null
}

/** User-controlled keybindings settings. */
export interface KeybindingsSettings {
  overrides: KeybindingOverride[]
}

/** Schema for the keybindings settings namespace. */
export const KeybindingsSettingsSchema: s<KeybindingsSettings> = s.object({
  overrides: s.array(s.object({
    commandId: s.string(),
    binding: s.union([
      s.object({
        key: s.string(),
        modifiers: s.object({
          ctrl: s.boolean().default(false),
          shift: s.boolean().default(false),
          alt: s.boolean().default(false),
          meta: s.boolean().default(false),
        }),
      }),
      s.const(null),
    ]),
  })).default([]),
})

/** Serialize a KeyBinding to a display string (e.g. "Ctrl+Shift+Enter"). */
export function serializeBinding(binding: KeyBinding): string {
  const parts: string[] = []
  if (binding.modifiers.ctrl) parts.push('Ctrl')
  if (binding.modifiers.shift) parts.push('Shift')
  if (binding.modifiers.alt) parts.push('Alt')
  if (binding.modifiers.meta) parts.push('Meta')
  parts.push(binding.key)
  return parts.join('+')
}

/** Parse a KeyboardEvent into a KeyBinding. */
export function parseKeyEvent(event: KeyboardEvent): KeyBinding {
  return {
    key: event.key,
    modifiers: {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    },
  }
}

/** Detect conflicts: returns a map of serialized binding -> command IDs that share it. */
export function detectConflicts(overrides: KeybindingOverride[]): Map<string, string[]> {
  const bindingToCommands = new Map<string, string[]>()
  for (const override of overrides) {
    if (override.binding === null) continue
    const key = serializeBinding(override.binding)
    const commands = bindingToCommands.get(key) ?? []
    commands.push(override.commandId)
    bindingToCommands.set(key, commands)
  }
  const conflicts = new Map<string, string[]>()
  for (const [key, commands] of bindingToCommands) {
    if (commands.length > 1) conflicts.set(key, commands)
  }
  return conflicts
}
