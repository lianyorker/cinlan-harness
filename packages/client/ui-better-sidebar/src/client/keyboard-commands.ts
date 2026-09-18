/** Real CodeMirror file actions and their default shortcuts. */
import type { KeyEventFacts, KeyboardService } from '@deepseek-ai/dsh-client-keyboard/client'
import type { CopyKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-keyboard/client' {
  interface KeyboardCommandMap {
    'editor.save': { scope: 'editor' }
    'editor.find': { scope: 'editor' }
    'editor.replace': { scope: 'editor' }
  }
}

/** Commands dispatched only inside the focused file editor. */
export type EditorCommandId = 'editor.save' | 'editor.find' | 'editor.replace'

/**
 * Match editor commands through the lazy viewer's plain callback props.
 * @param id - command owned by the file editor.
 * @param facts - local key event values.
 * @returns whether the command can handle the event.
 */
export type MatchEditorShortcut = (id: EditorCommandId, facts: KeyEventFacts) => boolean

/**
 * Translate the maintained search panel's phrase keys through this owner.
 * @param t - owner-local search labels and announcements.
 * @returns CodeMirror phrase substitutions.
 */
export function editorSearchPhrases(t: (key: CopyKey) => string): Record<string, string> {
  return {
    'Find': t('shortcutSearchFind'),
    'Replace': t('shortcutSearchReplace'),
    'next': t('shortcutSearchNext'),
    'previous': t('shortcutSearchPrevious'),
    'all': t('shortcutSearchAll'),
    'match case': t('shortcutSearchCase'),
    'regexp': t('shortcutSearchRegexp'),
    'by word': t('shortcutSearchWord'),
    'replace': t('shortcutSearchReplaceOne'),
    'replace all': t('shortcutSearchReplaceAll'),
    'close': t('shortcutSearchClose'),
    'current match': t('shortcutSearchCurrent'),
    'on line': t('shortcutSearchLine'),
    'replaced match on line $': t('shortcutSearchReplacedOne'),
    'replaced $ matches': t('shortcutSearchReplacedAll'),
  }
}

/**
 * Register editor actions while the sidebar owner is mounted.
 * @param keyboard - shared effective-binding service.
 * @param t - owner-local translated labels.
 * @returns the disposer for these command registrations.
 */
export function registerEditorCommands(keyboard: KeyboardService, t: (key: CopyKey) => string): () => void {
  const disposers = [
    keyboard.register({ id: 'editor.save', scope: 'editor', label: () => t('shortcutSave'), description: () => t('shortcutSaveDescription'), defaultBindings: [{ key: 's', modifiers: { mod: true } }] }),
    keyboard.register({ id: 'editor.find', scope: 'editor', label: () => t('shortcutFind'), description: () => t('shortcutFindDescription'), defaultBindings: [{ key: 'f', modifiers: { mod: true } }] }),
    keyboard.register({ id: 'editor.replace', scope: 'editor', label: () => t('shortcutReplace'), description: () => t('shortcutReplaceDescription'), defaultBindings: [{ key: 'f', modifiers: { mod: true, alt: true } }] }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
