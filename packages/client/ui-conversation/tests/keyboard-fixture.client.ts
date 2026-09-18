/** Real shortcut owner used by composer-only component fixtures. */
import { onTestFinished } from 'vitest'
import { bindSnapshotSelector, makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { KeyboardController } from '@deepseek-ai/dsh-client-keyboard/src/client/controller.ts'
import type { KeybindingsSettings } from '@deepseek-ai/dsh-client-keyboard/client'
import type { MatchComposerShortcut } from '../src/client/contract/input.ts'
import { registerComposerCommands } from '../src/client/keyboard-commands.ts'
import { en } from '../src/client/locales.ts'

/**
 * Mount the actual registry with optional composer defaults.
 * @param register - false when the plugin under test owns command registration.
 * @returns commands, a driven settings source, and renderer-bound props.
 */
export function createKeyboardFixture(register = true) {
  const settings = stubSettingsScope<KeybindingsSettings>()
  settings.publish({ status: 'ready', writable: true, revision: 1, value: { overrides: [] } })
  const keyboard = new KeyboardController(settings.scope, false)
  const release = register ? registerComposerCommands(keyboard, makeTranslate(en)) : () => {}
  onTestFinished(() => { release(); keyboard.dispose() })
  const matches: MatchComposerShortcut = (id, facts) => keyboard.matches(id, facts)
  return { keyboard, settings, matches, props: { matchShortcut: matches, useShortcuts: bindSnapshotSelector(keyboard) } }
}
