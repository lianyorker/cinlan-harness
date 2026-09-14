/** Orchestration coverage detection: check whether each agent preset includes the workflow tool. */
import type { AgentPresetRow, AgentPresetDocument } from '@deepseek-ai/dsh-agent-presets/types'

/** Coverage status of one preset against the workflow tool. */
export type OrchestrationCoverageStatus = 'ready' | 'missing' | 'broken'

/** One preset's orchestration coverage result. */
export interface PresetCoverage {
  readonly preset: AgentPresetRow
  readonly status: OrchestrationCoverageStatus
}

/** Aggregate coverage across all presets. */
export interface OrchestrationCoverage {
  readonly presets: readonly PresetCoverage[]
}

/**
 * Detect orchestration coverage by reading each preset's composition text and
 * checking whether it includes the `tool-workflow` module. A broken preset is
 * reported as broken without reading its composition.
 */
export async function detectOrchestrationCoverage(
  list: () => Promise<readonly AgentPresetRow[]>,
  read: (id: string) => Promise<AgentPresetDocument>,
): Promise<OrchestrationCoverage> {
  const presets = await list()
  const results = await Promise.all(presets.map(async (preset) => {
    if (preset.broken !== undefined) return { preset, status: 'broken' as const }
    const doc = await read(preset.id)
    const hasWorkflow = doc.content.includes('tool-workflow')
    return { preset, status: hasWorkflow ? 'ready' as const : 'missing' as const }
  }))
  return { presets: results }
}

/** Count presets by coverage status. */
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
    if (entry.status === 'ready') ready += 1
    else if (entry.status === 'missing') missing += 1
    else broken += 1
  }
  return { ready, missing, broken, total: coverage.presets.length }
}
