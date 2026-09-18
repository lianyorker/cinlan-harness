/** Settings presentation for commands registered by actual keyboard consumers. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-keyboard/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { KeybindingsSection } from './KeybindingsSection.tsx'
import type { KeybindingsSectionInjected } from './KeybindingsSection.tsx'
import { en, zh, type KeybindingsKey } from './locales.ts'

export type { KeybindingsSectionInjected, KeybindingsSectionProps } from './KeybindingsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.keybindings': KeybindingsKey }
}

/** Required registries and the real keyboard command owner. */
export const inject = ['settingsMetadata', 'slots', 'locale', 'keyboard']

/**
 * Publish the page and localized command anchors with their slot lifetime.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  const ns = 'settings.keybindings'
  ctx.effect(() => ctx.locale.register(ns, { zh, en }), 'ui-keybindings: dictionaries')
  const t = ctx.locale.bind(ns)
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'keybindings', groupId: 'personal' })
    let removeItems: (() => void) | undefined
    const publish = (): void => {
      removeItems?.()
      removeItems = ctx.settingsMetadata.registerItems('keybindings', [
        { id: 'reset', anchorId: 'keybindings-reset', title: () => t('resetAll'), description: () => t('resetAllDescription') },
        ...ctx.keyboard.getSnapshot().commands.filter(command => command.registered).map(command => ({
          id: command.id, anchorId: 'keybinding-' + command.id,
          title: () => command.label, description: () => command.description,
        })),
      ])
    }
    publish()
    yield () => { removeItems?.() }
    yield ctx.keyboard.subscribe(publish)
    yield ctx.slots.register({
      name: 'settings.section', id: 'keybindings', order: 95, label: () => t('navLabel'), locale: ns,
      inject: (): KeybindingsSectionInjected => ({
        hooks: { keyboard: ctx.keyboard },
        captureKey: facts => ctx.keyboard.capture(facts),
        setBinding: (id, binding) => ctx.keyboard.setBinding(id, binding),
        resetBinding: id => ctx.keyboard.resetBinding(id),
        resetAll: () => ctx.keyboard.resetAll(),
      }),
    }, KeybindingsSection)
  })
}
