// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FloatingWorkspaceSection, type FloatingWorkspaceSectionProps } from '../src/client/FloatingWorkspaceSection.tsx'
import { en, zh, type FloatingWorkspaceSettingsKey } from '../src/client/locales.ts'
import type { FloatingActions, FloatingSnapshot } from '../src/client/contract.ts'
import type { FloatingWorkspaceSettings } from '../src/types.ts'

const release: (() => void)[] = []
afterEach(async () => {
  cleanup()
  for (const resolve of release.splice(0)) resolve()
  await Promise.resolve()
})

function accepted(overrides: Partial<FloatingWorkspaceSettings> = {}): FloatingSnapshot {
  return {
    settings: {
      status: 'ready', value: {
        enabled: false, terminalDirectory: '', toggleButtonPosition: 'header', floatDefaultWidth: 400, floatDefaultHeight: 300,
        ...overrides,
      }, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host',
    },
    phase: 'closed', child: false, writing: false, writeFailed: false, targetUnavailable: false, directorySupported: false,
  }
}

function mount(
  initial: FloatingSnapshot = accepted(),
  dictionary: Record<FloatingWorkspaceSettingsKey, string> = en,
  pickDirectory = vi.fn<() => Promise<string | null>>(async () => null),
) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const source = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const set = vi.fn<FloatingActions['set']>(async () => {})
  const unused = (() => { throw new Error('unused standard hook') }) as never
  const props: FloatingWorkspaceSectionProps = {
    useSessions: unused, useWorkspaces: unused, useSessionPendingInteraction: unused, useResource: unused,
    close: vi.fn(), useFloating: bindSnapshotSelector(source), set, pickDirectory, t: makeTranslate(dictionary),
  }
  const view = render(<FloatingWorkspaceSection {...props} />)
  const publish = (update: Partial<FloatingSnapshot>): void => {
    act(() => {
      snapshot = { ...snapshot, ...update }
      for (const listener of listeners) listener()
    })
  }
  const accept = (update: Partial<FloatingWorkspaceSettings>): void => {
    publish({ settings: { ...snapshot.settings, value: { ...snapshot.settings.value!, ...update } } })
  }
  return { ...view, props, set, pickDirectory, publish, accept, source }
}

function directory(label: string = en.terminalDirectory): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: label })
}

