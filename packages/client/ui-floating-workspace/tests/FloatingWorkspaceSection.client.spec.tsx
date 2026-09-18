// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

function mount(initial: FloatingSnapshot = accepted(), dictionary: Record<FloatingWorkspaceSettingsKey, string> = en) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const source = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const set = vi.fn<FloatingActions['set']>(async () => {})
  const toggle = vi.fn<FloatingActions['toggle']>()
  const closeWindow = vi.fn<FloatingActions['close']>()
  const unused = (() => { throw new Error('unused standard hook') }) as never
  const props: FloatingWorkspaceSectionProps = {
    useSessions: unused, useWorkspaces: unused, useSessionPendingInteraction: unused, useResource: unused,
    close: vi.fn(), useFloating: bindSnapshotSelector(source), set, toggle, closeWindow, t: makeTranslate(dictionary),
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
  return { ...view, props, set, toggle, closeWindow, publish, accept, source }
}

function number(label: string): HTMLInputElement { return screen.getByRole<HTMLInputElement>('spinbutton', { name: label }) }
function button(label: string): HTMLButtonElement { return screen.getByRole<HTMLButtonElement>('button', { name: label }) }

describe('Floating Workspace settings presentation', () => {
  it.each([en, zh])('uses locale-owned native rows, real stored values and stable search anchors', (dictionary) => {
    const h = mount(accepted({ enabled: true, terminalDirectory: '/saved/project' }), dictionary)
    expect(screen.getByText(dictionary.description)).toBeTruthy()
    expect(screen.getByRole('heading', { name: dictionary.workspaceEntry })).toBeTruthy()
    expect(screen.getByRole('heading', { name: dictionary.floatDefaultSize })).toBeTruthy()
    expect(screen.getByText(dictionary.floatDefaultSizeDescription)).toBeTruthy()
    expect(screen.getByText(dictionary.shortcutDescription)).toBeTruthy()
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: dictionary.toggleButtonPosition })
    expect(select.value).toBe('header')
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual([
      dictionary.toggleButtonPositionHeader, dictionary.toggleButtonPositionSidebar, dictionary.toggleButtonPositionFloating,
    ])
    expect(number(dictionary.floatDefaultWidth).value).toBe('400')
    expect(number(dictionary.floatDefaultHeight).value).toBe('300')
    expect(number(dictionary.floatDefaultWidth).min).toBe('200')
    expect(number(dictionary.floatDefaultWidth).max).toBe('800')
    expect(number(dictionary.floatDefaultHeight).min).toBe('150')
    expect(number(dictionary.floatDefaultHeight).max).toBe('600')
    expect([...h.container.querySelectorAll('[data-settings-anchor]')].map(element => element.getAttribute('data-settings-anchor')))
      .toEqual(['floating-enabled', 'floating-position', 'floating-directory', 'floating-width', 'floating-height',
        'floating-shortcut', 'floating-open'])
  })

  it('keeps enabling off until accepted source echo and never launches on preference change', async () => {
    const h = mount()
    const control = screen.getByRole<HTMLButtonElement>('switch', { name: en.enable })
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(number(en.floatDefaultWidth).disabled).toBe(true)
    expect(button(en.open).disabled).toBe(true)
    expect(screen.getByText(en.disabled)).toBeTruthy()
    fireEvent.click(control)
    expect(h.set).toHaveBeenCalledWith('enabled', true)
    expect(control.getAttribute('aria-checked')).toBe('false')
    h.publish({ writing: true })
    expect(control.disabled).toBe(true)
    expect(screen.getByText(en.saving)).toBeTruthy()
    fireEvent.click(control)
    expect(h.set).toHaveBeenCalledOnce()
    h.publish({ writing: false, writeFailed: true })
    expect(screen.getByRole('alert').textContent).toBe(en.writeFailed)
    expect(control.getAttribute('aria-checked')).toBe('false')
    h.accept({ enabled: true })
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(h.toggle).not.toHaveBeenCalled()
    expect(h.closeWindow).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(control) })
    expect(h.set).toHaveBeenLastCalledWith('enabled', false)
    expect(control.getAttribute('aria-checked')).toBe('true')
  })

  it('keeps the saved directory visible but disabled because no terminal runtime consumes it', () => {
    const h = mount(accepted({ enabled: true, terminalDirectory: 'D:\\work\\terminal' }))
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: en.terminalDirectory })
    expect(input.value).toBe('D:\\work\\terminal')
    expect(input.disabled).toBe(true)
    expect(screen.getByText(en.terminalDirectoryUnavailable)).toBeTruthy()
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
  })

  it.each([en, zh])('edits supported terminal directories only on commit and follows accepted raw or effective echo', async (dictionary) => {
    const h = mount({ ...accepted({ enabled: true, terminalDirectory: '/work' }), directorySupported: true }, dictionary)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: dictionary.terminalDirectory })
    expect(input.disabled).toBe(false)
    expect(screen.getByText(dictionary.terminalDirectoryDescription)).toBeTruthy()
    expect(screen.queryByText(dictionary.terminalDirectoryUnavailable)).toBeNull()
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
    expect(input.value).toBe('/work/future')
    fireEvent.change(input, { target: { value: '' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(h.set).toHaveBeenLastCalledWith('terminalDirectory', '')
    h.accept({ terminalDirectory: '' })
    h.accept({ terminalDirectory: '/work/current' })
    expect(input.value).toBe('/work/current')
  })

  it('gates directory editing by installed consumer, enabled preference, writability and active writes', async () => {
    const initial = accepted({ terminalDirectory: '/saved' })
    const h = mount(initial)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: en.terminalDirectory })
    h.publish({ directorySupported: true })
    expect(input.disabled).toBe(true)
    h.accept({ enabled: true })
    expect(input.disabled).toBe(false)
    fireEvent.change(input, { target: { value: '/saved/nested' } })
    h.publish({ directorySupported: false })
    expect(input.disabled).toBe(true)
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    expect(input.value).toBe('/saved/nested')
    h.publish({ directorySupported: true, settings: { ...h.source.getSnapshot().settings, writable: false } })
    expect(input.disabled).toBe(true)
    h.publish({ settings: { ...h.source.getSnapshot().settings, writable: true }, writing: true })
    expect(input.disabled).toBe(true)
    h.publish({ writing: false })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).toHaveBeenCalledWith('terminalDirectory', '/saved/nested')
  })

  it('retains refused directory drafts, allows Escape restore and suppresses duplicate pending writes', async () => {
    const h = mount({ ...accepted({ enabled: true, terminalDirectory: '/work' }), directorySupported: true })
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    release.push(finish)
    h.set.mockReturnValueOnce(pending)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: en.terminalDirectory })
    fireEvent.change(input, { target: { value: '/work/rejected' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.disabled).toBe(true)
    fireEvent.blur(input)
    expect(h.set).toHaveBeenCalledOnce()
    await act(async () => { finish(); await pending })
    h.publish({ writeFailed: true })
    expect(input.value).toBe('/work/rejected')
    expect(screen.getByRole('alert').textContent).toBe(en.writeFailed)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('/work')
  })

  it('does not rewrite unchanged accepted effective or raw directory values', async () => {
    const initial = { ...accepted({ enabled: true, terminalDirectory: '/work/sub' }), directorySupported: true }
    const h = mount({ ...initial, settings: { ...initial.settings, user: { terminalDirectory: './sub' } } })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: en.terminalDirectory })
    await act(async () => { fireEvent.blur(input) })
    fireEvent.change(input, { target: { value: '/work/new' } })
    fireEvent.change(input, { target: { value: '/work/sub' } })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: './sub' } })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    expect(input.value).toBe('/work/sub')
  })

  it('persists only supported entry positions and leaves the select on its accepted value', () => {
    const h = mount(accepted({ enabled: true }))
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: en.toggleButtonPosition })
    fireEvent.change(select, { target: { value: 'sidebar' } })
    expect(h.set).toHaveBeenLastCalledWith('toggleButtonPosition', 'sidebar')
    expect(select.value).toBe('header')
    h.accept({ toggleButtonPosition: 'sidebar' })
    expect(select.value).toBe('sidebar')
    fireEvent.change(select, { target: { value: 'floating' } })
    expect(h.set).toHaveBeenLastCalledWith('toggleButtonPosition', 'floating')
  })

  it('holds numeric drafts through unrelated and stale snapshots, committing only on blur or Enter', async () => {
    const h = mount(accepted({ enabled: true }))
    const width = number(en.floatDefaultWidth)
    fireEvent.change(width, { target: { value: '575' } })
    expect(h.set).not.toHaveBeenCalled()
    h.publish({ phase: 'open' })
    h.accept({ floatDefaultWidth: 410 })
    expect(width.value).toBe('575')
    await act(async () => { fireEvent.blur(width) })
    expect(h.set).toHaveBeenCalledWith('floatDefaultWidth', 575)
    expect(width.value).toBe('575')
    h.accept({ floatDefaultWidth: 575 })
    h.accept({ floatDefaultWidth: 620 })
    expect(width.value).toBe('620')
    const height = number(en.floatDefaultHeight)
    fireEvent.change(height, { target: { value: '450' } })
    fireEvent.keyDown(height, { key: 'ArrowLeft' })
    expect(h.set).toHaveBeenCalledOnce()
    await act(async () => { fireEvent.keyDown(height, { key: 'Enter' }) })
    expect(h.set).toHaveBeenLastCalledWith('floatDefaultHeight', 450)
  })

  it.each([
    ['floatDefaultWidth', '', 'widthInvalid'], ['floatDefaultWidth', '199', 'widthInvalid'],
    ['floatDefaultWidth', '801', 'widthInvalid'], ['floatDefaultWidth', '400.5', 'widthInvalid'],
    ['floatDefaultHeight', '149', 'heightInvalid'], ['floatDefaultHeight', '601', 'heightInvalid'],
  ] as const)('rejects invalid %s draft %s without clamping or saving', async (field, draft, errorKey) => {
    const h = mount(accepted({ enabled: true }))
    const input = number(en[field])
    fireEvent.change(input, { target: { value: draft } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    expect(input.value).toBe(draft)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe(en[errorKey])
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe(field === 'floatDefaultWidth' ? '400' : '300')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['floatDefaultWidth', '200', 200], ['floatDefaultWidth', '800', 800],
    ['floatDefaultHeight', '150', 150], ['floatDefaultHeight', '600', 600],
  ] as const)('accepts the schema boundary %s=%s', async (field, draft, expected) => {
    const h = mount(accepted({ enabled: true }))
    const input = number(en[field])
    fireEvent.change(input, { target: { value: draft } })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).toHaveBeenCalledWith(field, expected)
  })

  it('keeps a rejected size draft for retry and suppresses duplicate submission while saving', async () => {
    const h = mount(accepted({ enabled: true }))
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    release.push(finish)
    h.set.mockReturnValueOnce(pending)
    const input = number(en.floatDefaultWidth)
    fireEvent.change(input, { target: { value: '530' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.disabled).toBe(true)
    fireEvent.blur(input)
    expect(h.set).toHaveBeenCalledOnce()
    h.publish({ writing: true })
    expect(number(en.floatDefaultHeight).disabled).toBe(true)
    await act(async () => { finish(); await pending })
    h.publish({ writing: false, writeFailed: true })
    expect(input.value).toBe('530')
    expect(input.disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toBe(en.writeFailed)
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('400')
  })

  it('does not resave unchanged dimensions or write while the accepted settings become locked', async () => {
    const initial = accepted({ enabled: true })
    const h = mount(initial)
    const input = number(en.floatDefaultWidth)
    await act(async () => { fireEvent.blur(input) })
    fireEvent.change(input, { target: { value: '450' } })
    fireEvent.change(input, { target: { value: '400' } })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '510' } })
    h.publish({ settings: { ...initial.settings, writable: false } })
    await act(async () => { fireEvent.blur(input) })
    expect(h.set).not.toHaveBeenCalled()
    expect(input.value).toBe('510')
  })

  it('locks preference editing in read-only mode without blocking an enabled app-window action', () => {
    const initial = accepted({ enabled: true })
    const h = mount({ ...initial, settings: { ...initial.settings, writable: false } })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true)
    expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
    expect(number(en.floatDefaultWidth).disabled).toBe(true)
    expect(button(en.open).disabled).toBe(false)
    fireEvent.click(button(en.open))
    expect(h.toggle).toHaveBeenCalledOnce()
    expect(h.props.close).not.toHaveBeenCalled()
  })

  it.each(['loading', 'unavailable', 'ready'] as const)('does not invent controls or defaults for %s without a value', (status) => {
    const initial = accepted()
    mount({ ...initial, settings: { ...initial.settings, status, value: undefined } })
    expect(screen.getByText(status === 'loading' ? en.loading : en.error)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(button(en.open).disabled).toBe(true)
  })

  it('reports actual open, blocked and unavailable phases and invokes the owning callbacks', () => {
    const h = mount(accepted({ enabled: true }))
    expect(screen.getByText(en.closed)).toBeTruthy()
    fireEvent.click(button(en.open))
    expect(h.toggle).toHaveBeenCalledOnce()
    h.publish({ phase: 'open' })
    expect(screen.getByText(en.opened)).toBeTruthy()
    fireEvent.click(button(en.close))
    expect(h.closeWindow).toHaveBeenCalledOnce()
    h.publish({ phase: 'blocked' })
    expect(screen.getByText(en.blocked)).toBeTruthy()
    expect(button(en.open).disabled).toBe(false)
    fireEvent.click(button(en.open))
    expect(h.toggle).toHaveBeenCalledTimes(2)
    h.publish({ phase: 'unavailable' })
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(button(en.open).disabled).toBe(true)
  })

  it('keeps Chinese runtime failures explicit even when the preference is disabled', () => {
    const h = mount({ ...accepted(), phase: 'unavailable', writeFailed: true }, zh)
    expect(screen.getByText(zh.unavailable)).toBeTruthy()
    expect(screen.queryByText(zh.disabled)).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(zh.writeFailed)
    h.publish({ phase: 'blocked', writeFailed: false, targetUnavailable: true })
    expect(screen.getByText(zh.blocked)).toBeTruthy()
    expect(screen.getByText(zh.initialSessionUnavailable)).toBeTruthy()
    expect(button(zh.open).disabled).toBe(true)
  })

  it('keeps child close available without launching and explains unavailable initial sessions', () => {
    const h = mount({ ...accepted(), child: true, phase: 'open', targetUnavailable: true })
    expect(screen.getByText(en.childWindow)).toBeTruthy()
    expect(screen.getByText(en.initialSessionUnavailable)).toBeTruthy()
    expect(button(en.close).disabled).toBe(false)
    fireEvent.click(button(en.close))
    expect(h.closeWindow).toHaveBeenCalledOnce()
    expect(h.toggle).not.toHaveBeenCalled()
    expect(h.props.close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('switch'))
    expect(h.set).toHaveBeenCalledWith('enabled', true)
    expect(h.toggle).not.toHaveBeenCalled()
  })
})
