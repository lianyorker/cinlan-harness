/** Durable preferences owned by the floating workspace feature. */

/** Existing entry positions; persisted values remain stable. */
export type ToggleButtonPosition = 'header' | 'sidebar' | 'floating'

/** Preferences affect the entry and future app-window creation. */
export interface FloatingWorkspaceSettings {
  enabled: boolean
  /** New floating terminals request this directory; empty inherits their Session working directory. */
  terminalDirectory: string
  toggleButtonPosition: ToggleButtonPosition
  floatDefaultWidth: number
  floatDefaultHeight: number
}
