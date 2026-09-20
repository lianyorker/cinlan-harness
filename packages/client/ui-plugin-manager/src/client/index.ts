/** Plugin lifecycle controls inside the existing Settings Plugins section. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { PluginManagerTab } from './PluginManagerTab.tsx'
import { configLedgerSource } from './config-ledger.ts'
import { PluginManagerController } from './manager-store.ts'
import { en, zh, type PluginManagerLocaleKey } from './locales.ts'
import type {} from './slot-contract.ts'

export type { PluginManagerTabProps } from './PluginManagerTab.tsx'
export type { ConfigLedger, OfficialItem } from './config-ledger.ts'
export type { PluginManagerFace } from './manager-store.ts'
export type { PluginManagerLocaleKey } from './locales.ts'
export type { PluginConfigViewProps } from './slot-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin lifecycle and installation copy. */
    pluginManager: PluginManagerLocaleKey
  }
}

/** Missing management namespaces leave Settings usable and show an unavailable message. */
export const inject = ['slots', 'locale']

/**
 * Contribute the lazy management tab and its configuration slots.
 * @param ctx - Client context carrying the Settings slot registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('pluginManager', { zh, en }), 'ui-plugin-manager: dictionaries')
  const t = ctx.locale.bind('pluginManager')
  const desktop = location.protocol === 'dsh-app:' && location.host === 'app'
    ? (globalThis as { dshDesktop?: { readonly openPlugins?: () => Promise<void> } }).dshDesktop ?? {}
    : undefined
  const controller = new PluginManagerController(ctx, desktop, () => { window.location.reload() })
  ctx.effect(() => () => { controller.dispose() }, 'ui-plugin-manager: controller')
  const refresh = (): (void) => {
    if (controller.getSnapshot().status !== 'idle') void controller.load()
  }
  ctx.on('connection/reset', refresh)
  ctx.inject(['remote'], (scoped) => {
    scoped.effect(() => {
      const disposers = [
        scoped.remote.$on('plugin-manager/changed', refresh),
        scoped.remote.$on('plugin-manager/install-log', (chunk) => { controller.appendLog(chunk) }),
        scoped.remote.$on('plugin-manager/install-state', (progress) => { controller.installProgress(progress) }),
      ]
      refresh()
      return () => { for (const dispose of disposers) dispose() }
    }, 'ui-plugin-manager: host invalidations')
  })
  const configLedger = configLedgerSource(ctx)
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'management', order: 20,
    label: () => t('managementTab'), locale: 'pluginManager',
    inject: () => controller.inject(configLedger),
    children: {
      'plugins.item': { kind: 'list', scope: 'root' },
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'plugins.row.config': { kind: 'keyed', scope: 'root' },
    },
  }, PluginManagerTab))
}
