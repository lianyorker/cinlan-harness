// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { KeyboardController } from '@deepseek-ai/dsh-client-keyboard/src/client/controller.ts'
import type { KeybindingsSettings } from '@deepseek-ai/dsh-client-keyboard/client'
import { KeybindingsSection, type KeybindingsSectionProps } from '../src/client/KeybindingsSection.tsx'
import { en } from '../src/client/locales.ts'

declare module '@deepseek-ai/dsh-client-keyboard/client' {
  interface KeyboardCommandMap {
    'settings-test.save': { scope: 'editor' }
    'settings-test.find': { scope: 'editor' }
  }
}

afterEach(cleanup)

function bench(overrides: KeybindingsSettings['overrides'] = []) {
  const source = stubSettingsScope<KeybindingsSettings>()
  const settings = { ...source, set: vi.spyOn(source.scope, 'set'), unset: vi.spyOn(source.scope, 'unset') }
  settings.publish({ status: 'ready', writable: true, revision: 1, base: { overrides: [] },
    user: overrides.length > 0 ? { overrides } : undefined, value: { overrides } })
  settings.set.mockImplementation(async (field, value) => {
    expect(field).toBe('overrides')
    const accepted = { overrides }
    Reflect.set(accepted, field, value)
    settings.publish({ user: { [field]: value }, value: accepted, revision: settings.scope.getSnapshot().revision! + 1 })
  })
  settings.unset.mockImplementation(async () => {
    settings.publish({ user: undefined, value: { overrides: [] }, revision: settings.scope.getSnapshot().revision! + 1 })
  })
  const keyboard = new KeyboardController(settings.scope, false)
  keyboard.register({ id: 'settings-test.save', scope: 'editor', label: () => 'Save file', description: () => 'Write the focused file.',
    defaultBindings: [{ key: 's', modifiers: { mod: true } }] })
  keyboard.register({ id: 'settings-test.find', scope: 'editor', label: () => 'Find text', description: () => 'Search the focused file.',
    defaultBindings: [{ key: 'f', modifiers: { mod: true } }] })
  onTestFinished(() => { keyboard.dispose() })
  const setBinding = vi.fn(keyboard.setBinding.bind(keyboard))
  const resetBinding = vi.fn(keyboard.resetBinding.bind(keyboard))
  const resetAll = vi.fn(keyboard.resetAll.bind(keyboard))
  const props = { close: vi.fn(), t: makeTranslate(en), useKeyboard: bindSnapshotSelector(keyboard),
    captureKey: keyboard.capture.bind(keyboard), setBinding, resetBinding, resetAll,
  } as KeybindingsSectionProps
  return { keyboard, settings, setBinding, resetBinding, resetAll, props }
}

