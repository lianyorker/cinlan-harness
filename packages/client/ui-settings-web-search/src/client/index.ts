/**
 * The web-search provider's settings page, browser half: the key, the
 * endpoint, and the per-request search budget over the `web-search-deepseek`
 * namespace the provider registers. The page registers into the Plugins
 * page's `plugins.item` slot while the Host serves that namespace, so a
 * deployment without the provider shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { WebSearchCard, WebSearchSettingsSection } from './WebSearchCard.tsx'
import { WEB_SEARCH_NS, WebSearchCardController } from './web-search-card-controller.ts'
import { en, zh, type WebSearchSettingsLocaleKey } from './locales.ts'

export type { WebSearchCardProps } from './WebSearchCard.tsx'
export type { WebSearchCardFace, WebSearchCardState, WebSearchSettings } from './web-search-card-controller.ts'
export type { WebSearchSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Web-search settings page copy. */
    'settings.webSearch': WebSearchSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.webSearch'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms', 'settingsMetadata']

/**
 * Mount the web-search settings page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-web-search: dictionaries')
  const card = new WebSearchCardController(ctx.configForms.get(WEB_SEARCH_NS), ctx)
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-web-search: form subscription')
  // The credential the page reports is not part of any settings section, so
  // its scope publishes nothing when one is written. This is the only signal
  // that a key written on another surface reached the Host.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { card.refreshCredential(ref) }),
    'ui-settings-web-search: credential invalidations',
  )
  ctx.effect(() => ctx.configForms.whileServed([WEB_SEARCH_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'web-search', order: 40, label: () => t('title'), locale: NS, inject: () => card.inject(),
  }, WebSearchCard))), 'ui-settings-web-search: page')
  ctx.effect(() => ctx.configForms.whileServed([WEB_SEARCH_NS], () =>
    ctx.slots.inject('settings.section', function* () {
      yield ctx.settingsMetadata.registerSection({ sectionId: 'web-search', groupId: 'capabilities', heading: 'shell' })
      yield ctx.settingsMetadata.registerItems('web-search', [{
        id: 'web-search-settings', anchorId: 'web-search-settings', title: () => t('nav'), description: () => t('description'),
      }])
      yield ctx.slots.register({
        name: 'settings.section', id: 'web-search', order: 45, label: () => t('nav'), locale: NS,
        inject: () => card.inject(),
      }, WebSearchSettingsSection)
    })), 'ui-settings-web-search: settings page')

}
