/** Browser plugin contributing the Session Inspector Log sidebar tab. */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { en, NS, zh } from './locales.ts'
import { registerInspectorTab } from './views/index.ts'

/** Services required to register the localized Session-bound sidebar tab. */
export const inject = ['slots', 'locale', 'sessions', 'uiSession', 'uiConversation', 'sidebarRightTabs', 'configForms']

/**
 * Register the Inspector tab for this plugin's lifetime.
 * @param ctx - Client plugin context owning the dictionaries and registrations.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'session-inspector: dictionaries')
  const preference = ctx.configForms.developerTools.enabled
  ctx.effect(async () => {
    let active = true
    let views: Fiber | undefined
    let pending = Promise.resolve()
    const sync = () => {
      const next = pending.then(async () => {
        if (views !== undefined && (!active || !preference.getSnapshot())) {
          await views.dispose()
          views = undefined
        }
        if (active && preference.getSnapshot() && views === undefined) {
          views = ctx.plugin({ apply: registerInspectorTab })
          await views.await()
        }
      })
      pending = next
      return next
    }
    const unsubscribe = preference.subscribe(() => {
      void sync().catch((error: unknown) => { ctx.logger.error('session-inspector: visibility update failed', error) })
    })
    await sync()
    return async () => {
      active = false
      unsubscribe()
      await sync()
    }
  }, 'session-inspector: developer visibility')
}
