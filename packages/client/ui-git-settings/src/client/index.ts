/** Git and source control settings registration plugin, browser half. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { GIT_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-git-settings/settings-schema'
import { GitSettingsSection, type GitSettingsSectionInjected } from './GitSettingsSection.tsx'
import { en, zh, type GitSettingsKey } from './locales.ts'
import { createGitSettingsOperations } from './settings-operations.ts'
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
export const inject = ['settingsMetadata', 'slots', 'locale', 'settingsScope']

/**
 * Register the Git and source control settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-git-settings: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = ctx.settingsScope.bind<GitSourceControlSettings>({ namespace: GIT_SETTINGS_NAMESPACE })

  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'git-source-control', groupId: 'development' })
    yield ctx.settingsMetadata.registerItems('git-source-control', [
      { id: 'branch-prefix', anchorId: 'git-branch-prefix', title: () => t('branchPrefixTitle'),
        description: () => t('branchPrefixDescription'), keywords: () => [t('branchPrefixGitUsername'), t('branchPrefixNone')] },
      { id: 'custom-prefix', anchorId: 'git-custom-prefix', title: () => t('branchPrefixCustomLabel'),
        description: () => t('branchPrefixCustomDesc') },
      { id: 'update-base', anchorId: 'git-update-base', title: () => t('keepLocalMainTitle'),
        description: () => t('keepLocalMainDescription') },
      { id: 'group-order', anchorId: 'git-group-order', title: () => t('groupOrderTitle'),
        description: () => t('groupOrderDescription') },
      { id: 'upstream', anchorId: 'git-upstream', title: () => t('compareUpstreamTitle'),
        description: () => t('compareUpstreamDescription') },
      { id: 'attribution', anchorId: 'git-attribution', title: () => t('attributionTitle'),
        description: () => t('attributionDescription') },
    ])
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'git-source-control',
      order: 36,
      label: () => t('nav'),
      locale: NS,
      inject: (): GitSettingsSectionInjected => ({ hooks: { settings }, ...createGitSettingsOperations(settings) }),
    }, GitSettingsSection)
  })

  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    key: 'git-source-control',
  }, IconBranchOutline16))
}
