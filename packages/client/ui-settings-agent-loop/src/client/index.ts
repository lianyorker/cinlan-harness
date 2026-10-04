/**
 * The agent loop's settings row, browser half: the parallel tool-call cap
 * over the `agent-loop` namespace the loop registers. The row registers into
 * the General settings page's `settings.general.item` slot while the Host
 * serves that namespace, so a deployment that exposes no agent-loop settings
 * shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AgentLoopSettingsSection } from './AgentLoopCard.tsx'
import { AGENT_LOOP_NS, AgentLoopCardController } from './agent-loop-card-controller.ts'
import { en, zh, type AgentLoopSettingsLocaleKey } from './locales.ts'

export type { AgentLoopCardProps } from './AgentLoopCard.tsx'
export type { AgentLoopCardFace, AgentLoopCardState, AgentLoopSettings } from './agent-loop-card-controller.ts'
export type { AgentLoopSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent loop settings row copy. */
    'settings.agentLoop': AgentLoopSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.agentLoop'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms', 'settingsMetadata']

/**
 * Mount the agent loop's settings row while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-agent-loop: dictionaries')
  const card = new AgentLoopCardController(ctx.configForms.get(AGENT_LOOP_NS))
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-agent-loop: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([AGENT_LOOP_NS], () =>
    ctx.slots.inject('settings.general.item', function* () {
      yield ctx.settingsMetadata.registerItems('general', [{
        id: 'agent-loop-settings', anchorId: 'agent-loop-settings', title: () => t('maxParallel'), description: () => t('maxParallelHint'),
        keywords: () => [t('maxParallel'), t('maxParallelHint'), 'parallel', 'loop', 'tool'],
      }])
      yield ctx.slots.register({
        name: 'settings.general.item', id: 'agent-loop', order: 40, locale: NS,
        inject: () => card.inject(),
      }, AgentLoopSettingsSection)
    })), 'ui-settings-agent-loop: general row')

}