describe('Floating Workspace settings presentation', () => {
  it.each([en, zh])('renders a locale-owned heading and exactly one three-row card', (dictionary) => {
    const h = mount(accepted({ enabled: true, terminalDirectory: '/saved/project' }), dictionary)
    expect(screen.getByRole('heading', { level: 1, name: dictionary.title })).toBeTruthy()
    expect(screen.getByText(dictionary.description)).toBeTruthy()
    expect(directory(dictionary.terminalDirectory).value).toBe('/saved/project')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: dictionary.toggleButtonPositionHeader }).checked).toBe(true)
    expect(screen.getAllByRole('radio').map(input => input.parentElement?.textContent)).toEqual([
      dictionary.toggleButtonPositionHeader, dictionary.toggleButtonPositionSidebar, dictionary.toggleButtonPositionFloating,
    ])
    expect([...h.container.querySelectorAll('[data-settings-anchor]')].map(element => element.getAttribute('data-settings-anchor')))
      .toEqual(['floating-enabled', 'floating-directory', 'floating-position'])
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('button', { name: dictionary.open })).toBeNull()
    expect(screen.queryByText(dictionary.shortcutDescription)).toBeNull()
  })

  it('waits for accepted preference echoes and locks all controls during a write', async () => {
    const h = mount()
    const enable = screen.getByRole<HTMLButtonElement>('switch', { name: en.enable })
    const header = screen.getByRole<HTMLInputElement>('radio', { name: en.toggleButtonPositionHeader })
    expect(enable.getAttribute('aria-checked')).toBe('false')
    expect(header.disabled).toBe(true)
    fireEvent.click(enable)
    expect(h.set).toHaveBeenCalledWith('enabled', true)
    expect(enable.getAttribute('aria-checked')).toBe('false')
    h.publish({ writing: true })
    expect(enable.disabled).toBe(true)
    expect(screen.getByText(en.saving)).toBeTruthy()
    fireEvent.click(enable)
    expect(h.set).toHaveBeenCalledOnce()
    h.publish({ writing: false, writeFailed: true })
    expect(screen.getByRole('alert').textContent).toBe(en.writeFailed)
    h.accept({ enabled: true })
    expect(enable.getAttribute('aria-checked')).toBe('true')
    expect(header.disabled).toBe(false)
    await act(async () => { fireEvent.click(enable) })
    expect(h.set).toHaveBeenLastCalledWith('enabled', false)
    expect(enable.getAttribute('aria-checked')).toBe('true')
  })

  it('keeps a saved directory visible but disables both directory controls without a terminal consumer', () => {
    const h = mount(accepted({ enabled: true, terminalDirectory: 'D:\\work\\terminal' }))
    const input = directory()
    const picker = screen.getByRole<HTMLButtonElement>('button', { name: en.terminalDirectoryPick })
    expect(input.value).toBe('D:\\work\\terminal')
    expect(input.disabled).toBe(true)
    expect(picker.disabled).toBe(true)
    expect(screen.getByText(en.terminalDirectoryUnavailable)).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
  })

  it.each([en, zh])('commits a supported typed directory on blur or Enter and preserves a pending draft', async (dictionary) => {
    const h = mount({ ...accepted({ enabled: true, terminalDirectory: '/work' }), directorySupported: true }, dictionary)
    const input = directory(dictionary.terminalDirectory)
    expect(screen.getByText(dictionary.terminalDirectoryDescription)).toBeTruthy()
    fireEvent.change(input, { target: { value: './nested folder' } })
    fireEvent.keyDown(input, { key: 'ArrowLeft' })
    expect(h.set).not.toHaveBeenCalled()
    h.publish({ phase: 'open' })
    h.accept({ terminalDirectory: '/work/older' })
    expect(input.value).toBe('./nested folder')
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).toHaveBeenCalledWith('terminalDirectory', './nested folder')
    h.publish({ settings: {
      ...h.source.getSnapshot().settings,
      value: { ...h.source.getSnapshot().settings.value!, terminalDirectory: '/work/nested folder' },
      user: { terminalDirectory: './nested folder' },
    } })
    expect(input.value).toBe('/work/nested folder')
    h.accept({ terminalDirectory: '/work/future' })
    fireEvent.change(input, { target: { value: '' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(h.set).toHaveBeenLastCalledWith('terminalDirectory', '')
  })

  it('retains refused directory drafts, restores with Escape, and suppresses duplicate writes', async () => {
    const h = mount({ ...accepted({ enabled: true, terminalDirectory: '/work' }), directorySupported: true })
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    release.push(finish)
    h.set.mockReturnValueOnce(pending)
    const input = directory()
    fireEvent.change(input, { target: { value: '/work/rejected' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.disabled).toBe(true)
    fireEvent.blur(input)
    expect(h.set).toHaveBeenCalledOnce()
    await act(async () => { finish(); await pending })
    h.publish({ writeFailed: true })
    expect(input.value).toBe('/work/rejected')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('/work')
  })

  it('does not rewrite unchanged effective or raw directory values and respects later locks', async () => {
    const initial = { ...accepted({ enabled: true, terminalDirectory: '/work/sub' }), directorySupported: true }
    const h = mount({ ...initial, settings: { ...initial.settings, user: { terminalDirectory: './sub' } } })
    const input = directory()
    await act(async () => { fireEvent.blur(input) })
    fireEvent.change(input, { target: { value: '/work/new' } })
    fireEvent.change(input, { target: { value: '/work/sub' } })
    await act(async () => { fireEvent.blur(input) })
    fireEvent.change(input, { target: { value: './sub' } })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '/work/locked' } })
    h.publish({ settings: { ...h.source.getSnapshot().settings, writable: false } })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    expect(input.value).toBe('/work/locked')
  })

  it('uses the Host picker, ignores cancellation, reports failure, and preserves the typed value', async () => {
    const pick = vi.fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('/picked/project')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('picker unavailable'))
    const h = mount({ ...accepted({ enabled: true, terminalDirectory: '/work' }), directorySupported: true }, en, pick)
    const picker = screen.getByRole<HTMLButtonElement>('button', { name: en.terminalDirectoryPick })
    await act(async () => { fireEvent.click(picker) })
    expect(h.set).toHaveBeenCalledWith('terminalDirectory', '/picked/project')
    h.set.mockClear()
    await act(async () => { fireEvent.click(picker) })
    expect(h.set).not.toHaveBeenCalled()
    const input = directory()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '/typed/value' } })
    fireEvent.blur(input, { relatedTarget: picker })
    expect(h.set).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(picker) })
    expect(screen.getByRole('alert').textContent).toBe(en.terminalDirectoryPickFailed)
    expect(directory().value).toBe('/typed/value')
  })

  it('persists only the three supported entry positions after their accepted echo', () => {
    const h = mount(accepted({ enabled: true }))
    const header = screen.getByRole<HTMLInputElement>('radio', { name: en.toggleButtonPositionHeader })
    const sidebar = screen.getByRole<HTMLInputElement>('radio', { name: en.toggleButtonPositionSidebar })
    const floating = screen.getByRole<HTMLInputElement>('radio', { name: en.toggleButtonPositionFloating })
    expect(header.checked).toBe(true)
    fireEvent.click(sidebar)
    expect(h.set).toHaveBeenLastCalledWith('toggleButtonPosition', 'sidebar')
    expect(header.checked).toBe(true)
    h.accept({ toggleButtonPosition: 'sidebar' })
    expect(sidebar.checked).toBe(true)
    fireEvent.click(floating)
    expect(h.set).toHaveBeenLastCalledWith('toggleButtonPosition', 'floating')
  })

  it('gates directory editing by enablement, consumer support, writability, and active writes', async () => {
    const initial = accepted({ terminalDirectory: '/saved' })
    const h = mount(initial)
    const input = directory()
    h.publish({ directorySupported: true })
    expect(input.disabled).toBe(true)
    h.accept({ enabled: true })
    expect(input.disabled).toBe(false)
    fireEvent.change(input, { target: { value: '/saved/nested' } })
    h.publish({ directorySupported: false })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    h.publish({ directorySupported: true, settings: { ...h.source.getSnapshot().settings, writable: false } })
    expect(input.disabled).toBe(true)
    h.publish({ settings: { ...h.source.getSnapshot().settings, writable: true }, writing: true })
    expect(input.disabled).toBe(true)
    h.publish({ writing: false })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).toHaveBeenCalledWith('terminalDirectory', '/saved/nested')
  })

  it('shows read-only and missing-value states without inventing card controls', () => {
    const ready = accepted({ enabled: true })
    const h = mount({ ...ready, settings: { ...ready.settings, writable: false } })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true)
    expect(screen.getAllByRole<HTMLInputElement>('radio').every(input => input.disabled)).toBe(true)
    h.unmount()
    for (const status of ['loading', 'unavailable', 'ready'] as const) {
      const initial = accepted()
      const view = mount({ ...initial, settings: { ...initial.settings, status, value: undefined } })
      expect(screen.getByText(status === 'loading' ? en.loading : en.error)).toBeTruthy()
      expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
      expect(screen.queryByRole('switch')).toBeNull()
      view.unmount()
    }
  })
})
