/** Archived-session Settings page, browser half. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconArchiveOutline20 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the `uiWorkspace` Context merge and the `useWorkspaces`
// global standard prop this page reads.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the `useSessions` global standard prop.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ArchivedSessionsSection } from './ArchivedSessionsSection.tsx'
import type { ArchivedSessionsSectionInjected } from './ArchivedSessionsSection.tsx'
import { en, zh, type ArchivedSessionsLocaleKey } from './locales.ts'

export type { ArchivedSessionsSectionInjected, ArchivedSessionsSectionProps } from './ArchivedSessionsSection.tsx'
export type { ArchivedSessionsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Archived-session page copy. */
    'settings.archivedSessions': ArchivedSessionsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.archivedSessions'

/** Services required by the Settings registration and the archive write. */
export const inject = ['slots', 'locale', 'uiWorkspace', 'settingsMetadata']

/**
 * Contribute the archived-session page and public search metadata to Settings.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-unarchive-sessions: dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): ArchivedSessionsSectionInjected => ({
    unarchive: sessionId => ctx.uiWorkspace.unarchiveSession(sessionId),
  })

  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'archived-sessions', groupId: 'personal' })
    yield ctx.settingsMetadata.registerItems('archived-sessions', [{
      id: 'restore', anchorId: 'archived-sessions-search',
      title: () => t('nav'), description: () => t('search'),
      keywords: () => [t('unarchive'), t('restoreKeyword')],
    }])
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'archived-sessions',
      order: 25,
      label: () => t('nav'),
      locale: NS,
      inject: injected,
    }, ArchivedSessionsSection)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', key: 'archived-sessions',
  }, IconArchiveOutline20))
}
