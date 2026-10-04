/** Floating workspace owner: an in-app chat panel, its entries, and its settings. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-keyboard/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { FloatingWorkspaceSettings, ToggleButtonPosition } from '../types.ts'
import { FLOATING_WORKSPACE_NAMESPACE } from '../schema.ts'
import { FloatingWorkspaceSection, type FloatingWorkspaceSectionInjected } from './FloatingWorkspaceSection.tsx'
import { FloatingChat } from './FloatingChat.tsx'
import { FloatingPanel, type FloatingPanelInjected } from './FloatingPanel.tsx'
import { FloatingTab } from './FloatingTab.tsx'
import { FloatingEntry, type FloatingEntryInjected } from './FloatingEntry.tsx'
import { FloatingRuntime, type FloatingPanelEnvironment } from './runtime.ts'
import { en, zh, type FloatingWorkspaceSettingsKey } from './locales.ts'

export { Config } from '../config.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.floatingWorkspace': FloatingWorkspaceSettingsKey }
}
declare module '@deepseek-ai/dsh-client-keyboard/client' {
  interface KeyboardCommandMap { 'floatingWorkspace.toggle': { scope: 'shell' } }
}

/** Stable identity of the right-Sidebar tab body. */
export const SIDEBAR_TAB_ID = '@deepseek-ai/dsh-client-ui-floating-workspace'

/** Page kind the right-Sidebar opens for the pinned chat. */
export const SIDEBAR_TAB_KIND = 'floatingWorkspace'

/** Dependencies keep registrations bound to the actual owners used by the feature. */
export const inject = ['settingsMetadata', 'slots', 'locale', 'settingsScope', 'keyboard', 'sessions', 'uiWorkspace', 'sidebarRightTabs', 'sidebarRight']

/**
 * Own the panel, accepted preferences, command, and slot contributions.
 * @param ctx - Client feature fiber; components receive only framework sources and callbacks.
 */
export function apply(ctx: Context): void {
  const ns = 'settings.floatingWorkspace'
  ctx.effect(() => ctx.locale.register(ns, { en, zh }), 'floating workspace: dictionaries')
  const t = ctx.locale.bind(ns)
  const settings = ctx.settingsScope.bind<FloatingWorkspaceSettings>({ namespace: FLOATING_WORKSPACE_NAMESPACE })
  // The panel lives in this renderer: no separate app window is opened, so the
  // environment reports only that the platform can host it.
  const environment: FloatingPanelEnvironment = { supported: true, readWindowId: () => undefined }
  const runtime = new FloatingRuntime(settings, environment)
  ctx.effect(() => () => runtime.dispose(), 'floating workspace: exact panel lifetime')
  ctx.provide('floatingWorkspaceContext', runtime.terminalContext)
  ctx.inject(['floatingTerminalConsumer'], (consumerCtx) => {
    consumerCtx.effect(() => {
      runtime.setDirectorySupported(true)
      return () => { runtime.setDirectorySupported(false) }
    }, 'floating workspace: real terminal consumer')
  })

  ctx.effect(() => ctx.keyboard.register({
    id: 'floatingWorkspace.toggle', scope: 'shell', label: () => t('toggle'), description: () => t('shortcutDescription'),
    defaultBindings: [{ key: ' ', modifiers: { ctrl: true, shift: true } }],
    available: { getSnapshot: runtime.available, subscribe: runtime.subscribe },
  }), 'floating workspace: keyboard command')

  const settingsFace: FloatingWorkspaceSectionInjected = { hooks: { floating: runtime }, set: runtime.set }
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'floating-workspace', groupId: 'personal' })
    yield ctx.settingsMetadata.registerItems('floating-workspace', [
      { id: 'enabled', anchorId: 'floating-enabled', title: () => t('enable'), description: () => t('enableDescription') },
      { id: 'position', anchorId: 'floating-position', title: () => t('toggleButtonPosition'), description: () => t('toggleButtonPositionDescription') },
    ])
    yield ctx.slots.register({
      name: 'settings.section', id: 'floating-workspace', order: 100, label: () => t('navLabel'), locale: ns,
      inject: () => settingsFace,
    }, FloatingWorkspaceSection)
  })

  const entryFace = (position: ToggleButtonPosition): FloatingEntryInjected => ({
    hooks: { floating: runtime }, position,
    // The header entry pins the chat as a docked right-Sidebar tab; the floating
    // entry opens the panel above the conversation.
    toggle: position === 'header'
      ? () => { ctx.sidebarRight.openTab(SIDEBAR_TAB_KIND, { revealIfOpened: true }) }
      : runtime.toggle,
    matchesShortcut: facts => ctx.keyboard.matches('floatingWorkspace.toggle', facts),
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'floating-workspace', order: 60, locale: ns, inject: () => entryFace('floating'),
  }, FloatingEntry))
  // The panel lives inside the Conversation's Session area so the embedded
  // occurrence renders with the Conversation provide and the Session binding
  // the seat already carries; its own CSS keeps it floating over the column.
  ctx.slots.inject('conversation.session.header.utilities', function* () {
    yield ctx.slots.register({
      name: 'conversation.session.header.utilities', id: 'floating-workspace.panel', order: 71, locale: ns,
      children: { 'floatingWorkspace.chat': { kind: 'single', scope: 'session' } },
      inject: (): FloatingPanelInjected => ({ hooks: { floating: runtime }, close: () => { runtime.close() } }),
    }, FloatingPanel)
    yield ctx.slots.register({
      name: 'conversation.session.header.utilities', id: 'floating-workspace', order: 70, locale: ns, inject: () => entryFace('header'),
    }, FloatingEntry)
  })
  ctx.slots.inject('floatingWorkspace.chat', () => ctx.slots.register({ name: 'floatingWorkspace.chat' }, FloatingChat))
  // The second form: the same chat docked in the right Sidebar, opened by kind.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: SIDEBAR_TAB_ID, kind: SIDEBAR_TAB_KIND, priority: 'builtin', keepMounted: true,
    title: () => t('title'),
  }), 'floating workspace: Sidebar tab type')
  ctx.effect(() => ctx.slots.inject('floatingWorkspace.tab.chat', () => ctx.slots.register(
    { name: 'floatingWorkspace.tab.chat' }, FloatingChat,
  )), 'floating workspace: Sidebar chat body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: SIDEBAR_TAB_KIND,
    children: { 'floatingWorkspace.tab.chat': { kind: 'single', scope: 'session' } },
  }, FloatingTab)), 'floating workspace: Sidebar tab body')
}
