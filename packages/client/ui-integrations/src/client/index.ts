/** Integrations settings registration plugin, browser half. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconLinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { IntegrationsSection, type IntegrationsSectionInjected } from './IntegrationsSection.tsx'
import { en, zh, type IntegrationSettingsKey } from './locales.ts'

export type { IntegrationsSectionInjected, IntegrationsSectionProps } from './IntegrationsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Integrations settings copy. */
    'settings.integrations': IntegrationSettingsKey
  }
}

const NS = 'settings.integrations'

/** Required services: the Remote namespaces the preflight checker reads through. */
export const inject = ['settingsMetadata', 'slots', 'locale', 'remote', 'remote.integrationPreflight']

/**
 * Register the Integrations settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-integrations: dictionaries')
  const t = ctx.locale.bind(NS)

  const check: IntegrationsSectionInjected['check'] = async (provider, signal) => {
    const result = await ctx.remote.integrationPreflight.check({ provider }, signal)
    if (!result.ok) throw new Error(`integrationPreflight.check failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'integrations', groupId: 'development' })
    yield ctx.settingsMetadata.registerItems('integrations', [
      { id: 'github', anchorId: 'integrations-github', title: () => t('githubTitle'), description: () => t('githubDescription') },
      { id: 'gitlab', anchorId: 'integrations-gitlab', title: () => t('gitlabTitle'), description: () => t('gitlabDescription') },
      { id: 'gitee', anchorId: 'integrations-gitee', title: () => t('giteeTitle'), description: () => t('giteeDescription') },
      { id: 'refresh', anchorId: 'integrations-refresh', title: () => t('refreshAll'),
        keywords: () => [t('statusChecking'), t('statusConnected'), t('authPrompt')] },
    ])
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'integrations',
      order: 40,
      label: () => t('nav'),
      locale: NS,
      inject: (): IntegrationsSectionInjected => ({ check }),
    }, IntegrationsSection)
  })

  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    key: 'integrations',
  }, IconLinkOutline16))
}
