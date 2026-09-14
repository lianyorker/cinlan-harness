// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FloatingWorkspaceSection, type FloatingWorkspaceSectionProps } from '../src/client/FloatingWorkspaceSection.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { FloatingWorkspaceSettings, ToggleButtonPosition } from '../src/types.ts'

afterEach(() => { cleanup() })

function makeScope(overrides: Partial<FloatingWorkspaceSettings> = {}) {
  const value: FloatingWorkspaceSettings = {
    enabled: false,
    terminalDirectory: '',
    toggleButtonPosition: 'header',
    floatDefaultWidth: 400,
    floatDefaultHeight: 300,
    ...overrides,
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready' as const, value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' as const }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: vi.fn(async (key: string, val: unknown) => {
      (value as unknown as Record<string, unknown>)[key] = val
      listeners.forEach(l => l())
    }),
    unset: vi.fn(async () => {}),
    mutate: vi.fn(async () => {}),
  }
}

function mount(language: 'en' | 'zh' = 'en', overrides: Partial<FloatingWorkspaceSettings> = {}) {
  const floatingWorkspace = makeScope(overrides)
  const t = (key: string) => ((language === 'en' ? en : zh) as Record<string, string>)[key] ?? key
  const props = { floatingWorkspace, t } as FloatingWorkspaceSectionProps
  return { ...render(<FloatingWorkspaceSection {...props} />), floatingWorkspace, props }
}

describe('FloatingWorkspaceSection', () => {
  it('renders the section heading and description', () => {
    mount()
    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByText(en.description)).toBeTruthy()
  })

  it('renders the enable toggle unchecked by default', () => {
    mount()
    const checkbox = screen.getByRole('checkbox', { name: en.enable })
    expect((checkbox as HTMLInputElement).checked).toBe(false)
  })

  it('calls set when the enable toggle is clicked', () => {
    const { floatingWorkspace } = mount()
    const checkbox = screen.getByRole('checkbox', { name: en.enable })
    fireEvent.click(checkbox)
    expect(floatingWorkspace.set).toHaveBeenCalledWith('enabled', true)
  })

  it('renders the terminal directory input with the stored value', () => {
    mount('en', { terminalDirectory: '/home/user' })
    const input = screen.getByPlaceholderText(en.terminalDirectoryPlaceholder) as HTMLInputElement
    expect(input.value).toBe('/home/user')
  })

  it('calls set when terminal directory input changes', () => {
    const { floatingWorkspace } = mount()
    const input = screen.getByPlaceholderText(en.terminalDirectoryPlaceholder)
    fireEvent.change(input, { target: { value: '/tmp' } })
    expect(floatingWorkspace.set).toHaveBeenCalledWith('terminalDirectory', '/tmp')
  })

  it('renders the toggle button position select with the stored value', () => {
    mount('en', { toggleButtonPosition: 'sidebar' as ToggleButtonPosition })
    const select = screen.getByRole('combobox', { name: en.toggleButtonPosition }) as HTMLSelectElement
    expect(select.value).toBe('sidebar')
  })

  it('calls set when toggle button position changes', () => {
    const { floatingWorkspace } = mount()
    const select = screen.getByRole('combobox', { name: en.toggleButtonPosition })
    fireEvent.change(select, { target: { value: 'floating' } })
    expect(floatingWorkspace.set).toHaveBeenCalledWith('toggleButtonPosition', 'floating')
  })

  it('renders the float default size inputs with stored values', () => {
    mount('en', { floatDefaultWidth: 500, floatDefaultHeight: 350 })
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs[0]!.value).toBe('500')
    expect(inputs[1]!.value).toBe('350')
  })

  it('calls set when float default width changes', () => {
    const { floatingWorkspace } = mount()
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0]!, { target: { value: '600' } })
    expect(floatingWorkspace.set).toHaveBeenCalledWith('floatDefaultWidth', 600)
  })

  it('renders loading state when scope is unavailable', () => {
    const scope = {
      getSnapshot: () => ({ status: 'unavailable' as const, value: undefined, base: undefined, user: undefined, revision: 0, writable: false, mode: 'host' as const }),
      subscribe: () => () => {},
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
      mutate: vi.fn(async () => {}),
    }
    const t = (key: string) => (en as Record<string, string>)[key] ?? key
    const props = { floatingWorkspace: scope, t } as FloatingWorkspaceSectionProps
    render(<FloatingWorkspaceSection {...props} />)
    expect(screen.getByText(en.error)).toBeTruthy()
  })

  it('renders Chinese text when zh locale is selected', () => {
    mount('zh')
    expect(screen.getByText(zh.title)).toBeTruthy()
    expect(screen.getByText(zh.enable)).toBeTruthy()
  })
})
