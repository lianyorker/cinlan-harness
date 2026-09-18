/** Orchestration capabilities from the Host's evaluated plugin inventory. */
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'

type Preset = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
type PluginRow = Preset['rows'][number]

/** Observed plugin state; configured means enabled without a live Fiber. */
export type OrchestrationCoverageStatus = 'active' | 'configured' | 'disabled' | 'conditional' | 'pending' | 'failed' | 'missing' | 'broken'

/** One preset's workflow and delegation tool availability. */
export interface PresetCoverage {
  readonly preset: Preset
  readonly status: OrchestrationCoverageStatus
  readonly subagent: OrchestrationCoverageStatus
  readonly engine: OrchestrationCoverageStatus
}

/** Preset tool coverage and the separately owned Host workflow engine. */
export interface OrchestrationCoverage {
  readonly presets: readonly PresetCoverage[]
  readonly engine: OrchestrationCoverageStatus
}

function pluginStatus(rows: readonly PluginRow[], moduleName: string): OrchestrationCoverageStatus {
  const matches = rows.filter(row => row.moduleName === moduleName)
  if (matches.length === 0) return 'missing'
  const enabled = matches.filter(row => row.enabled === true)
  if (enabled.some(row => row.fiberPhase === 'active')) return 'active'
  if (enabled.some(row => row.fiberPhase === null)) return 'configured'
  if (enabled.some(row => row.fiberPhase === 'failed')) return 'failed'
  if (enabled.length > 0) return 'pending'
  if (matches.some(row => row.enabled === 'conditional')) return 'conditional'
  return 'disabled'
}

/**
 * Read evaluated rows without parsing or executing preset files in the browser.
 * @param load - the existing Host plugin-inventory operation.
 * @returns exact first-party tool coverage; configuration alone does not prove provider connectivity.
 */
export async function detectOrchestrationCoverage(
  load: () => Promise<PluginInventorySnapshot>,
): Promise<OrchestrationCoverage> {
  const inventory = await load()
  return {
    engine: pluginStatus(inventory.entries, '@deepseek-ai/dsh-workflow-worker-thread'),
    presets: (inventory.agentPresets ?? []).map(preset => ({
      preset,
      status: preset.broken === undefined ? pluginStatus(preset.rows, '@deepseek-ai/dsh-tool-workflow') : 'broken',
      subagent: preset.broken === undefined ? pluginStatus(preset.rows, '@deepseek-ai/dsh-tool-subagent') : 'broken',
      engine: preset.broken === undefined ? pluginStatus(preset.rows, '@deepseek-ai/dsh-workflow-worker-thread') : 'broken',
    })),
  }
}

/**
 * Count compositions with an enabled workflow tool separately from unavailable rows.
 * @param coverage - evaluated Host inventory projection.
 * @returns enabled, unavailable, broken, and total preset counts.
 */
export function coverageSummary(coverage: OrchestrationCoverage): {
  readonly ready: number
  readonly missing: number
  readonly broken: number
  readonly total: number
} {
  let ready = 0
  let missing = 0
  let broken = 0
  for (const entry of coverage.presets) {
    if (entry.status === 'active' || entry.status === 'configured') ready += 1
    else if (entry.status === 'broken' || entry.status === 'failed') broken += 1
    else missing += 1
  }
  return { ready, missing, broken, total: coverage.presets.length }
}
