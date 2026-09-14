/** Host entry for the browser-only Git settings contributor. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from './types.ts'

export {
  GIT_SETTINGS_NAMESPACE,
  GitSourceControlSettingsSchema,
  type GitSourceControlSettings,
  type BranchPrefixMode,
  type SourceControlGroupOrder,
} from './types.ts'

/** Register the durable git-source-control namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema)
  })
}
