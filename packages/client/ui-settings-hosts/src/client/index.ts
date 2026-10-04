/** Native execution-host settings registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-execution-host-controller/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { createHostsCallbacks } from './callbacks.ts'
import { observeHosts } from './observation.ts'
import { HostsSection } from './HostsSection.tsx'
import { en, zh, type HostsKey } from './locales.ts'
import type { HostsInjected } from './types.ts'

/** Services consumed by registration and generated Host callbacks. */
export const inject = ['slots', 'locale', 'settingsMetadata', 'remote', 'remote.executionHosts']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** SSH host management copy. */
    'settings.hosts': HostsKey
  }
}

const ITEMS = [
  ['hosts', 'hosts', 'hostsDescription'],
  ['ssh-alias', 'formDestination', 'connectionDescription'],
] as const

/**
 * Register the SSH host page and follow Host snapshots for this plugin lifetime.
 * @param ctx - client context with the generated executionHosts namespace.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.hosts', { en, zh }))
  const t = ctx.locale.bind('settings.hosts')
  const callbacks = createHostsCallbacks(ctx.remote.executionHosts)
  const observation = observeHosts(callbacks)
  ctx.effect(() => observation.dispose)
  ctx.slots.inject('settings.section', function* () {
    // The page owns its heading so the navigation item can name the feature while
    // the page title names the full surface, as the reference does.
    yield ctx.settingsMetadata.registerSection({ sectionId: 'hosts', groupId: 'execution', heading: 'feature' })
    yield ctx.settingsMetadata.registerItems('hosts', ITEMS.map(([id, title, description]) => ({
      id, anchorId: id, title: () => t(title), description: () => t(description), keywords: () => [t('searchTerms')],
    })))
    yield ctx.slots.register({
      name: 'settings.section', id: 'hosts', order: 140, label: () => t('navLabel'), locale: 'settings.hosts',
      inject: (): HostsInjected => ({
        hooks: { hosts: observation.source }, refresh: observation.refresh,
        create: callbacks.create, update: callbacks.update, removeTarget: callbacks.removeTarget,
        connect: callbacks.connect, disconnect: callbacks.disconnect,
        test: callbacks.test, listImportableHosts: callbacks.listImportableHosts,
      }),
    }, HostsSection)
  })
  ctx.slots.inject('settings.section.icon', () =>
    ctx.slots.register({ name: 'settings.section.icon', key: 'hosts' }, IconCodeOutline16))
}
