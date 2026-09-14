/** Work Items Settings registration through generated Remote commands. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkItemsSettings } from '../types.ts'
import { WORK_ITEMS_NAMESPACE } from '../types.ts'
import { WorkItemsSection, type WorkItemsSectionInjected } from './WorkItemsSection.tsx'
import { en, NS, zh } from './locales.ts'

export type { WorkItemsSectionInjected, WorkItemsSectionProps } from './WorkItemsSection.tsx'
export type { WorkItemsKey } from './locales.ts'
export type { WorkItemsSettings } from '../types.ts'

/** Services used by Settings registration and the generated Work Items namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.workItems', 'remote.integrationPreflight', 'settingsScope']

/**
 * Register the localized Settings entry for the lifetime of its declaring slots.
 * @param ctx - Browser services for Remote access, slots, and localization.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-work-items: dictionaries')
  const t = ctx.locale.bind(NS)
  const value = <T>(result: RemoteResult<T>): T => {
    if (result.ok) return result.value
    const error = result.error
    if (error.code === 'work-items/operation-failed'
      && ['configured-missing', 'configured-unavailable', 'unavailable'].includes(error.details.providerCode)) {
      throw new Error(t('unavailable'))
    }
    throw new Error(error.message)
  }
  const settings = ctx.settingsScope.bind<WorkItemsSettings>({ namespace: WORK_ITEMS_NAMESPACE })
  const injected: WorkItemsSectionInjected = {
    prepareWrite: async (request, signal) => value(await ctx.remote.workItems.prepareWrite(request, signal)),
    confirmWrite: async (request, signal) => value(await ctx.remote.workItems.confirmWrite(request, signal)),
    cancelWrite: async (request, signal) => value(await ctx.remote.workItems.cancelWrite(request, signal)),
    listWrites: async (request, signal) => value(await ctx.remote.workItems.listWrites(request, signal)),
    list: async (request, signal) => value(await ctx.remote.workItems.list(request, signal)),
    get: async (request, signal) => value(await ctx.remote.workItems.get(request, signal)),
    associate: async (request, signal) => value(await ctx.remote.workItems.associate(request, signal)),
    disassociate: async (request, signal) => value(await ctx.remote.workItems.disassociate(request, signal)),
    checkIntegration: async (provider) => {
      const result = await ctx.remote.integrationPreflight.check({ provider })
      if (!result.ok) throw new Error(`integrationPreflight.check failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    settings,
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: NS, order: 25, label: () => t('nav'), locale: NS,
    inject: () => injected,
  }, WorkItemsSection))
}
