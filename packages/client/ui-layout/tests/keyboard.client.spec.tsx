// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { KeyboardController } from '@deepseek-ai/dsh-client-keyboard/src/client/controller.ts'
import type { KeybindingsSettings } from '@deepseek-ai/dsh-client-keyboard/client'
import { handleSidebarShortcut } from '../src/client/keyboard-commands.ts'

afterEach(cleanup)

describe('shell shortcut focus ownership', () => {
  it('uses live overrides while excluding inputs, dialogs, prevented events, and body portals', () => {
    const settings = stubSettingsScope<KeybindingsSettings>()
    settings.publish({ status: 'ready', writable: true, value: { overrides: [] } })
    const keyboard = new KeyboardController(settings.scope, false)
    const release = keyboard.register({ id: 'shell.toggleSidebar', scope: 'shell', label: () => 'Sidebar', description: () => '',
      defaultBindings: [{ key: 'b', modifiers: { mod: true } }] })
    const toggle = vi.fn()
    const matches = (facts: Parameters<typeof keyboard.matches>[1]) => keyboard.matches('shell.toggleSidebar', facts)
    const view = render(<div data-testid="frame" onKeyDown={(event) => { handleSidebarShortcut(event, matches, toggle) }}>
      <button>Shell</button><input aria-label="Text" /><div role="dialog"><button>Dialog</button></div>
      <button onKeyDown={(event) => { event.preventDefault() }}>Handled</button>
      {createPortal(<section role="region" aria-label="Settings"><button>Portaled settings</button></section>, document.body)}
    </div>)
    try {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Shell' }), { key: 'b', ctrlKey: true })
      expect(toggle).toHaveBeenCalledOnce()
      for (const node of [screen.getByRole('textbox'), screen.getByRole('button', { name: 'Dialog' }),
        screen.getByRole('button', { name: 'Handled' }), screen.getByRole('button', { name: 'Portaled settings' })]) {
        fireEvent.keyDown(node, { key: 'b', ctrlKey: true })
      }
      expect(toggle).toHaveBeenCalledOnce()
      act(() => { settings.publish({ value: { overrides: [{ commandId: 'shell.toggleSidebar', binding: { key: 'e', modifiers: { alt: true } } }] } }) })
      fireEvent.keyDown(screen.getByRole('button', { name: 'Shell' }), { key: 'b', ctrlKey: true })
      expect(toggle).toHaveBeenCalledOnce()
      fireEvent.keyDown(screen.getByRole('button', { name: 'Shell' }), { key: 'e', altKey: true })
      expect(toggle).toHaveBeenCalledTimes(2)
      screen.getByTestId('frame').setAttribute('inert', '')
      fireEvent.keyDown(screen.getByRole('button', { name: 'Shell' }), { key: 'e', altKey: true })
      expect(toggle).toHaveBeenCalledTimes(2)
    } finally { view.unmount(); release(); keyboard.dispose() }
  })
})
