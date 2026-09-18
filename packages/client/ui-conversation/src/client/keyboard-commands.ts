/** Shortcut defaults owned by the real composer and completion handlers. */
import type { KeyboardService } from '@deepseek-ai/dsh-client-keyboard/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-keyboard/client' {
  interface KeyboardCommandMap {
    'conversation.submit': { scope: 'composer' }
    'conversation.submitAccelerated': { scope: 'composer' }
    'conversation.navigateUp': { scope: 'composer-popup' }
    'conversation.navigateDown': { scope: 'composer-popup' }
    'conversation.dismissPopup': { scope: 'composer-popup' }
    'conversation.complete': { scope: 'composer-popup' }
  }
}

/**
 * Register defaults beside the composer implementation.
 * @param keyboard - shared registry, read by the local Lexical handler.
 * @param t - owner-local translated labels and explanations.
 * @returns disposer for all composer commands.
 */
export function registerComposerCommands(keyboard: KeyboardService, t: Translate<ConversationKey>): () => void {
  const disposers = [
    keyboard.register({ id: 'conversation.submit', scope: 'composer', label: () => t('shortcut.submit'), description: () => t('shortcut.submitDescription'), defaultBindings: [{ key: 'Enter', modifiers: {} }] }),
    keyboard.register({ id: 'conversation.submitAccelerated', scope: 'composer', label: () => t('shortcut.accelerated'), description: () => t('shortcut.acceleratedDescription'),
      defaultBindings: [{ key: 'Enter', modifiers: { ctrl: true } }, { key: 'Enter', modifiers: { meta: true } }] }),
    keyboard.register({ id: 'conversation.navigateUp', scope: 'composer-popup', label: () => t('shortcut.up'), description: () => t('shortcut.popupDescription'), defaultBindings: [{ key: 'ArrowUp', modifiers: {} }], allowRepeat: true }),
    keyboard.register({ id: 'conversation.navigateDown', scope: 'composer-popup', label: () => t('shortcut.down'), description: () => t('shortcut.popupDescription'), defaultBindings: [{ key: 'ArrowDown', modifiers: {} }], allowRepeat: true }),
    keyboard.register({ id: 'conversation.dismissPopup', scope: 'composer-popup', label: () => t('shortcut.dismiss'), description: () => t('shortcut.popupDescription'), defaultBindings: [{ key: 'Escape', modifiers: {} }] }),
    keyboard.register({ id: 'conversation.complete', scope: 'composer-popup', label: () => t('shortcut.complete'), description: () => t('shortcut.popupDescription'), defaultBindings: [{ key: 'Tab', modifiers: {} }, { key: 'Enter', modifiers: {} }] }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
