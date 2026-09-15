// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { KeybindingsSection, type KeybindingsSectionProps } from '../src/client/KeybindingsSection.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { KeybindingsSettings, KeybindingOverride } from '../src/types.ts'
import { serializeBinding, detectConflicts } from '../src/types.ts'

afterEach(() => { cleanup() })

function makeScope(overrides: KeybindingOverride[] = []) {
  const value: KeybindingsSettings = { overrides }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({
      status: 'ready' as const, value, base: undefined,
      user: undefined, revision: 1, writable: true, mode: 'host' as const,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(async (key: string, val: unknown) => {
      if (key === 'overrides') value.overrides = val as KeybindingOverride[]
      listeners.forEach(l => l())
    }),
    unset: vi.fn(async () => {}),
    mutate: vi.fn(async () => {}),
  }
}

function mount(language: 'en' | 'zh' = 'en', overrides: KeybindingOverride[] = []) {
  const keybindings = makeScope(overrides)
  const t = (key: string) =>
    ((language === 'en' ? en : zh) as Record<string, string>)[key] ?? key
  const props = { keybindings, t } as KeybindingsSectionProps
  return { ...render(<KeybindingsSection {...props} />), keybindings, props }
}

describe('KeybindingsSection', () => {
  it('renders the section heading and description', () => {
    mount()
    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByText(en.description)).toBeTruthy()
  })

  it('renders the search input', () => {
    mount()
    expect(screen.getByPlaceholderText(en.search)).toBeTruthy()
  })

  it('renders built-in commands grouped by category', () => {
    mount()
    expect(screen.getByText(en.categoryConversation)).toBeTruthy()
    expect(screen.getByText(en.categoryEditor)).toBeTruthy()
    expect(screen.getByText('Submit Conversation')).toBeTruthy()
    expect(screen.getByText('Save')).toBeTruthy()
  })

  it('filters commands by search query', () => {
    mount()
    const search = screen.getByPlaceholderText(en.search)
    fireEvent.change(search, { target: { value: 'save' } })
    expect(screen.getByText('Save')).toBeTruthy()
    expect(screen.queryByText('Submit Conversation')).toBeNull()
  })

  it('shows no results message for empty search', () => {
    mount()
    const search = screen.getByPlaceholderText(en.search)
    fireEvent.change(search, { target: { value: 'xyznonexistent' } })
    expect(screen.getByText(en.noResults)).toBeTruthy()
  })

  it('renders default bindings for commands', () => {
    mount()
    expect(screen.getByText('Enter')).toBeTruthy()
    expect(screen.getByText('Ctrl+s')).toBeTruthy()
  })

  it('renders user overrides when present', () => {
    mount('en', [
      { commandId: 'editor.save', binding: { key: 'x', modifiers: { ctrl: true } } },
    ])
    expect(screen.getByText('Ctrl+x')).toBeTruthy()
  })

  it('shows unbind label for null binding overrides', () => {
    mount('en', [{ commandId: 'editor.save', binding: null }])
    expect(screen.getByText(en.unbind)).toBeTruthy()
  })

  it('enters recording mode when Record button is clicked', () => {
    mount()
    const buttons = screen.getAllByText(en.record)
    fireEvent.click(buttons[0]!)
    expect(screen.getByText(en.recording)).toBeTruthy()
  })

  it('calls set when Record button is clicked then key is pressed', () => {
    const { keybindings } = mount()
    const buttons = screen.getAllByText(en.record)
    fireEvent.click(buttons[0]!)
    // Simulate keydown for the recording
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, bubbles: true })
    expect(keybindings.set).toHaveBeenCalledWith('overrides', expect.any(Array))
  })

  it('calls set when Reset button is clicked', () => {
    const { keybindings } = mount('en', [
      { commandId: 'editor.save', binding: { key: 'x', modifiers: { ctrl: true } } },
    ])
    const resetButtons = screen.getAllByText(en.reset)
    fireEvent.click(resetButtons[0]!)
    expect(keybindings.set).toHaveBeenCalledWith('overrides', expect.any(Array))
  })

  it('renders loading state when scope is unavailable', () => {
    const scope = {
      getSnapshot: () => ({
        status: 'unavailable' as const, value: undefined, base: undefined,
        user: undefined, revision: 0, writable: false, mode: 'host' as const,
      }),
      subscribe: () => () => {},
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
      mutate: vi.fn(async () => {}),
    }
    const t = (key: string) => (en as Record<string, string>)[key] ?? key
    const props = { keybindings: scope, t } as KeybindingsSectionProps
    render(<KeybindingsSection {...props} />)
    expect(screen.getByText(en.error)).toBeTruthy()
  })

  it('renders Chinese text when zh locale is selected', () => {
    mount('zh')
    expect(screen.getByText(zh.title)).toBeTruthy()
    expect(screen.getByText(zh.categoryConversation)).toBeTruthy()
  })
})

describe('serializeBinding', () => {
  it('serializes a simple key', () => {
    expect(serializeBinding({ key: 'Enter', modifiers: {} })).toBe('Enter')
  })

  it('serializes key with modifiers', () => {
    expect(serializeBinding({ key: 's', modifiers: { ctrl: true, shift: true } }))
      .toBe('Ctrl+Shift+s')
  })

  it('serializes key with all modifiers', () => {
    expect(serializeBinding({ key: 'a', modifiers: { ctrl: true, shift: true, alt: true, meta: true } }))
      .toBe('Ctrl+Shift+Alt+Meta+a')
  })
})

describe('detectConflicts', () => {
  it('returns empty map for no conflicts', () => {
    const overrides = [
      { commandId: 'a', binding: { key: 'Enter', modifiers: {} } },
      { commandId: 'b', binding: { key: 'Escape', modifiers: {} } },
    ]
    expect(detectConflicts(overrides).size).toBe(0)
  })

  it('detects when two commands share the same binding', () => {
    const overrides = [
      { commandId: 'a', binding: { key: 'Enter', modifiers: { ctrl: true } } },
      { commandId: 'b', binding: { key: 'Enter', modifiers: { ctrl: true } } },
    ]
    const conflicts = detectConflicts(overrides)
    expect(conflicts.size).toBe(1)
    expect(conflicts.get('Ctrl+Enter')).toEqual(['a', 'b'])
  })

  it('ignores null bindings', () => {
    const overrides = [
      { commandId: 'a', binding: null },
      { commandId: 'b', binding: null },
    ]
    expect(detectConflicts(overrides).size).toBe(0)
  })
})
