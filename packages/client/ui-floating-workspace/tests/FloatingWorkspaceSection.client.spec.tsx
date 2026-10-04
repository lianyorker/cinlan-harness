// @vitest-environment jsdom
/** Settings presentation: one card with enablement and the two entry positions. */
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
    phase: 'closed', open: false, writing: false, writeFailed: false, directorySupported: false,
  }
}

function mount(initial: FloatingSnapshot = accepted(), dictionary: Record<FloatingWorkspaceSettingsKey, string> = en) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const source = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const set = vi.fn<FloatingActions['set']>(async () => {})
  const unused = (() => { throw new Error('unused standard hook') }) as never
  const props: FloatingWorkspaceSectionProps = {
    useSessions: unused, useWorkspaces: unused, usePanelInfo: unused, useSessionStatus: unused, useSessionRetainInfo: unused, useResource: unused,
    close: vi.fn(), useFloating: bindSnapshotSelector(source), set, t: makeTranslate(dictionary),
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
  return { ...view, props, set, publish, accept, source }
}

describe('Floating Workspace settings presentation', () => {
  it.each([en, zh])('renders a locale-owned heading and one card with only the two positions', (dictionary) => {
    mount(accepted({ enabled: true }), dictionary)
    expect(screen.getByRole('heading', { level: 1, name: dictionary.title })).toBeTruthy()
    expect(screen.getByText(dictionary.description)).toBeTruthy()
    // The terminal-directory row is gone: the panel starts no terminal.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('switch', { name: dictionary.enable }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByRole('radio').map(input => input.parentElement?.textContent)).toEqual([
      dictionary.toggleButtonPositionHeader, dictionary.toggleButtonPositionFloating,
    ])
    expect(screen.getByRole<HTMLInputElement>('radio', { name: dictionary.toggleButtonPositionHeader }).checked).toBe(true)
  })

  it('persists enablement and both entry positions after their accepted echo', () => {
    const h = mount(accepted({ enabled: false }))
    fireEvent.click(screen.getByRole('switch', { name: en.enable }))
    expect(h.set).toHaveBeenLastCalledWith('enabled', true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: en.toggleButtonPositionFloating }).disabled).toBe(true)
    h.accept({ enabled: true })
    const floating = screen.getByRole<HTMLInputElement>('radio', { name: en.toggleButtonPositionFloating })
    fireEvent.click(floating)
    expect(h.set).toHaveBeenLastCalledWith('toggleButtonPosition', 'floating')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: en.toggleButtonPositionHeader }).checked).toBe(true)
    h.accept({ toggleButtonPosition: 'floating' })
    expect(floating.checked).toBe(true)
  })

  it('reports loading, unavailable, refused writes and read-only mode', () => {
    const loading = mount({ ...accepted(), settings: { ...accepted().settings, status: 'loading', value: undefined } })
    expect(screen.getByText(en.loading)).toBeTruthy()
    loading.unmount()
    const unavailable = mount({ ...accepted(), settings: { ...accepted().settings, status: 'unavailable', value: undefined } })
    expect(screen.getByText(en.error)).toBeTruthy()
    unavailable.unmount()
    const refused = mount({ ...accepted({ enabled: true }), writeFailed: true })
    expect(screen.getByRole('alert').textContent).toBe(en.writeFailed)
    refused.unmount()
    mount({ ...accepted({ enabled: true }), settings: { ...accepted().settings, writable: false, value: { ...accepted().settings.value!, enabled: true } } })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getByRole('switch', { name: en.enable }).hasAttribute('disabled')).toBe(true)
  })

  it('locks every control while a write is in flight and announces the write', () => {
    mount({ ...accepted({ enabled: true }), writing: true })
    expect(screen.getByText(en.saving)).toBeTruthy()
    expect(screen.getByRole('switch', { name: en.enable }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByRole<HTMLInputElement>('radio').every(input => input.disabled)).toBe(true)
  })
})
