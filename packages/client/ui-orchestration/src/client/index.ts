/** Orchestration settings registration plugin, browser half. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { OrchestrationSection, type OrchestrationSectionInjected } from './OrchestrationSection.tsx'
import { en, zh, type OrchestrationSettingsKey } from './locales.ts'

export type { OrchestrationSectionInjected, OrchestrationSectionProps } from './OrchestrationSection.tsx'
export type { OrchestrationCoverage, PresetCoverage, OrchestrationCoverageStatus } from './view.ts'
export { detectOrchestrationCoverage, coverageSummary } from './view.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Orchestration settings copy. */
    'settings.orchestration': OrchestrationSettingsKey
  }
}

const NS = 'settings.orchestration'

/** Required services: the Remote namespaces the coverage detector reads through. */
export const inject = ['slots', 'locale', 'remote', 'remote.agentPresets']

/**
 * Register the Orchestration settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-orchestration: dictionaries')
  const t = ctx.locale.bind(NS) as OrchestrationSectionInjected['t']

  const list: OrchestrationSectionInjected['list'] = async () => {
    const result = await ctx.remote.agentPresets.list()
    if (!result.ok) throw new Error(`agentPresets.list failed: ${result.error.code}: ${result.error.message}`)
    return result.value.presets
  }
  const read: OrchestrationSectionInjected['read'] = async (id: string) => {
    const result = await ctx.remote.agentPresets.read(id)
    if (!result.ok) throw new Error(`agentPresets.read failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'orchestration',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: (): OrchestrationSectionInjected => ({ list, read, t }),
  }, OrchestrationSection))

  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    key: 'orchestration',
  }, IconBranchOutline16))
}
