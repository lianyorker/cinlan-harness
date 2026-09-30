/** Work Items Settings plugin, Host half; all presentation lives in ./client. */
import type { Context } from '@deepseek-ai/cordis'

export { WORK_ITEMS_NAMESPACE, WorkItemsSettingsSchema, type WorkItemsSettings } from './types.ts'

/** Register the durable work-items namespace when a settings provider exists. */
export function apply(_ctx: Context): void {
  // In v0.2.0-rc.1, Settings are automatically resolved from Loader config entries.
}
