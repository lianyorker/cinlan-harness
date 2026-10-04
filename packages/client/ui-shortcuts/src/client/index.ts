/** Shortcut reference plugin; one dialog and one settings page share a declared store. */
import type { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-keyboard/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createShortcutsStore } from './store.ts'
import { ShortcutReference, ShortcutSettingsPage } from './Reference.tsx'
import { en, zh } from './locales.ts'
import { fixedCommands } from './fixed.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shortcut reference and settings page copy. */
    shortcuts: keyof typeof zh
  }
}

/** Required command, keyboard, locale, slot, and settings-metadata services. */
export const inject = ['shortcuts', 'keyboard', 'locale', 'slots', 'settingsMetadata']

/**
 * Register the reference command, its Settings page, and the single shell overlay.
 * @param ctx - plugin-owned client context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('shortcuts', { zh, en }), 'shortcuts: dictionaries')
  const t = ctx.locale.bind('shortcuts')
  const handle = createShortcutsStore()
  const instance = handle.create()
  const store: typeof handle = { ...handle, create: () => instance }
  const edit: typeof ctx.shortcuts.edit = (...args) => ctx.shortcuts.edit(...args)
  const recording = (active: boolean) => ctx.shortcuts.recording(active)
  const describeBinding: typeof ctx.shortcuts.describeBinding = binding => ctx.shortcuts.describeBinding(binding)
  for (const command of fixedCommands(t)) {
    ctx.effect(() => ctx.shortcuts.registerFixed(command), `shortcuts: ${command.id}`)
  }
  const injected = () => ({ platform: ctx.shortcuts.platform, runtime: ctx.shortcuts.runtime, edit, recording, describeBinding,
    captureKey: (facts: Parameters<typeof ctx.keyboard.capture>[0]) => ctx.keyboard.capture(facts),
    setBinding: (id: string, binding: Parameters<typeof ctx.keyboard.setBinding>[1]) => ctx.keyboard.setBinding(id, binding),
    resetBinding: (id: string) => ctx.keyboard.resetBinding(id),
    resetAll: () => ctx.keyboard.resetAll(),
    hooks: { catalog: ctx.shortcuts.catalog, config: ctx.shortcuts.config, fixedCatalog: ctx.shortcuts.fixedCatalog,
      keyboard: ctx.keyboard } })
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'keybindings', groupId: 'personal' })
    yield ctx.effect(() => {
      let live = true
      let removeItems: (() => void) | undefined
      const publish = (): void => {
        if (!live) return
        removeItems?.()
        removeItems = ctx.settingsMetadata.registerItems('keybindings', [
          { id: 'reset', anchorId: 'shortcut-reset', title: () => t('reset-all'), description: () => t('reset-description') },
          ...ctx.shortcuts.catalog.getSnapshot().map(row => ({
            id: row.id, anchorId: 'shortcut-' + row.id, title: () => row.label,
          })),
          ...ctx.keyboard.getSnapshot().commands.filter(command => command.registered).map(command => ({
            id: command.id, anchorId: 'keybinding-' + command.id, title: () => command.label, description: () => command.description,
          })),
        ])
      }
      publish()
      const offCatalog = ctx.shortcuts.catalog.subscribe(publish)
      const offKeyboard = ctx.keyboard.subscribe(publish)
      return () => { live = false; offCatalog(); offKeyboard(); removeItems?.() }
    }, 'shortcuts: settings search items')
    yield ctx.slots.register({
      name: 'settings.section', id: 'keybindings', order: 95, label: () => t('navLabel'), locale: 'shortcuts', store,
      inject: injected,
    }, ShortcutSettingsPage)
  })
  ctx.slots.inject('shell.overlay', () => {
    const disposeCommand = ctx.shortcuts.register({
      id: 'shortcuts.open' as ShortcutCommandId, label: () => t('open'), aliases: ['shortcuts', 'keyboard shortcuts'],
      defaults: {
        'desktop:macos': { code: 'Slash', modifiers: ['primary'] },
        'desktop:windows': { code: 'Slash', modifiers: ['primary'] },
        'desktop:linux': { code: 'Slash', modifiers: ['primary'] },
        'web:macos': { code: 'Slash', modifiers: ['primary'] },
        'web:windows': { code: 'Slash', modifiers: ['primary'] },
        'web:linux': { code: 'Slash', modifiers: ['primary'] },
      },
      regions: ['page', 'editable', 'terminal'], modals: ['settings', 'shortcuts'],
      resolve: ({ modal }) => {
        if (modal !== null && modal !== 'settings' && modal !== 'shortcuts') return { status: 'blocked', reason: 'modal' }
        return { status: 'handled', run: () => {
          if (modal === 'shortcuts') closeTopModal(document)
          else instance.actions.open()
        } }
      },
    })
    const disposeSlot = ctx.slots.register({
      name: 'shell.overlay', id: 'shortcuts', locale: 'shortcuts', store,
      inject: injected,
    }, ShortcutReference)
    return () => { disposeCommand(); disposeSlot() }
  })
}
