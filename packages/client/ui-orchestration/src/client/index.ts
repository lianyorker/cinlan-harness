/** Orchestration settings registration plugin, browser half. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { OrchestrationSection, type OrchestrationSectionInjected, type ParallelismSettings } from './OrchestrationSection.tsx'
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
export const inject = ['settingsMetadata', 'settingsScope', 'slots', 'locale', 'remote', 'remote.pluginInventory']

/**
 * Register the Orchestration settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-orchestration: dictionaries')
  const t = ctx.locale.bind(NS)
  const parallelism = ctx.settingsScope.bind<ParallelismSettings>({ namespace: 'agent-loop' })
  const loadInventory: OrchestrationSectionInjected['loadInventory'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const saveParallelism: OrchestrationSectionInjected['saveParallelism'] = async (value) => {
    const before = parallelism.getSnapshot()
    if (before.status !== 'ready' || !before.writable) return false
    const accepted = await parallelism.mutate(value === null
      ? [{ op: 'unset', path: ['maxParallelToolCalls'] }]
      : [{ op: 'set', path: ['maxParallelToolCalls'], value }], before.revision)
    const after = parallelism.getSnapshot()
    const overridden = typeof after.user === 'object' && after.user !== null
      && Object.hasOwn(after.user, 'maxParallelToolCalls')
    return accepted && after.status === 'ready' && (value === null
      ? !overridden
      : overridden && after.value?.maxParallelToolCalls === value)
  }

  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'orchestration', groupId: 'ai' })
    yield ctx.settingsMetadata.registerItems('orchestration', [
      {
        id: 'parallelism', anchorId: 'orchestration-parallelism',
        title: () => t('parallelismLabel'), description: () => t('parallelismHelp'),
        keywords: () => [t('executionTitle'), t('reset')],
      },
      {
        id: 'workflow-limits', anchorId: 'orchestration-workflow-limits',
        title: () => t('engineOverviewTitle'), description: () => t('engineLimitsHelp'),
        keywords: () => [t('engineAvailability')],
      },
      {
        id: 'coverage', anchorId: 'orchestration-coverage',
        title: () => t('coverageTitle'), description: () => t('coverageDescription'),
        keywords: () => [t('workflowTool'), t('subagentTool')],
      },
      {
        id: 'examples', anchorId: 'orchestration-examples',
        title: () => t('examplesTitle'), description: () => t('examplesDescription'),
        keywords: () => [t('exampleParallelTitle'), t('examplePipelineTitle')],
      },
    ])
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'orchestration',
      order: 30,
      label: () => t('nav'),
      locale: NS,
      inject: (): OrchestrationSectionInjected => ({ loadInventory, hooks: { parallelism }, saveParallelism }),
    }, OrchestrationSection)
  })

  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    key: 'orchestration',
  }, IconBranchOutline16))
}
