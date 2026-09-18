/** Local Lexical shortcut dispatch; native newline, paste, and IME ownership stay with the editor. */
import type { LexicalEditor } from 'lexical'
import { COMMAND_PRIORITY_CRITICAL, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND, KEY_SPACE_COMMAND, PASTE_COMMAND } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import type { ArbitrateKey, ArbitrateOutcome } from '../../contract/input.ts'
import type { MatchComposerShortcut } from '../../contract/input.ts'

/** The bar-supplied behavior behind each intercepted gesture. */
export interface ComposerKeymapHandlers {
  matches: MatchComposerShortcut
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  space(): boolean
  dismissPopup(): boolean
  canSubmit(): boolean
  submit(accelerated: boolean): void
  intakeFiles(files: readonly File[]): void
  pasteText(text: string): void
}

/**
 * Register one focused editor's handlers without listening on the document.
 * @param editor - shell-owned Lexical editor.
 * @param handlers - live matcher and action callbacks.
 * @returns disposer for commands and composition listeners.
 */
export function registerComposerKeymap(editor: LexicalEditor, handlers: ComposerKeymapHandlers): () => void {
  let composing = false
  let composingUntil = 0
  const onCompositionStart = (): void => { composing = true }
  const onCompositionEnd = (): void => { composing = false; composingUntil = Date.now() + 10 }
  const isComposing = (event: KeyboardEvent): boolean => {
    // Safari can close composition before its final keydown; 229 is the legacy IME sentinel.
    // oxlint-disable-next-line typescript/no-deprecated
    return event.isComposing || event.keyCode === 229 || composing || Date.now() < composingUntil
  }

  return mergeRegister(
    editor.registerRootListener((root, previous) => {
      previous?.removeEventListener('compositionstart', onCompositionStart)
      previous?.removeEventListener('compositionend', onCompositionEnd)
      root?.addEventListener('compositionstart', onCompositionStart)
      root?.addEventListener('compositionend', onCompositionEnd)
    }),
    editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
      if (event.defaultPrevented) return false
      if (isComposing(event)) return event.key === 'Enter' && !event.shiftKey
      if (event.key === 'Enter' && event.shiftKey) return false
      const facts = {
        key: event.key, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
        isComposing: false, repeat: event.repeat, defaultPrevented: event.defaultPrevented,
        altGraph: event.getModifierState('AltGraph'),
      }
      for (const [id, key] of [['conversation.navigateUp', 'up'], ['conversation.navigateDown', 'down']] as const) {
        if (handlers.matches(id, facts) && handlers.arbitrate(key, false) !== 'pass') { event.preventDefault(); return true }
      }
      if (handlers.matches('conversation.dismissPopup', facts)) {
        const dismissed = handlers.dismissPopup()
        if (dismissed || handlers.arbitrate('escape', false) === 'consumed') { event.preventDefault(); return true }
      }
      let enterArbitrated = false
      if (handlers.matches('conversation.complete', facts)) {
        const key = event.key === 'Enter' ? 'enter' : 'tab'
        enterArbitrated = key === 'enter'
        if (handlers.arbitrate(key, false) !== 'pass') { event.preventDefault(); return true }
      }
      // A held submit shortcut is consumed without inserting text or sending again.
      const submitFacts = { ...facts, repeat: false }
      const accelerated = handlers.matches('conversation.submitAccelerated', submitFacts)
      if (!accelerated && !handlers.matches('conversation.submit', submitFacts)) return false
      if (!enterArbitrated && handlers.arbitrate('enter', false) !== 'pass') { event.preventDefault(); return true }
      event.preventDefault()
      if (!event.repeat && handlers.canSubmit()) handlers.submit(accelerated)
      return true
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      // Intrinsic Shift+Enter stays with Lexical, including composition-closing keydowns.
      if (event?.shiftKey === true) return false
      return event !== null && isComposing(event)
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_SPACE_COMMAND, (event) => {
      if (event.defaultPrevented || event.getModifierState('AltGraph') || isComposing(event)) return false
      const consumed = handlers.space()
      if (consumed) event.preventDefault()
      return consumed
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(PASTE_COMMAND, (event) => {
      const clipboardData = (event as ClipboardEvent).clipboardData ?? null
      if (clipboardData === null) return false
      const files = Array.from(clipboardData.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null)
      if (files.length > 0) handlers.intakeFiles(files)
      const text = clipboardData.getData('text/plain')
      if (text === '') {
        if (files.length === 0) return false
        event.preventDefault()
        return true
      }
      event.preventDefault()
      handlers.pasteText(text)
      return true
    }, COMMAND_PRIORITY_CRITICAL),
  )
}