describe('registered shortcut settings', () => {
  it('displays effective bindings and preserves unavailable legacy records without inventing commands', () => {
    const b = bench([{ commandId: 'conversation.newLine', binding: { key: 'Enter', modifiers: { shift: true } } }])
    const { container } = render(<KeybindingsSection {...b.props} />)
    expect(screen.getByRole('heading', { name: en.title, level: 1 })).toBeTruthy()
    expect(screen.getByText('Ctrl + S')).toBeTruthy()
    expect(screen.getByText('conversation.newLine')).toBeTruthy()
    expect(screen.getByText(en.unavailableCommand)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Record: conversation.newLine' }).disabled).toBe(true)
    expect(screen.queryByText('conversation.submit')).toBeNull()
    expect(container.querySelector('[data-settings-anchor="keybinding-settings-test.save"]')).toBeTruthy()
    act(() => { b.settings.publish({ value: { overrides: [{ commandId: 'settings-test.save', binding: { key: 'k', modifiers: { alt: true } } }] } }) })
    expect(screen.getByText('Alt + K')).toBeTruthy()
    expect(screen.queryByText('Ctrl + S')).toBeNull()
  })

  it.each([['loading', true, en.loading], ['unavailable', false, en.error], ['ready', false, en.readOnly]] as const)(
    'reports %s and disables mutation while its settings source is unavailable', (status, writable, message) => {
      const b = bench()
      b.settings.publish({ status, writable })
      render(<KeybindingsSection {...b.props} />)
      expect(screen.getByRole('status').textContent).toBe(message)
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Record: Save file' }).disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Unbind: Save file' }))
      expect(b.setBinding).not.toHaveBeenCalled()
    },
  )

  it('captures only local valid events, preserves composition and browser reservations, and supports Escape cancel', async () => {
    const b = bench()
    render(<KeybindingsSection {...b.props} />)
    const record = screen.getByRole('button', { name: 'Record: Save file' })
    fireEvent.click(record)
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(record, { key: 'k', ctrlKey: true, isComposing: true })
    fireEvent.keyDown(record, { key: 'k', ctrlKey: true, keyCode: 229 })
    fireEvent.keyDown(record, { key: 'Control', ctrlKey: true })
    expect(b.setBinding).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(record, { key: 'r', ctrlKey: true })).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain(en.reserved)
    expect(fireEvent.keyDown(record, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('button', { name: en.cancel })).toBeNull()
    fireEvent.click(record)
    expect(fireEvent.keyDown(record, { key: 'k', ctrlKey: true })).toBe(false)
    await waitFor(() => { expect(screen.getByText('Ctrl + K')).toBeTruthy() })
    expect(b.setBinding.mock.calls[0]?.[0]).toBe('settings-test.save')
    expect(b.setBinding.mock.calls[0]?.[1]).toMatchObject({ key: 'k', modifiers: { mod: true } })
  })

  it('unbinds the actual action and resets the final raw override with unset', async () => {
    const b = bench()
    render(<KeybindingsSection {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unbind: Save file' }))
    await waitFor(() => { expect(screen.getByText(en.unbound)).toBeTruthy() })
    expect(b.setBinding).toHaveBeenCalledWith('settings-test.save', null)
    fireEvent.click(screen.getByRole('button', { name: 'Reset: Save file' }))
    await waitFor(() => { expect(screen.getByText('Ctrl + S')).toBeTruthy() })
    expect(b.resetBinding).toHaveBeenCalledWith('settings-test.save')
    expect(b.settings.unset).toHaveBeenCalledWith('overrides')
  })

  it('keeps the effective binding after failure and retries the same recorded choice explicitly', async () => {
    const b = bench()
    b.setBinding.mockResolvedValueOnce({ ok: false, reason: 'failed' })
    render(<KeybindingsSection {...b.props} />)
    const record = screen.getByRole('button', { name: 'Record: Save file' })
    fireEvent.click(record)
    fireEvent.keyDown(record, { key: 'k', altKey: true })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.saveFailed) })
    expect(screen.getByText('Ctrl + S')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.getByText('Alt + K')).toBeTruthy() })
    expect(b.setBinding.mock.calls[1]).toEqual(b.setBinding.mock.calls[0])
  })

  it('reports collisions with unchanged defaults and allows resetting all raw overrides', async () => {
    const b = bench([{ commandId: 'legacy.unbound', binding: null }])
    render(<KeybindingsSection {...b.props} />)
    const record = screen.getByRole('button', { name: 'Record: Save file' })
    fireEvent.click(record)
    fireEvent.keyDown(record, { key: 'f', ctrlKey: true })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.conflictDescription) })
    expect(screen.getByText('Ctrl + S')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.resetAll }))
    await waitFor(() => { expect(screen.queryByText('legacy.unbound')).toBeNull() })
    expect(b.resetAll).toHaveBeenCalledOnce()
    expect(b.settings.unset).toHaveBeenCalledWith('overrides')
  })

  it('clears a local search when navigation requests a control anchor', () => {
    const b = bench()
    const view = render(<KeybindingsSection {...b.props} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
    expect(screen.getByText(en.noResults)).toBeTruthy()
    view.rerender(<KeybindingsSection {...b.props} target={{ itemId: 'settings-test.save', anchorId: 'keybinding-settings-test.save' }} />)
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('')
    expect(screen.getByText('Save file')).toBeTruthy()
  })
})
