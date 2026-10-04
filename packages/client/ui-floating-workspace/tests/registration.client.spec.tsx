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
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { FloatingWorkspaceSettings } from '../src/types.ts'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { apply, inject } from '../src/client/index.ts'
import { FloatingWorkspaceSection } from '../src/client/FloatingWorkspaceSection.tsx'
import { FloatingEntry } from '../src/client/FloatingEntry.tsx'
import { FloatingPanel } from '../src/client/FloatingPanel.tsx'
import { FloatingChat } from '../src/client/FloatingChat.tsx'
import { FloatingTab } from '../src/client/FloatingTab.tsx'
import { en, zh } from '../src/client/locales.ts'

const runtimes: SlotTestRuntime[] = []
let previousHref: string
let previousName: string
const declarations = {
  'settings.section': { kind: 'list', scope: 'root' },
  'shell.overlay': { kind: 'list', scope: 'root' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
  'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
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
  const openTab = vi.fn()
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const bind = vi.fn((spec: { namespace: string }) => {
    if (spec.namespace !== 'ui-floating-workspace') throw new Error('Unexpected settings namespace: ' + spec.namespace)
    return floating.scope
  })
  await runtime.mount({ inject: ['slots'], apply(ctx: Context) {
    new SettingsMetadataService(ctx)
    ctx.provide('locale', locale)
    ctx.slots.installLocale(locale)
    ctx.provide('keyboard', keyboard)
    ctx.provide('uiWorkspace', { pickDirectory, openSession: vi.fn() } as never)
    ctx.provide('sidebarRightTabs', { register: vi.fn(() => () => {}) } as never)
    ctx.provide('sidebarRight', { openTab } as never)
    // The settings transport is the only service double; its snapshot and boolean mutation are driven explicitly.
    ctx.provide('settingsScope', { bind } as never)
    ctx.effect(() => () => { keyboard.dispose() }, 'test keyboard lifetime')
    ctx.on('locale/change', () => { keyboard.refresh() })
  } })
  // A new window must never appear: the feature owns an in-app panel.
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const start = () => runtime.mount({ inject, apply: (ctx: Context) => { apply(ctx) } })
  const accept = (patch: Partial<FloatingWorkspaceSettings>): void => {
    const current = floating.scope.getSnapshot()
    act(() => { floating.publish({ ...current, value: { ...current.value!, ...patch }, user: { ...current.user as object, ...patch } }) })
  }
  return { runtime, floating, keybindings, keyboard, locale, bind, open, openTab, pickDirectory, start, accept }
}

/**
 * Declare the seats the feature contributes to with one bound Session, so the
 * Session-scoped panel renders where the real app renders it.
 * @param h - the benchmark fixture.
 */
async function declareWithSession(h: Awaited<ReturnType<typeof bench>>): Promise<void> {
  await h.runtime.sessions.add({ id: 'panel-session' })
  const reference = h.runtime.sessions.retain('panel-session' as SessionTarget)
  // The header entry is the docked form: it opens the right-Sidebar page kind.
  await reference.ready
  await h.runtime.root.declare({
    'shell.overlay': { kind: 'list', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
  }, ({ renderSlot, SessionProvider }) => <>
    <SessionProvider session={reference}>{renderSlot('conversation.session.header.utilities', {})}</SessionProvider>
    {renderSlot('shell.overlay', {})}
    {renderSlot('settings.section', { close: () => {} })}
  </>)
}

describe('Floating Workspace client registration unit composition', () => {
  it('waits for owner slot declarations, mounts the real settings component and localizes metadata and commands', async () => {
    const h = await bench()
    await h.start()
    expect(h.runtime.slots.entries('settings.section')).toEqual([])
    expect(h.runtime.ctx.settingsMetadata.getSnapshot().sections).toEqual([])
    expect(h.bind).toHaveBeenCalledWith({ namespace: 'ui-floating-workspace' })
    await h.runtime.declare(declarations as never)
    const section = h.runtime.slots.entries('settings.section')[0]!
    expect(section.component).toBe(FloatingWorkspaceSection)
    expect(section.options.id).toBe('floating-workspace')
    expect(resolveSlotLabel(section.options.label)).toBe(en.navLabel)
    expect(h.runtime.ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'floating-workspace', groupId: 'personal' }])
    const metadata = h.runtime.ctx.settingsMetadata.getSnapshot().items
    expect(metadata.map(item => item.anchorId)).toEqual([
      'floating-enabled', 'floating-position',
    ])
    expect(h.runtime.slots.entries('shell.overlay')[0]?.component).toBe(FloatingEntry)
    expect(h.runtime.slots.entries('conversation.session.header.utilities').map(entry => entry.component))
      .toEqual([FloatingEntry, FloatingPanel])
    expect(h.runtime.slots.entries('floatingWorkspace.chat')[0]?.component).toBe(FloatingChat)
    expect(h.runtime.slots.entries('sidebar.right.pane.tab')[0]?.component).toBe(FloatingTab)
    expect(h.runtime.slots.entries('floatingWorkspace.tab.chat')[0]?.component).toBe(FloatingChat)
    const view = h.runtime.renderSlot('settings.section', { close: vi.fn() })
    expect(view.view.getByRole('switch', { name: en.enable }).getAttribute('aria-checked')).toBe('false')
    expect(view.view.queryByRole('textbox')).toBeNull()
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

  it('exposes no opening control while disabled and follows an accepted enable', async () => {
    const h = await bench()
    await h.runtime.declare(declarations as never)
    await h.start()
    const settings = h.runtime.renderSlot('settings.section', { close: vi.fn() })
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    expect(overlay.view.queryByRole('button', { name: en.toggle })).toBeNull()
    h.floating.mutate.mockImplementationOnce(async (ops) => {
      expect(ops).toEqual([{ op: 'set', path: ['enabled'], value: true }])
      h.accept({ enabled: true, toggleButtonPosition: 'floating' })
      return true
    })
    fireEvent.click(settings.view.getByRole('switch', { name: en.enable }))
    await h.runtime.flush()
    expect(settings.view.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(h.keyboard.getSnapshot().commands[0]?.status).toBe('available')
    expect(overlay.view.getByRole('button', { name: en.toggle })).toBeTruthy()
    expect(h.open).not.toHaveBeenCalled()
  })

  it('opens the in-app panel from the seat the app renders it in, never a second window, and closes it in place', async () => {
    const h = await bench({ enabled: true, toggleButtonPosition: 'floating' })
    await declareWithSession(h)
    await h.start()
    const view = h.runtime.renderRoot()
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: en.toggle }))
    expect(h.open).not.toHaveBeenCalled()
    expect(view.getByRole('dialog', { name: en.title })).toBeTruthy()
    expect(view.getByRole('button', { name: en.toggle }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: en.close }))
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('docks the chat from the header entry by opening the right-Sidebar page kind', async () => {
    const h = await bench({ enabled: true })
    await declareWithSession(h)
    await h.start()
    const view = h.runtime.renderRoot()
    fireEvent.click(view.getByRole('button', { name: en.toggle }))
    expect(h.open).not.toHaveBeenCalled()
    expect(h.openTab).toHaveBeenCalledWith('floatingWorkspace', { revealIfOpened: true })
    h.accept({ toggleButtonPosition: 'floating' })
    expect(view.getByRole('button', { name: en.toggle })).toBeTruthy()
  })

  it('follows the current keyboard override and its availability', async () => {
    const h = await bench({ enabled: true, toggleButtonPosition: 'floating' })
    await declareWithSession(h)
    await h.start()
    const view = h.runtime.renderRoot()
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(h.open).not.toHaveBeenCalled()
    expect(view.getByRole('dialog', { name: en.title })).toBeTruthy()
    await act(async () => {
      h.keybindings.publish({ value: { overrides: [{ commandId: 'floatingWorkspace.toggle', binding: { key: 'k', modifiers: { ctrl: true } } }] } })
    })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('removes slots, search metadata, command and settings listeners on disposal, then registers once on reload', async () => {
    const h = await bench({ enabled: true, toggleButtonPosition: 'floating' })
    await h.runtime.declare(declarations as never)
    const first = await h.start()
    const overlay = h.runtime.renderSlot('shell.overlay', {})
    fireEvent.click(overlay.view.getByRole('button', { name: en.toggle }))
    expect(h.floating.listenerCount()).toBe(1)
    await first.dispose()
    expect(h.floating.listenerCount()).toBe(0)
    expect(h.runtime.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(h.keyboard.getSnapshot().commands).toEqual([])
    expect(h.runtime.slots.entries('settings.section')).toEqual([])
    expect(h.runtime.slots.entries('shell.overlay')).toEqual([])
    expect(h.runtime.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(h.open).not.toHaveBeenCalled()
    const next = await h.start()
    expect(h.runtime.slots.entries('settings.section')).toHaveLength(1)
    expect(h.runtime.ctx.settingsMetadata.getSnapshot().items).toHaveLength(2)
    expect(h.keyboard.getSnapshot().commands).toHaveLength(1)
    expect(h.floating.listenerCount()).toBe(1)
    expect(overlay.view.getByRole('button', { name: en.toggle })).toBeTruthy()
    await next.dispose()
    expect(h.floating.listenerCount()).toBe(0)
  })

  it('reports no window identity for this renderer', async () => {
    const h = await bench({ enabled: true })
    await h.runtime.declare(declarations as never)
    await h.start()
    expect(h.runtime.ctx.floatingWorkspaceContext()).toBeUndefined()
  })
})
