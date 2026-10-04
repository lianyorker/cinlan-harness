/** Plain preferences and runtime facts consumed by the floating workspace UI. */
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FloatingWorkspaceSettings } from '../types.ts'

/** One owned app window's observed lifecycle. */
export type FloatingWindowPhase = 'closed' | 'open' | 'blocked' | 'unavailable'

/** Stable observable value published by the owner, with no DOM or service objects. */
export interface FloatingSnapshot {
  readonly settings: SettingsScopeSnapshot<FloatingWorkspaceSettings>
  readonly phase: FloatingWindowPhase
  /** Whether this activation's panel is on screen. */
  readonly open: boolean
  /** A failed preference write preserves the last accepted settings. */
  readonly writeFailed: boolean
  readonly writing: boolean
  /** True only while the actual terminal creation consumer is installed. */
  readonly directorySupported: boolean
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
  /** Open this activation's panel, or close it when it is already open. */
  toggle(): void
  /** Close this activation's panel. */
  close(): void
}
