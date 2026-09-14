/** Work Items Settings plugin, Host half; all presentation lives in ./client. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { WORK_ITEMS_NAMESPACE, WorkItemsSettingsSchema } from './types.ts'

export { WORK_ITEMS_NAMESPACE, WorkItemsSettingsSchema, type WorkItemsSettings } from './types.ts'

/** Register the durable work-items namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(WORK_ITEMS_NAMESPACE, WorkItemsSettingsSchema)
  })
}
