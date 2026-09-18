// @vitest-environment jsdom
/** Existing shell seats expose exactly one configured entry and the shared keyboard matcher. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FloatingEntry, type FloatingEntryProps } from '../src/client/FloatingEntry.tsx'
import { en } from '../src/client/locales.ts'
import type { FloatingSnapshot } from '../src/client/contract.ts'
import type { ToggleButtonPosition } from '../src/types.ts'

afterEach(cleanup)
function mount(position: ToggleButtonPosition, selected: ToggleButtonPosition = position, patch: Partial<FloatingSnapshot> = {}) {
  const snapshot: FloatingSnapshot = {
    settings: {
      status: 'ready', value: { enabled: true, terminalDirectory: '', toggleButtonPosition: selected, floatDefaultWidth: 400, floatDefaultHeight: 300 },
      base: {}, user: {}, revision: 1, mode: 'host', writable: true,
    },
    phase: 'closed', child: false, writing: false, writeFailed: false, targetUnavailable: false, directorySupported: false,
    ...patch,
  }
  const toggle = vi.fn(), closeWindow = vi.fn(), matchesShortcut = vi.fn(() => false)
  const unused = (() => { throw new Error('unused standard hook') }) as never
  const props: FloatingEntryProps = {
    useSessions: unused, useWorkspaces: unused, useSessionPendingInteraction: unused, useResource: unused,
    useFloating: bindSnapshotSelector({ getSnapshot: () => snapshot, subscribe: () => () => {} }),
    t: makeTranslate(en), position, toggle, closeWindow, matchesShortcut,
  }
  return { ...render(<FloatingEntry {...props} />), toggle, closeWindow, matchesShortcut }
}

describe('floating entry presentation', () => {
  it.each(['header', 'sidebar', 'floating'] as const)('renders the %s entry and invokes the real owner callback', (position) => {
    const h = mount(position)
    const trigger = screen.getByRole('button', { name: en.toggle })
    expect(trigger.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(trigger)
    expect(h.toggle).toHaveBeenCalledOnce()
  })
  it('marks the current open state and hides other entry positions', () => {
    const h = mount('header', 'header', { phase: 'open' })
    expect(screen.getByRole('button', { name: en.toggle }).getAttribute('aria-pressed')).toBe('true')
    h.unmount()
    mount('sidebar', 'header')
    expect(screen.queryByRole('button')).toBeNull()
  })
  it.each(['blocked', 'unavailable'] as const)('keeps %s feedback visible in the overlay for a header entry', (phase) => {
    const h = mount('floating', 'header', { phase })
    expect(screen.getByRole('alert').textContent).toBe(en[phase])
    expect({ phase, message: screen.getByRole('alert').textContent, entryButtons: screen.queryAllByRole('button').length }).toMatchSnapshot()
    expect(screen.queryByRole('button')).toBeNull()
    h.unmount()
    mount('header', 'header', { phase })
    expect(screen.getByRole('button')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('keeps a healthy unselected overlay empty', () => {
    mount('floating', 'header')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it.each(['loading', 'unavailable', 'disabled'] as const)('withholds the entry for %s preferences', (kind) => {
    const settings: FloatingSnapshot['settings'] = {
      status: kind === 'disabled' ? 'ready' : kind,
      value: kind === 'disabled' ? { enabled: false, terminalDirectory: '', toggleButtonPosition: 'header', floatDefaultWidth: 400, floatDefaultHeight: 300 } : undefined,
      user: {}, base: {}, revision: 1, writable: false, mode: 'host',
    }
    mount('header', 'header', { settings })
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('the child exposes only its own close control and no global shortcut dispatcher', () => {
    const h = mount('sidebar', 'header', { child: true, targetUnavailable: true })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(h.closeWindow).toHaveBeenCalledOnce()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, shiftKey: true }))
    expect(h.matchesShortcut).not.toHaveBeenCalled()
    expect(h.toggle).not.toHaveBeenCalled()
    h.unmount()
    const warning = mount('floating', 'header', { child: true, targetUnavailable: true })
    expect(screen.getByRole('status').textContent).toBe(en.initialSessionUnavailable)
    expect(screen.queryByRole('button')).toBeNull()
    warning.unmount()
    mount('header', 'header', { child: true })
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('a healthy child does not show a missing-session warning', () => {
    mount('floating', 'header', { child: true })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('dispatches only a match from the keyboard service and removes its one listener on unmount', () => {
    const h = mount('floating', 'header')
    const ignored = new KeyboardEvent('keydown', { key: 'x', cancelable: true })
    window.dispatchEvent(ignored)
    expect(ignored.defaultPrevented).toBe(false)
    expect(h.toggle).not.toHaveBeenCalled()
    h.matchesShortcut.mockReturnValue(true)
    const accepted = new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, shiftKey: true, cancelable: true })
    window.dispatchEvent(accepted)
    expect(h.matchesShortcut).toHaveBeenLastCalledWith({
      key: ' ', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, isComposing: false,
      repeat: false, defaultPrevented: false, keyCode: 0, altGraph: false,
    })
    expect(accepted.defaultPrevented).toBe(true)
    expect(h.toggle).toHaveBeenCalledOnce()
    h.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, shiftKey: true }))
    expect(h.toggle).toHaveBeenCalledOnce()
  })
})
