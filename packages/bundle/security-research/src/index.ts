/** Optional Security Research preset contribution; providers remain separate plugins. */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

/** Register the packaged preset while the profile supplies a preset registry.
 * @param ctx - Bundle contribution context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['agentPresets'], (scope) => {
    try {
      const presetDir = new URL('../presets/security-research/', import.meta.url)
      const presetYml = parse(readFileSync(new URL('preset.yml', presetDir), 'utf8')) as { name?: string; description?: string; order?: number }
      const cordisYml = parse(readFileSync(new URL('agent.cordis.yml', presetDir), 'utf8')) as any[]
      const definition: PresetDefinition = {
        id: 'security-research',
        ...(presetYml.name !== undefined ? { name: presetYml.name } : {}),
        ...(presetYml.description !== undefined ? { description: presetYml.description } : {}),
        ...(presetYml.order !== undefined ? { order: presetYml.order } : {}),
        plugins: cordisYml,
      }
      void scope.agentPresets.register(definition)
    } catch (error) {
      scope.logger.warn('Failed to load security-research preset: %s', error)
    }
  })
}
