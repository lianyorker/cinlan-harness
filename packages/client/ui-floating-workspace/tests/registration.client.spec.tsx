// @vitest-environment jsdom
/** Client registration unit composition with the real slot renderer; not a browser/Electron launch smoke. */
import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { KeyboardController } from '@deepseek-ai/dsh-client-keyboard/src/client/controller.ts'
import type { KeybindingsSettings } from '@deepseek-ai/dsh-client-keyboard/client'
import type { FloatingWorkspaceSettings } from '../src/types.ts'
import { apply, inject } from '../src/client/index.ts'
import { FloatingWorkspaceSection } from '../src/client/FloatingWorkspaceSection.tsx'
import { FloatingEntry } from '../src/client/FloatingEntry.tsx'
import { en, zh } from '../src/client/locales.ts'

const runtimes: SlotTestRuntime[] = []
let previousHref: string
let previousName: string
const owner = '14c870c0-723c-452d-8b64-ae51f00c950b'
const declarations = {
  'settings.section': { kind: 'list', scope: 'root' },
  'shell.overlay': { kind: 'list', scope: 'root' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
  'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
} as const

beforeEach(() => {
  previousHref = window.location.href
  previousName = window.name
  window.history.replaceState({}, '', '/workspace?temporary=not-carried#not-carried')
  window.name = ''
  vi.stubGlobal('opener', null)
  vi.spyOn(window, 'focus').mockImplementation(() => {})
  vi.spyOn(window, 'close').mockImplementation(() => {})
})
afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) {
    await runtime.dispose()
    await runtime.ctx.fiber.dispose()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', previousHref)
  window.name = previousName
})

function childRoute(session: string): void {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('dsh-floating-workspace', '1')
  url.searchParams.set('dsh-floating-owner', owner)
  url.searchParams.set('dsh-floating-session', session)
  window.history.replaceState({}, '', url)
  window.name = 'dsh-floating-workspace-' + owner
  vi.stubGlobal('opener', { closed: false, focus: vi.fn() })
}

async function bench(values: Partial<FloatingWorkspaceSettings> = {}) {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const floatingSource = stubSettingsScope<FloatingWorkspaceSettings>()
  const mutate = vi.fn<typeof floatingSource.scope.mutate>(async () => true)
  const floating = { ...floatingSource, mutate, scope: { ...floatingSource.scope, mutate } }
  floating.publish({
    status: 'ready', writable: true, mode: 'host', revision: 1,
    value: { enabled: false, terminalDirectory: '', toggleButtonPosition: 'header', floatDefaultWidth: 400,
      floatDefaultHeight: 300, ...values },
  })
  const keybindings = stubSettingsScope<KeybindingsSettings>()
  keybindings.publish({ status: 'ready', writable: true, mode: 'host', revision: 1, value: { overrides: [] } })
  const keyboard = new KeyboardController(keybindings.scope, false)
  const pickDirectory = vi.fn<() => Promise<string | null>>(async () => null)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const bind = vi.fn((spec: { namespace: string }) => {
    if (spec.namespace !== 'floating-workspace') throw new Error('Unexpected settings namespace: ' + spec.namespace)
    return floating.scope
  })
  await runtime.mount({ inject: ['slots'], apply(ctx: Context) {
    ctx.provide('locale', locale)
    ctx.slots.installLocale(locale)
    ctx.provide('keyboard', keyboard)
    ctx.provide('uiWorkspace', { pickDirectory } as never)
    // The settings transport is the only service double; its snapshot and boolean mutation are driven explicitly.
    ctx.provide('settingsScope', { bind } as never)
    ctx.effect(() => () => { keyboard.dispose() }, 'test keyboard lifetime')
    ctx.on('locale/change', () => { keyboard.refresh() })
  } })
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const start = () => runtime.mount({ inject, apply: (ctx: Context) => { apply(ctx, { windowClosedPollMs: 60_000 }) } })
  const accept = (patch: Partial<FloatingWorkspaceSettings>): void => {
    const current = floating.scope.getSnapshot()
    act(() => { floating.publish({ ...current, value: { ...current.value!, ...patch }, user: { ...current.user as object, ...patch } }) })
  }
  return { runtime, floating, keybindings, keyboard, locale, bind, open, pickDirectory, start, accept }
}

