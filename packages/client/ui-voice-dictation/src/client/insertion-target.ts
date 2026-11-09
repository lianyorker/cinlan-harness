/** Capture and restore browser text insertion targets across an asynchronous recording. */

/** A text control whose selection can be restored without focusing another element. */
export interface TextControlInsertionTarget {
  readonly kind: 'text-control'
  readonly element: HTMLInputElement | HTMLTextAreaElement
  readonly start: number
  readonly end: number
}

/** A contenteditable surface and the selection captured when recording started. */
export interface ContentEditableInsertionTarget {
  readonly kind: 'contenteditable'
  readonly element: HTMLElement
  readonly range: Range | undefined
}

/** A mounted xterm surface that accepts the local dictation insertion event. */
export interface TerminalInsertionTarget {
  readonly kind: 'terminal'
  readonly element: HTMLElement
}

/** Supported browser insertion destinations. */
export type InsertionTarget = TextControlInsertionTarget | ContentEditableInsertionTarget | TerminalInsertionTarget

function isTextInput(element: HTMLInputElement): boolean {
  return !['button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'image', 'month', 'radio', 'range', 'reset', 'submit', 'time', 'week'].includes(element.type)
}

function isEditableContentEditableValue(value: string | null): boolean {
  return value === '' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'plaintext-only'
}

function contentEditableAncestor(element: Element | null): HTMLElement | undefined {
  const explicit = element?.closest('[contenteditable]')
  if (explicit instanceof HTMLElement) return isEditableContentEditableValue(explicit.getAttribute('contenteditable')) ? explicit : undefined
  return element instanceof HTMLElement && element.isContentEditable ? element : undefined
}

/** Capture the active text surface before a microphone button changes focus.
 * @param active - active element override used by tests and embedded surfaces.
 * @returns the captured target, or undefined when focus is not editable.
 */
export function captureInsertionTarget(active: Element | null = document.activeElement): InsertionTarget | undefined {
  const terminal = active?.closest('[data-dsh-terminal-tab]')
  if (terminal instanceof HTMLElement) return { kind: 'terminal', element: terminal }

  if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && isTextInput(active))) {
    if (active.disabled || active.readOnly) return undefined
    return {
      kind: 'text-control',
      element: active,
      start: active.selectionStart ?? active.value.length,
      end: active.selectionEnd ?? active.value.length,
    }
  }

  const element = contentEditableAncestor(active)
  if (element === undefined) return undefined
  const selection = element.ownerDocument.getSelection()
  const range = selection !== null && selection.rangeCount > 0 && element.contains(selection.anchorNode)
    && element.contains(selection.focusNode) ? selection.getRangeAt(0).cloneRange() : undefined
  return { kind: 'contenteditable', element, range }
}

function insertIntoTerminal(target: TerminalInsertionTarget, text: string): boolean {
  if (!target.element.isConnected) return false
  let accepted = false
  target.element.dispatchEvent(new CustomEvent('dsh:voice-insert-text', {
    detail: { text, accept: () => { accepted = true } },
  }))
  return accepted
}

function dispatchInput(element: Element, text: string): void {
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
}

function insertIntoTextControl(target: TextControlInsertionTarget, text: string): boolean {
  const { element } = target
  if (!element.isConnected || element.disabled || element.readOnly) return false
  const start = Math.max(0, Math.min(target.start, element.value.length))
  const end = Math.max(start, Math.min(target.end, element.value.length))
  element.value = element.value.slice(0, start) + text + element.value.slice(end)
  const caret = start + text.length
  element.focus({ preventScroll: true })
  element.setSelectionRange(caret, caret)
  dispatchInput(element, text)
  return true
}

function insertIntoContentEditable(target: ContentEditableInsertionTarget, text: string): boolean {
  const { element } = target
  if (!element.isConnected || !(element.isContentEditable || isEditableContentEditableValue(element.getAttribute('contenteditable')))) return false
  const document = element.ownerDocument
  const selection = document.getSelection()
  if (selection === null) return false
  const range = target.range?.cloneRange() ?? document.createRange()
  if (target.range === undefined) {
    range.selectNodeContents(element)
    range.collapse(false)
  }
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return false
  selection.removeAllRanges()
  selection.addRange(range)
  element.focus({ preventScroll: true })
  const execCommand = document.execCommand
  if (typeof execCommand === 'function' && execCommand.call(document, 'insertText', false, text)) {
    return true
  }
  range.deleteContents()
  range.insertNode(document.createTextNode(text))
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  dispatchInput(element, text)
  return true
}

/** Insert transcript text into the target captured before recording.
 * @param target - target captured before the microphone request.
 * @param text - final transcript text.
 * @returns whether the target accepted the insertion.
 */
export function insertIntoTarget(target: InsertionTarget, text: string): boolean {
  if (text === '') return true
  if (target.kind === 'text-control') return insertIntoTextControl(target, text)
  if (target.kind === 'contenteditable') return insertIntoContentEditable(target, text)
  return insertIntoTerminal(target, text)
}

/** Whether the target belongs to DSH's managed composer and must use its draft store.
 * @param target - captured insertion target.
 * @returns true when the target is managed by the conversation composer.
 */
export function isComposerTarget(target: InsertionTarget): boolean {
  return target.element.closest('[data-composer-input]') !== null
}
