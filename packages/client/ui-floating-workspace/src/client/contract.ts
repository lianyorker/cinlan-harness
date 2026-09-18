/** Plain preferences and runtime facts consumed by the floating workspace UI. */
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FloatingWorkspaceSettings } from '../types.ts'

/** One owned app window's observed lifecycle. */
export type FloatingWindowPhase = 'closed' | 'open' | 'blocked' | 'unavailable'

/** Stable observable value published by the owner, with no DOM or service objects. */
export interface FloatingSnapshot {
  readonly settings: SettingsScopeSnapshot<FloatingWorkspaceSettings>
  readonly phase: FloatingWindowPhase
  /** Child renderers use normal app slots and expose only a close control. */
  readonly child: boolean
  /** A failed preference write preserves the last accepted settings. */
  readonly writeFailed: boolean
  readonly writing: boolean
  /** True only while the actual terminal creation consumer is installed. */
  readonly directorySupported: boolean
  /** Parent-provided initial Session could not be found in the normal catalog. */
  readonly targetUnavailable: boolean
}

/** Explicit user operations; successful writes are reflected by the settings owner. */
export interface FloatingActions {
  /**
   * Request one durable preference edit.
   * @param key - owned preference field.
   * @param value - schema-valid requested value.
   * @returns settlement after accepted-state confirmation or a published failure.
   */
  set<K extends keyof FloatingWorkspaceSettings>(key: K, value: FloatingWorkspaceSettings[K]): Promise<void>
  /** Open or close this exact owner's app window. */
  toggle(): void
  /** Close only this owner window and return focus to its live source. */
  close(): void
}
