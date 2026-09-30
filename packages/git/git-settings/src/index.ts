/** Host owner of the durable Git preferences namespace. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from './settings-schema.ts'

export { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema }
export * from './types.ts'

/** Cordis plugin identity. */
export const name = '@deepseek-ai/dsh-git-settings'

/** The existing settings provider owns persistence and registration disposal. */
export const inject = ['settings']

export const Config = GitSourceControlSettingsSchema

/**
 * Register the Git namespace for this plugin fiber.
 * @param ctx - Host context containing the settings provider.
 */
export function apply(ctx: Context): void {
  ctx.settings.configure({ auto: true })
}
