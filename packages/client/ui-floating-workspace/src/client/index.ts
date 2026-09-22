/** Floating app-window owner and native settings registration, using the existing app artifact. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-keyboard/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Config } from '../config.ts'
import type { FloatingWorkspaceSettings, ToggleButtonPosition } from '../types.ts'
import { FloatingWorkspaceSection, type FloatingWorkspaceSectionInjected } from './FloatingWorkspaceSection.tsx'
import { FloatingEntry, type FloatingEntryInjected } from './FloatingEntry.tsx'
import { FloatingRuntime } from './runtime.ts'
import { browserWindowEnvironment } from './window-environment.ts'
import { en, zh, type FloatingWorkspaceSettingsKey } from './locales.ts'

export { Config } from '../config.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.floatingWorkspace': FloatingWorkspaceSettingsKey }
}
declare module '@deepseek-ai/dsh-client-keyboard/client' {
  interface KeyboardCommandMap { 'floatingWorkspace.toggle': { scope: 'shell' } }
}

/** Dependencies keep registrations bound to the actual owners used by the feature. */
export const inject = ['settingsMetadata', 'slots', 'locale', 'settingsScope', 'keyboard', 'sessions', 'uiWorkspace']

/**
 * Own one app window, accepted preferences, command, and slot contributions.
 * @param ctx - Client feature fiber; components receive only framework sources and callbacks.
 * @param config - validated closed-window observation cadence.
 */
export function apply(ctx: Context, config: Config): void {
  const ns = 'settings.floatingWorkspace'
  ctx.effect(() => ctx.locale.register(ns, { en, zh }), 'floating workspace: dictionaries')
  const t = ctx.locale.bind(ns)
  const settings = ctx.settingsScope.bind<FloatingWorkspaceSettings>({ namespace: 'floating-workspace' })
  const environment = browserWindowEnvironment(window, () => ctx.sessions.list.getSnapshot().current, config.windowClosedPollMs)
  const runtime = new FloatingRuntime(settings, environment)
  ctx.effect(() => () => runtime.dispose(), 'floating workspace: exact app-window lifetime')
  ctx.provide('floatingWorkspaceContext', runtime.terminalContext)
  ctx.inject(['floatingTerminalConsumer'], (consumerCtx) => {
    consumerCtx.effect(() => {
      runtime.setDirectorySupported(true)
      return () => { runtime.setDirectorySupported(false) }
    }, 'floating workspace: real terminal consumer')
  })

  if (environment.child) {
    const target = environment.initialSession
    if (target !== undefined) {
      ctx.effect(() => {
        let resolved = false
        const select = () => {
          const catalog = ctx.sessions.list.getSnapshot()
          if (resolved || catalog.phase !== 'ready') return
          resolved = true
          const id = catalog.ids.find(candidate => candidate === target)
          if (id === undefined) runtime.setTargetUnavailable(true)
          else ctx.sessions.open(id)
        }
        const off = ctx.sessions.list.subscribe(select)
        select()
        return off
      }, 'floating workspace: initial catalog navigation')
    }
  } else {
    ctx.effect(() => ctx.keyboard.register({
      id: 'floatingWorkspace.toggle', scope: 'shell', label: () => t('toggle'), description: () => t('shortcutDescription'),
      defaultBindings: [{ key: ' ', modifiers: { ctrl: true, shift: true } }],
      available: { getSnapshot: runtime.available, subscribe: runtime.subscribe },
    }), 'floating workspace: keyboard command')
  }
  const settingsFace: FloatingWorkspaceSectionInjected = {
    hooks: { floating: runtime }, set: runtime.set, pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
  }
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'floating-workspace', groupId: 'personal' })
    yield ctx.settingsMetadata.registerItems('floating-workspace', [
      { id: 'enabled', anchorId: 'floating-enabled', title: () => t('enable'), description: () => t('enableDescription') },
      { id: 'directory', anchorId: 'floating-directory', title: () => t('terminalDirectory'), description: () => t('terminalDirectoryDescription') },
      { id: 'position', anchorId: 'floating-position', title: () => t('toggleButtonPosition'), description: () => t('toggleButtonPositionDescription') },
    ])
    yield ctx.slots.register({
      name: 'settings.section', id: 'floating-workspace', order: 100, label: () => t('navLabel'), locale: ns,
      inject: () => settingsFace,
    }, FloatingWorkspaceSection)
  })
  const entryFace = (position: ToggleButtonPosition): FloatingEntryInjected => ({
    hooks: { floating: runtime }, position, toggle: runtime.toggle, closeWindow: runtime.close,
    matchesShortcut: facts => !environment.child && ctx.keyboard.matches('floatingWorkspace.toggle', facts),
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'floating-workspace', order: 60, locale: ns, inject: () => entryFace('floating'),
  }, FloatingEntry))
  if (!environment.child) {
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities', id: 'floating-workspace', order: 70, locale: ns, inject: () => entryFace('header'),
    }, FloatingEntry))
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'floating-workspace', order: 50, locale: ns, inject: () => entryFace('sidebar'),
  }, FloatingEntry))
}
