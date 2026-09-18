// @vitest-environment jsdom
/** Real CodeMirror handlers use current registered preferences without replacing native history. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { KeyboardController } from '@deepseek-ai/dsh-client-keyboard/src/client/controller.ts'
import type { KeybindingsSettings } from '@deepseek-ai/dsh-client-keyboard/client'
import type { Context } from '../src/context-types.ts'
import { api } from '../src/client/api.ts'
import { TextEditor } from '../src/client/TextEditor.tsx'
import { registerEditorCommands } from '../src/client/keyboard-commands.ts'
import { createSidebarStore } from '../src/client/state.ts'

beforeEach(() => {
  // Geometry is outside these dispatch assertions; keep CodeMirror's scheduled measurement idle.
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('focused CodeMirror shortcuts', () => {
  it('saves current edits through the effective shortcut and leaves native undo available', async () => {
    const settings = stubSettingsScope<KeybindingsSettings>()
    settings.publish({ status: 'ready', writable: true, value: { overrides: [] } })
    const keyboard = new KeyboardController(settings.scope, false)
    const release = registerEditorCommands(keyboard, key => key)
    const save = vi.spyOn(api, 'fsWrite').mockResolvedValue({ ok: true })
    const props = { ctx: {} as Context, scope: { sessionId: 'keyboard-file' }, path: '/test.txt', title: 'test.txt',
      viewerId: 'code', content: 'alpha', store: createSidebarStore(),
      matchShortcut: keyboard.matches.bind(keyboard) }
    const mounted = render(<TextEditor {...props} />)
    const dom = mounted.container.querySelector<HTMLElement>('.cm-content')!
    const view = EditorView.findFromDOM(dom)!
    try {
      act(() => { view.dispatch({ changes: { from: 0, to: 5, insert: 'beta' } }) })
      fireEvent.keyDown(dom, { key: 's', ctrlKey: true })
      await waitFor(() => { expect(save).toHaveBeenCalledWith(props.scope, '/test.txt', 'beta') })
      await act(async () => {})
      fireEvent.keyDown(dom, { key: 'z', ctrlKey: true })
      expect(view.state.doc.toString()).toBe('alpha')
      act(() => { settings.publish({ value: { overrides: [{ commandId: 'editor.save', binding: { key: 'k', modifiers: { alt: true } } }] } }) })
      fireEvent.keyDown(dom, { key: 's', ctrlKey: true })
      expect(save).toHaveBeenCalledOnce()
      fireEvent.keyDown(dom, { key: 'k', altKey: true, isComposing: true })
      fireEvent.keyDown(dom, { key: 'k', altKey: true, keyCode: 229 })
      fireEvent.keyDown(dom, { key: 'k', altKey: true, repeat: true })
      expect(save).toHaveBeenCalledOnce()
      fireEvent.keyDown(dom, { key: 'k', altKey: true })
      await waitFor(() => { expect(save).toHaveBeenLastCalledWith(props.scope, '/test.txt', 'alpha') })
      await act(async () => {})
      act(() => { settings.publish({ value: { overrides: [{ commandId: 'editor.save', binding: null }] } }) })
      fireEvent.keyDown(dom, { key: 'k', altKey: true })
      expect(save).toHaveBeenCalledTimes(2)
    } finally { mounted.unmount(); release(); keyboard.dispose() }
    fireEvent.keyDown(dom, { key: 's', ctrlKey: true })
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('opens the maintained search panel and focuses the real replacement control after live remapping', () => {
    const settings = stubSettingsScope<KeybindingsSettings>()
    settings.publish({ status: 'ready', writable: true, value: { overrides: [] } })
    const keyboard = new KeyboardController(settings.scope, false)
    const release = registerEditorCommands(keyboard, key => key)
    const mounted = render(<TextEditor ctx={{} as Context} scope={{ sessionId: 'keyboard-find' }} path="/test.txt" title="test.txt"
      viewerId="code" content="alpha alpha" store={createSidebarStore()} matchShortcut={keyboard.matches.bind(keyboard)} />)
    const dom = mounted.container.querySelector<HTMLElement>('.cm-content')!
    try {
      fireEvent.keyDown(dom, { key: 'f', ctrlKey: true })
      expect(mounted.container.querySelector('.cm-search input[name="search"]')).toBe(document.activeElement)
      act(() => { settings.publish({ value: { overrides: [{ commandId: 'editor.replace', binding: { key: 'e', modifiers: { alt: true } } }] } }) })
      fireEvent.keyDown(dom, { key: 'e', altKey: true })
      expect(mounted.container.querySelector('.cm-search input[name="replace"]')).toBe(document.activeElement)
    } finally { mounted.unmount(); release(); keyboard.dispose() }
  })
})
