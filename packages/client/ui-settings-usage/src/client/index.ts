/** Usage settings registration and injected Remote/source lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { UsageSource } from './source.ts'
import { createUsageFiltersStore } from './filters.ts'
import { downloadCsv } from './csv.ts'
import { en, zh } from './locales.ts'
import type { UsageKey } from './locales.ts'

export { createUsageFiltersStore } from './filters.ts'
export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Usage filters, accounting states and CSV labels. */
    'settings.usage': UsageKey
  }
}

/** Remote absence leaves this page registered with an explicit unavailable state. */
export const inject = ['slots', 'locale', 'settingsMetadata']

/**
 * Register Usage in the experimental settings group and own every request lifetime.
 * @param ctx - Client context supplying slots, locale and settings metadata.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.usage', { en, zh }), 'ui-settings-usage: dictionaries')
  const t = ctx.locale.bind('settings.usage')
  const source = new UsageSource()
  const store = createUsageFiltersStore()
  ctx.effect(() => () => source.dispose(), 'ui-settings-usage: query lifetime')
  ctx.inject(['remote', 'remote.usage'], (remoteCtx) => {
    remoteCtx.effect(() => {
      source.connect(async (request, { signal }) => {
        const response = await remoteCtx.remote.usage.query(request, signal)
        if (!response.ok) throw response.error
        return response.value
      })
      return () => source.disconnect()
    }, 'ui-settings-usage: Remote availability')
  })
  const injected: UsageSectionInjected = {
    hooks: { usage: source }, load: source.load, cancel: source.cancel, download: downloadCsv,
  }
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'usage', groupId: 'experimental' })
    yield ctx.settingsMetadata.registerItems('usage', [
      { id: 'filters', anchorId: 'usage-filters', title: () => t('filters'), description: () => t('dateHelp'), keywords: () => [t('provider'), t('model')] },
      { id: 'overview', anchorId: 'usage-overview', title: () => t('overview'), description: () => t('accountingHelp') },
      { id: 'coverage', anchorId: 'usage-coverage', title: () => t('coverage'), keywords: () => [t('partial'), t('unknownTurns')] },
      { id: 'export', anchorId: 'usage-export', title: () => t('export'), description: () => t('exportHelp') },
    ])
    yield ctx.slots.register({
      name: 'settings.section', id: 'usage', order: 160, label: () => t('nav'),
      locale: 'settings.usage', store, inject: () => injected,
    }, UsageSection)
  })
}
