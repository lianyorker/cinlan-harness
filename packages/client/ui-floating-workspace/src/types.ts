/** Durable floating workspace preferences shared by the Host settings provider and browser UI. */

import s from '@deepseek-ai/schemastery'

/** Settings namespace owned by the floating workspace settings. */
export const FLOATING_WORKSPACE_NAMESPACE = 'floating-workspace'

/** Where the sidebar expand/collapse toggle button appears. */
export type ToggleButtonPosition = 'header' | 'sidebar' | 'floating'

/** User-controlled floating workspace preferences. */
export interface FloatingWorkspaceSettings {
  enabled: boolean
  terminalDirectory: string
  toggleButtonPosition: ToggleButtonPosition
  floatDefaultWidth: number
  floatDefaultHeight: number
}

/** Schema used by Host registration and Client settings decoding. */
export const FloatingWorkspaceSettingsSchema: s<FloatingWorkspaceSettings> = s.object({
  enabled: s.boolean().default(false),
  terminalDirectory: s.string().default(''),
  toggleButtonPosition: s.union([
    s.const('header'),
    s.const('sidebar'),
    s.const('floating'),
  ]).default('header'),
  floatDefaultWidth: s.number().step(1).min(200).max(800).default(400),
  floatDefaultHeight: s.number().step(1).min(150).max(600).default(300),
})
