/** Host entry for the Floating Workspace settings contributor. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { FLOATING_WORKSPACE_NAMESPACE, FloatingWorkspaceSettingsSchema } from './types.ts'

export { FLOATING_WORKSPACE_NAMESPACE, FloatingWorkspaceSettingsSchema, type FloatingWorkspaceSettings, type ToggleButtonPosition } from './types.ts'

/** Register durable settings namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(FLOATING_WORKSPACE_NAMESPACE, FloatingWorkspaceSettingsSchema)
  })
}
