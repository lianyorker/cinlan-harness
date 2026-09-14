/** Git and source control settings registration plugin, browser half. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { GitSettingsSection, type GitSettingsSectionInjected } from './GitSettingsSection.tsx'
import { en, zh, type GitSettingsKey } from './locales.ts'
import type { GitSourceControlSettings } from '../types.ts'

export type { GitSettingsSectionInjected, GitSettingsSectionProps } from './GitSettingsSection.tsx'
export type { GitSourceControlSettings, BranchPrefixMode, SourceControlGroupOrder } from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Git and source control settings copy. */
    'settings.gitSourceControl': GitSettingsKey
  }
}

const NS = 'settings.gitSourceControl'

/** Required services: the settings scope for git-source-control namespace. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Register the Git and source control settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-git-settings: dictionaries')
  const t = ctx.locale.bind(NS) as GitSettingsSectionInjected['t']
  const settings = ctx.settingsScope.bind<GitSourceControlSettings>({ namespace: 'git-source-control' })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'git-source-control',
    order: 36,
    label: () => t('nav'),
    locale: NS,
    inject: (): GitSettingsSectionInjected => ({ settings, t }),
  }, GitSettingsSection))

  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    key: 'git-source-control',
  }, IconBranchOutline16))
}