function windowHandle() {
  const handle = { closed: false, close: vi.fn(() => { handle.closed = true }) }
  // A WindowProxy is supplied only at the browser adapter's window.open seam, never to render props.
  return { handle, proxy: handle as unknown as Window }
}

describe('Floating Workspace client registration unit composition', () => {
  it('waits for owner slot declarations, mounts the real settings component and localizes metadata and commands', async () => {
    const h = await bench()
    await h.start()
    expect(h.runtime.slots.entries('settings.section')).toEqual([])
    expect(h.runtime.ctx.settingsMetadata.getSnapshot().sections).toEqual([])
    expect(h.bind).toHaveBeenCalledWith({ namespace: 'floating-workspace' })
    await h.runtime.declare(declarations)
    const section = h.runtime.slots.entries('settings.section')[0]!
    expect(section.component).toBe(FloatingWorkspaceSection)
    expect(section.options.id).toBe('floating-workspace')
    expect(resolveSlotLabel(section.options.label)).toBe(en.navLabel)
    expect(h.runtime.ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'floating-workspace', groupId: 'personal' }])
    const metadata = h.runtime.ctx.settingsMetadata.getSnapshot().items
    expect(metadata.map(item => item.anchorId)).toEqual([
      'floating-enabled', 'floating-directory', 'floating-position',
    ])
    expect(metadata.find(item => item.id === 'directory')?.description).toBe(en.terminalDirectoryDescription)
    for (const slot of ['shell.overlay', 'sidebar.footer.action', 'conversation.session.header.utilities'] as const) {
      expect(h.runtime.slots.entries(slot)[0]?.component).toBe(FloatingEntry)
    }
    const view = h.runtime.renderSlot('settings.section', { close: vi.fn() })
    expect(view.view.getByRole('switch', { name: en.enable }).getAttribute('aria-checked')).toBe('false')
    expect(view.view.getByRole<HTMLInputElement>('textbox', { name: en.terminalDirectory }).disabled).toBe(true)
    expect(h.keyboard.getSnapshot().commands.find(command => command.id === 'floatingWorkspace.toggle'))
      .toMatchObject({ label: en.toggle, scope: 'shell', status: 'unavailable', registered: true,
        bindings: [{ key: ' ', modifiers: { ctrl: true, shift: true } }] })
    const version = h.runtime.slots.getVersion('settings.section')
    await act(async () => { h.locale.setLocale('zh') })
    expect(view.view.getByRole('switch', { name: zh.enable })).toBeTruthy()
    expect(resolveSlotLabel(section.options.label)).toBe(zh.navLabel)
    expect(h.runtime.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(zh.enable)
    expect(h.keyboard.getSnapshot().commands[0]?.label).toBe(zh.toggle)
    expect(h.runtime.slots.getVersion('settings.section')).toBe(version)
  })

  it('exposes no global opening control while disabled and changes availability only after an accepted boolean mutation', async () => {
    const h = await bench()
    await h.runtime.declare(declarations)
    await h.start()
    const settings = h.runtime.renderSlot('settings.section', { close: vi.fn() })
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    const sidebar = h.runtime.renderSlot('sidebar.footer.action', { wide: true })
    expect(overlay.view.queryByRole('button', { name: en.toggle })).toBeNull()
    expect(sidebar.view.queryByRole('button', { name: en.toggle })).toBeNull()
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(h.open).not.toHaveBeenCalled()
    h.floating.mutate.mockResolvedValueOnce(false)
    fireEvent.click(settings.view.getByRole('switch', { name: en.enable }))
    await h.runtime.flush()
    expect(settings.view.getByRole('alert').textContent).toBe(en.writeFailed)
    expect(settings.view.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    h.floating.mutate.mockImplementationOnce(async (ops) => {
      expect(ops).toEqual([{ op: 'set', path: ['enabled'], value: true }])
      h.accept({ enabled: true })
      return true
    })
    fireEvent.click(settings.view.getByRole('switch', { name: en.enable }))
    await h.runtime.flush()
    expect(settings.view.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(h.keyboard.getSnapshot().commands[0]?.status).toBe('available')
    expect(h.open).not.toHaveBeenCalled()
    h.accept({ toggleButtonPosition: 'sidebar' })
    expect(sidebar.view.getByRole('button', { name: en.toggle })).toBeTruthy()
    expect(overlay.view.queryByRole('button', { name: en.toggle })).toBeNull()
    const { handle, proxy } = windowHandle()
    h.open.mockReturnValue(proxy)
    fireEvent.click(sidebar.view.getByRole('button', { name: en.toggle }))
    expect(h.open).toHaveBeenCalledOnce()
    const [url, name, features] = h.open.mock.calls[0]!
    const target = new URL(String(url))
    expect(target.origin).toBe(window.location.origin)
    expect(target.pathname).toBe(window.location.pathname)
    expect([...target.searchParams.keys()]).toEqual(['dsh-floating-workspace', 'dsh-floating-owner'])
    expect(target.hash).toBe('')
    const targetOwner = target.searchParams.get('dsh-floating-owner')
    if (targetOwner === null) throw new Error('Floating route has no owner id')
    expect(name).toBe('dsh-floating-workspace-' + targetOwner)
    expect(features).toBe('popup=yes,width=400,height=300')
    expect(settings.view.queryByRole('button', { name: en.close })).toBeNull()
    fireEvent.click(sidebar.view.getByRole('button', { name: en.toggle }))
    expect(handle.close).toHaveBeenCalledOnce()
  })

  it('renders the real header entry in the framework SessionProvider and opens the current catalog session', async () => {
    const h = await bench({ enabled: true })
    await h.runtime.sessions.add({ id: 'header-session' }, { current: true })
    await h.runtime.root.declare({
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    }, ({ renderSlot, SessionProvider }) => <SessionProvider>{renderSlot('conversation.session.header.utilities', {})}</SessionProvider>)
    await h.start()
    const view = h.runtime.renderRoot()
    fireEvent.click(view.getByRole('button', { name: en.toggle }))
    expect(h.open).toHaveBeenCalledOnce()
    expect(new URL(String(h.open.mock.calls[0]![0])).searchParams.get('dsh-floating-session')).toBe('header-session')
    h.accept({ toggleButtonPosition: 'sidebar' })
    expect(view.queryByRole('button', { name: en.toggle })).toBeNull()
  })

  it('does not force catalog selection in a child without an initial session target', async () => {
    childRoute('unused-target')
    const url = new URL(window.location.href)
    url.searchParams.delete('dsh-floating-session')
    window.history.replaceState({}, '', url)
    const h = await bench({ enabled: true })
    await h.runtime.sessions.add({ id: 'existing-session' }, { current: false })
    await h.runtime.declare(declarations)
    await h.start()
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    expect(h.runtime.sessions.calls).toEqual([])
    expect(overlay.view.queryByRole('status')).toBeNull()
    const sidebar = h.runtime.renderSlot('sidebar.footer.action', { wide: false })
    expect(sidebar.view.getByRole('button', { name: en.close })).toBeTruthy()
    expect(h.runtime.ctx.floatingWorkspaceContext()).toEqual({ windowId: owner, status: 'ready', directory: '' })
  })

  it('uses the current keyboard override and reports blocked windows through the registered real entry', async () => {
    const h = await bench({ enabled: true, toggleButtonPosition: 'floating' })
    await h.runtime.declare(declarations)
    await h.start()
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(h.open).toHaveBeenCalledOnce()
    expect(overlay.view.getByRole('alert').textContent).toBe(en.blocked)
    await act(async () => {
      h.keybindings.publish({ value: { overrides: [{ commandId: 'floatingWorkspace.toggle', binding: { key: 'k', modifiers: { ctrl: true } } }] } })
    })
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(h.open).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(h.open).toHaveBeenCalledTimes(2)
  })

  it('removes slots, search metadata, command, settings listeners and exact owned window on disposal, then registers once on reload', async () => {
    const h = await bench({ enabled: true, toggleButtonPosition: 'floating' })
    await h.runtime.declare(declarations)
    const first = await h.start()
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    const { handle, proxy } = windowHandle()
    h.open.mockReturnValue(proxy)
    fireEvent.click(overlay.view.getByRole('button', { name: en.toggle }))
    expect(h.floating.listenerCount()).toBe(1)
    await first.dispose()
    expect(handle.close).toHaveBeenCalledOnce()
    expect(h.floating.listenerCount()).toBe(0)
    expect(h.runtime.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(h.keyboard.getSnapshot().commands).toEqual([])
    expect(h.runtime.slots.entries('settings.section')).toEqual([])
    expect(h.runtime.slots.entries('shell.overlay')).toEqual([])
    expect(h.runtime.slots.entries('sidebar.footer.action')).toEqual([])
    expect(h.runtime.slots.entries('conversation.session.header.utilities')).toEqual([])
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(h.open).toHaveBeenCalledOnce()
    const next = await h.start()
    expect(h.runtime.slots.entries('settings.section')).toHaveLength(1)
    expect(h.runtime.ctx.settingsMetadata.getSnapshot().items).toHaveLength(3)
    expect(h.keyboard.getSnapshot().commands).toHaveLength(1)
    expect(h.floating.listenerCount()).toBe(1)
    expect(overlay.view.getByRole('button', { name: en.toggle })).toBeTruthy()
    await next.dispose()
    expect(h.floating.listenerCount()).toBe(0)
  })

  it.each([true, false])('keeps child Close in the sidebar (wide=%s), suppresses recursive opening, and selects the existing target once', async (wide) => {
    childRoute('session-a')
    const h = await bench({ enabled: true })
    await h.runtime.sessions.add({ id: 'session-a' }, { current: false })
    const other = await h.runtime.sessions.add({ id: 'session-b' }, { current: false })
    h.runtime.sessions.list.update((state) => { state.phase = 'pending' })
    await h.runtime.declare(declarations)
    await h.start()
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    const sidebar = h.runtime.renderSlot('sidebar.footer.action', { wide })
    expect(sidebar.view.getByRole('button', { name: en.close })).toBeTruthy()
    expect(sidebar.view.queryByRole('button', { name: en.toggle })).toBeNull()
    expect(h.keyboard.getSnapshot().commands).toEqual([])
    expect(h.runtime.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(overlay.view.queryByRole('button', { name: en.toggle })).toBeNull()
    expect(h.runtime.sessions.calls.filter(call => call.method === 'open')).toEqual([])
    await act(async () => { h.runtime.sessions.list.update((state) => { state.phase = 'ready' }) })
    expect(h.runtime.sessions.calls.filter(call => call.method === 'open')).toEqual([{ method: 'open', args: ['session-a'] }])
    await act(async () => { h.runtime.sessions.list.update((state) => { state.current = other }) })
    expect(h.runtime.sessions.list.getSnapshot().current).toBe(other)
    expect(h.runtime.sessions.calls.filter(call => call.method === 'open')).toHaveLength(1)
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(h.open).not.toHaveBeenCalled()
    fireEvent.click(sidebar.view.getByRole('button', { name: en.close }))
    expect(window.close).toHaveBeenCalledOnce()
  })

  it('gates directory controls with the real consumer marker lifetime while main windows expose no child context', async () => {
    const h = await bench({ enabled: true, terminalDirectory: '/accepted' })
    await h.runtime.declare(declarations)
    await h.start()
    const settings = h.runtime.renderSlot('settings.section', { close: vi.fn() })
    const directory = settings.view.getByRole<HTMLInputElement>('textbox', { name: en.terminalDirectory })
    expect(directory.disabled).toBe(true)
    expect(h.runtime.ctx.floatingWorkspaceContext()).toBeUndefined()
    const consumer = await h.runtime.mount({ apply(ctx: Context) { ctx.provide('floatingTerminalConsumer', true) } })
    expect(directory.disabled).toBe(false)
    expect(settings.view.getByText(en.terminalDirectoryDescription)).toBeTruthy()
    h.floating.mutate.mockImplementationOnce(async (ops) => {
      expect(ops).toEqual([{ op: 'set', path: ['terminalDirectory'], value: '/accepted/nested' }])
      h.accept({ terminalDirectory: '/accepted/nested' })
      return true
    })
    fireEvent.change(directory, { target: { value: '/accepted/nested' } })
    expect(h.floating.mutate).not.toHaveBeenCalled()
    await act(async () => { fireEvent.blur(directory) })
    expect(h.floating.mutate).toHaveBeenCalledOnce()
    h.pickDirectory.mockResolvedValueOnce('/accepted/picked')
    h.floating.mutate.mockImplementationOnce(async (ops) => {
      expect(ops).toEqual([{ op: 'set', path: ['terminalDirectory'], value: '/accepted/picked' }])
      h.accept({ terminalDirectory: '/accepted/picked' })
      return true
    })
    fireEvent.click(settings.view.getByRole('button', { name: en.terminalDirectoryPick }))
    await h.runtime.flush()
    expect(directory.value).toBe('/accepted/picked')
    await consumer.dispose()
    expect(directory.disabled).toBe(true)
    expect(directory.value).toBe('/accepted/picked')
    expect(settings.view.getByText(en.terminalDirectoryUnavailable)).toBeTruthy()
    expect(h.runtime.ctx.floatingWorkspaceContext()).toBeUndefined()
  })

  it('keeps a validated child window identity while preferences load, then reports only current accepted directory context', async () => {
    childRoute('session-a')
    const h = await bench({ enabled: true, terminalDirectory: '/accepted' })
    h.floating.publish({ status: 'loading', value: undefined })
    await h.runtime.sessions.add({ id: 'session-a' }, { current: false })
    const feature = await h.start()
    const context = h.runtime.ctx.floatingWorkspaceContext
    expect(context()).toEqual({ windowId: owner, status: 'loading' })
    await act(async () => {
      h.floating.publish({ status: 'ready', value: { enabled: true, terminalDirectory: '/accepted',
        toggleButtonPosition: 'header', floatDefaultWidth: 400, floatDefaultHeight: 300 } })
    })
    expect(context()).toEqual({ windowId: owner, status: 'ready', directory: '/accepted' })
    h.accept({ terminalDirectory: '' })
    expect(context()).toEqual({ windowId: owner, status: 'ready', directory: '' })
    await act(async () => { h.floating.publish({ status: 'unavailable', value: undefined }) })
    expect(context()).toEqual({ windowId: owner, status: 'unavailable' })
    await feature.dispose()
    expect(h.runtime.ctx.get('floatingWorkspaceContext')).toBeUndefined()
  })

  it('reports a missing child target without creating or later guessing a session', async () => {
    childRoute('missing-session')
    const h = await bench({ enabled: true })
    await h.runtime.sessions.add({ id: 'existing-session' }, { current: false })
    await h.runtime.declare(declarations)
    await h.start()
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    expect(overlay.view.getByRole('status').textContent).toBe(en.initialSessionUnavailable)
    expect(h.runtime.sessions.calls).toEqual([])
    await h.runtime.sessions.add({ id: 'missing-session' }, { current: false })
    expect(h.runtime.sessions.calls).toEqual([])
    expect(overlay.view.getByRole('status').textContent).toBe(en.initialSessionUnavailable)
  })
})
