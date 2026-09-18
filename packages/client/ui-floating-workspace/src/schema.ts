/** Host schema preserving the existing floating-workspace preference keys and ranges. */
import Schema from '@deepseek-ai/schemastery'
import type { FloatingWorkspaceSettings } from './types.ts'

/** Durable namespace shared with the Client's accepted settings mirror. */
export const FLOATING_WORKSPACE_NAMESPACE = 'floating-workspace'

/** Existing saved values and composition defaults remain valid. */
export const FloatingWorkspaceSettingsSchema: Schema<FloatingWorkspaceSettings> = Schema.object({
  enabled: Schema.boolean().default(false),
  terminalDirectory: Schema.string().default(''),
  toggleButtonPosition: Schema.union([
    Schema.const('header'), Schema.const('sidebar'), Schema.const('floating'),
  ]).default('header'),
  floatDefaultWidth: Schema.number().step(1).min(200).max(800).default(400),
  floatDefaultHeight: Schema.number().step(1).min(150).max(600).default(300),
})
