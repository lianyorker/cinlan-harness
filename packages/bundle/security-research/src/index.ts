/** Optional Security Research preset contribution; providers remain separate plugins. */
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'

/** Register the packaged preset while the profile supplies a preset registry.
 * @param ctx - Bundle contribution context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['agentPresets'], (scope) => {
    scope.agentPresets.registerSystemRoot(fileURLToPath(new URL('../presets/', import.meta.url)))
  })
}
