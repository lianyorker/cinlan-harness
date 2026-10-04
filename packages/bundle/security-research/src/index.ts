/** Built-in Security Research preset contribution; providers remain separate plugins. */
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { parse } from 'yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

/**
 * Read the packaged preset that ships beside this module.
 *
 * The preset publishes no name or description: it is a shipped preset whose copy
 * lives in the client dictionaries, which is what marks its roster row built-in
 * ([display.ts](../../../preset/agent-preset-registry/src/display.ts)).
 * @returns The preset definition parsed from `preset.yml` and `agent.cordis.yml`.
 */
function readPreset(): PresetDefinition {
  const presetDir = new URL('../presets/security-research/', import.meta.url)
  const presetYml = parse(readFileSync(new URL('preset.yml', presetDir), 'utf8')) as { order?: number }
  // The include's dialect is what turns the composed rows' `!!js` scalars into
  // the expression nodes the Loader evaluates, so the preset file parses as
  // the same entry-list dialect every profile patch uses.
  const plugins = load(readFileSync(new URL('agent.cordis.yml', presetDir), 'utf8'), { schema: entryListSchema }) as PresetDefinition['plugins']
  return {
    id: 'security-research',
    ...(presetYml.order === undefined ? {} : { order: presetYml.order }),
    plugins,
  }
}

/** Register the packaged Security Research Agent preset for every composition that mounts this bundle.
 *
 * The preset is built in: it enters the roster as soon as the preset registry is
 * available, and installed skill resources only widen the catalog the preset's
 * own provider already serves; they gate neither the preset nor its persona.
 * @param ctx - Bundle contribution context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['agentPresets'], (scope) => {
    let declared: PresetDefinition
    try {
      declared = readPreset()
    } catch (error) {
      scope.logger.warn('security-research: packaged preset files cannot be read: %s', error)
      return
    }
    scope.effect(() => scope.agentPresets.register(declared), 'security-research: packaged agent preset')
  })
}
