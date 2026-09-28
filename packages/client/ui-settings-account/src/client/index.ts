/** Feature-owned Account Settings registration and apply-owned Remote lifetimes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { AccountSettingsSection } from './AccountSettingsSection.tsx'
import { AccountSettingsSource } from './source.ts'
import { en, zh, type AccountKey } from './locales.ts'
import type { AccountSettingsInjected } from './types.ts'

export type { AccountSettingsInjected, AccountSettingsProps } from './types.ts'
export type { AccountAttemptReadback, AccountReadback, AccountUiError } from './source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account authorization labels, deletion warnings, and safe failures. */
    'settings.account': AccountKey
  }
}

/** Services required for account Remote streams, locale, and Settings composition. */
export const inject = ['slots', 'settingsMetadata', 'locale', 'remote', 'remote.account', 'connection']

/**
 * Register the Account Settings section and own all stream cancellation.
 * @param ctx - injected browser context.
 */
export function apply(ctx: Context): void {
  const namespace = 'settings.account'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'ui-settings-account: dictionaries')
  const t = ctx.locale.bind(namespace)
  const source = new AccountSettingsSource(ctx.remote.account)
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => {
    const refresh = (): void => { source.connect(connection.generation.getSnapshot()?.id) }
    const unsubscribe = connection.generation.subscribe(refresh)
    refresh()
    return async () => { unsubscribe(); await source.dispose() }
  }, 'ui-settings-account: Remote lifetimes')
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'account', groupId: 'personal' })
    yield ctx.settingsMetadata.registerItems('account', [
      {
        id: 'login', anchorId: 'account-login', title: () => t('account'),
        description: () => t('description'), keywords: () => [t('searchTerms')],
      },
      {
        id: 'authorization', anchorId: 'account-authorization', title: () => t('authorization'),
        description: () => t('description'), keywords: () => [t('searchTerms')],
      },
    ])
    yield ctx.slots.register({
      name: 'settings.section', id: 'account', order: 30,
      label: () => t('title'), locale: namespace,
      inject: (): AccountSettingsInjected => ({
        hooks: { account: source.state },
        start: (key, method) => source.start(key, method),
        answer: (prompt, answer) => source.answer(prompt, answer),
        cancel: () => source.cancel(),
        deleteCredential: key => source.deleteCredential(key),
        retry: () => { source.restart() },
        dismissAttempt: () => { source.dismissAttempt() },
        clearFeedback: () => { source.clearFeedback() },
      }),
    }, AccountSettingsSection)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', key: 'account',
  }, IconUserOutline16))
}
