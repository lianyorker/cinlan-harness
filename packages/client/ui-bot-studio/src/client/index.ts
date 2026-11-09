/**
 * Bot-studio surface plugin, browser half — one settings section over the
 * bot-registry namespace: the roster, the non-technical form editor, and the
 * change audit. Reads go through the settings controller's describe; writes
 * merge the section through the settings controller, and the host converges
 * preset registrations on config reload.
 */

// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { BotStudioSection } from './BotStudioSection.tsx'
import type { BotStudioInjected } from './BotStudioSection.tsx'
import { BotStudioController, type BotDraft } from './bot-store.ts'
import { locales, type BotStudioKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Bot-studio surface copy. */
    'settings.botStudio': BotStudioKey
  }
}

export type { BotStudioInjected, BotStudioProps } from './BotStudioSection.tsx'
export type { BotStudioState, BotDraft } from './bot-store.ts'
export { BOT_REGISTRY_SETTINGS_NS } from './bot-store.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'settingsMetadata']

/**
 * Mount the bot-studio settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.botStudio', { zh: locales.zh, en: locales.en }), 'ui-bot-studio: section dictionaries')
  const controller = new BotStudioController(ctx)

  const sectionInjected = (): BotStudioInjected => ({
    hooks: { studio: controller.store },
    load: () => { void controller.load() },
    openCreate: () => controller.openCreate(),
    openEdit: (botId: string) => controller.openEdit(botId),
    closeEditor: () => controller.closeEditor(),
    patchDraft: (patch: Partial<BotDraft>) => controller.patchDraft(patch),
    save: () => controller.save(),
    remove: (botId: string) => controller.remove(botId),
  })

  // Settings sections sit beside the other composition surfaces; ordering
  // after the agent-preset section keeps composition topics together.
  ctx.slots.inject('settings.section', function* () {
    const pageT = ctx.locale.bind('settings.botStudio')
    yield ctx.settingsMetadata.registerSection({
      sectionId: 'bot-studio', groupId: 'ai', description: () => pageT('sectionIntro'),
    })
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'bot-studio',
      order: 21,
      label: () => pageT('nav'),
      locale: 'settings.botStudio',
      inject: sectionInjected,
    }, BotStudioSection)
  })
}
