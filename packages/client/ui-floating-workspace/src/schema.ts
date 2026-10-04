/** Host schema preserving the existing floating-workspace preference keys and ranges. */
import Schema from '@deepseek-ai/schemastery'
import type { FloatingWorkspaceSettings } from './types.ts'

/**
 * Settings namespace owned by this entry. The settings document keys every
 * namespace by its Loader entry id, so the value is this row's id in the web
 * bundle rather than the short feature name.
 */
export const FLOATING_WORKSPACE_NAMESPACE = 'ui-floating-workspace'

/** Existing saved values and composition defaults remain valid. */
export const FloatingWorkspaceSettingsSchema: Schema<FloatingWorkspaceSettings> = Schema.object({
  enabled: Schema.boolean().default(false),
  terminalDirectory: Schema.string().default(''),
  toggleButtonPosition: Schema.union([
    Schema.const('header'), Schema.const('floating'),
  ]).default('header'),
  floatDefaultWidth: Schema.number().step(1).min(200).max(800).default(400),
  floatDefaultHeight: Schema.number().step(1).min(150).max(600).default(300),
})
