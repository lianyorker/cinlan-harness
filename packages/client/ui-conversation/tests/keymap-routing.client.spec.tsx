// @vitest-environment jsdom
/** Real Lexical DOM routing with effective shortcut changes and composition ownership. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { createEditor } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { registerComposerKeymap, type ComposerKeymapHandlers } from '../src/client/input/editor/keymap.ts'
import { createKeyboardFixture } from './keyboard-fixture.client.ts'

function bench(patch: Partial<ComposerKeymapHandlers> = {}) {
  const shortcuts = createKeyboardFixture()
  const editor = createEditor({ namespace: 'keymap-routing', onError: (error) => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.appendChild(root)
  editor.setRootElement(root)
  const plain = registerPlainText(editor)
  const submit = vi.fn()
  const remove = registerComposerKeymap(editor, { matches: shortcuts.matches, arbitrate: () => 'pass', space: () => false,
    dismissPopup: () => false, canSubmit: () => true, submit, intakeFiles: () => {}, pasteText: () => {}, ...patch })
  onTestFinished(() => { remove(); plain(); editor.setRootElement(null); root.remove() })
  return { ...shortcuts, root, submit, remove }
}

describe('keymap keydown routing', () => {
  it('routes default Enter, Ctrl+Enter, and Meta+Enter while live overrides disable the old gesture', () => {
    const { root, submit, settings } = bench()
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenLastCalledWith(false)
    fireEvent.keyDown(root, { key: 'Enter', metaKey: true })
    expect(submit).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(root, { key: 'Enter', ctrlKey: true })
    expect(submit).toHaveBeenCalledTimes(3)
    settings.publish({ value: { overrides: [{ commandId: 'conversation.submit', binding: { key: 'p', modifiers: { alt: true } } }] } })
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenCalledTimes(3)
    fireEvent.keyDown(root, { key: 'p', altKey: true })
    expect(submit).toHaveBeenLastCalledWith(false)
    expect(submit).toHaveBeenCalledTimes(4)
    settings.publish({ value: { overrides: [{ commandId: 'conversation.submit', binding: null }] } })
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenCalledTimes(4)
  })

  it('arbitrates Tab and remapped completion before submitting or native traversal', () => {
    const arbitrate = vi.fn<ComposerKeymapHandlers['arbitrate']>()
      .mockReturnValueOnce('consumed').mockReturnValueOnce('pick-highlighted').mockReturnValue('pass')
    const { root, settings } = bench({ arbitrate })
    expect(fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })).toBe(false)
    expect(arbitrate).toHaveBeenCalledWith('tab', false)
    expect(fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })).toBe(false)
    expect(fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })).toBe(true)
    settings.publish({ value: { overrides: [{ commandId: 'conversation.complete', binding: { key: 'c', modifiers: { alt: true } } }] } })
    arbitrate.mockReturnValue('pick-highlighted')
    expect(fireEvent.keyDown(root, { key: 'c', altKey: true })).toBe(false)
    expect(arbitrate).toHaveBeenLastCalledWith('tab', false)
  })

  it('consumes a remapped printable dismissal while an actual popup is open', () => {
    let open = true
    const { root, settings, submit } = bench({ dismissPopup: () => { const wasOpen = open; open = false; return wasOpen } })
    settings.publish({ value: { overrides: [{ commandId: 'conversation.dismissPopup', binding: { key: 'x', modifiers: {} } }] } })
    expect(fireEvent.keyDown(root, { key: 'x' })).toBe(false)
    expect(root.textContent).not.toContain('x')
    expect(open).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(root, { key: 'x' })).toBe(true)
  })

  it('keeps popup priority ahead of a remapped submit and keeps composition/repeat from sending', () => {
    const arbitrate = vi.fn<ComposerKeymapHandlers['arbitrate']>().mockReturnValue('pick-highlighted')
    const { root, submit, settings, remove } = bench({ arbitrate })
    settings.publish({ value: { overrides: [{ commandId: 'conversation.submit', binding: { key: 'p', modifiers: { alt: true } } }] } })
    fireEvent.keyDown(root, { key: 'p', altKey: true })
    expect(submit).not.toHaveBeenCalled()
    expect(arbitrate).toHaveBeenCalledWith('enter', false)
    arbitrate.mockReturnValue('pass')
    for (const patch of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      fireEvent.keyDown(root, { key: 'p', altKey: true, ...patch })
    }
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(root, { key: 'p', altKey: true })
    expect(submit).toHaveBeenCalledOnce()
    remove()
    fireEvent.keyDown(root, { key: 'p', altKey: true })
    expect(submit).toHaveBeenCalledOnce()
  })
})
