/** Host entry registering the durable floating workspace namespace. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { FLOATING_WORKSPACE_NAMESPACE, FloatingWorkspaceSettingsSchema } from './schema.ts'

export { Config } from './config.ts'
export type { FloatingWorkspaceSettings, ToggleButtonPosition } from './types.ts'

/**
 * Register preferences while the optional Host settings provider is available.
 * @param ctx - owning Host fiber.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(FLOATING_WORKSPACE_NAMESPACE, FloatingWorkspaceSettingsSchema)
  })
}
