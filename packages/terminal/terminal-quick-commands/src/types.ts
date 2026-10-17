/**
 * Durable terminal quick commands: the saved record fields and the wire
 * results the settings page and the terminal menu read back.
 *
 * A command belongs to exactly one execution host. The record keeps that host
 * id so a cached list can never be replayed against a different host after the
 * user switches targets, and so a refreshed Host can drop commands it does not
 * own.
 *
 * @module @deepseek-ai/dsh-terminal-quick-commands/types
 */

/** Stable identity of one saved command. */
export type QuickCommandId = string & { readonly __brand: 'terminal-quick-command-id' }

/** Execution host a command is bound to; `local` is this machine. */
export type QuickCommandHostId = string & { readonly __brand: 'terminal-quick-command-host-id' }

/** One saved command as the settings page and terminal menu receive it. */
export interface QuickCommand {
  readonly id: QuickCommandId
  /** Execution host that owns this command; never replayed against another. */
  readonly hostId: QuickCommandHostId
  /** User-facing label shown in the command menu. */
  readonly name: string
  /** Command text sent to the terminal verbatim. */
  readonly command: string
  /** Optional description shown beside the label. */
  readonly description?: string
  /** Working directory the command runs in; omitted means the terminal's own. */
  readonly cwd?: string
  /** Whether the terminal asks before running this command. */
  readonly confirm: boolean
  /** Creation time in epoch milliseconds, for stable ordering. */
  readonly createdAt: number
  /** Last edit time in epoch milliseconds. */
  readonly updatedAt: number
}

/** Fields the settings page supplies when creating or updating a command. */
export interface QuickCommandDraft {
  readonly hostId: QuickCommandHostId
  readonly name: string
  readonly command: string
  readonly description?: string
  readonly cwd?: string
  readonly confirm?: boolean
}

/** Host ids the page may manage, whether or not any command exists for them. */
export interface QuickCommandHostList {
  /** Host the list was read from. */
  readonly hostId: QuickCommandHostId
  /** Hosts this Host can address, in menu order. */
  readonly hosts: readonly QuickCommandHostId[]
  /** Commands belonging to `hostId`, oldest first. */
  readonly commands: readonly QuickCommand[]
}

/** Reasons a quick-command operation reports instead of silently succeeding. */
export type QuickCommandFailure =
  | 'unknown-command'
  | 'invalid-command'
  | 'invalid-name'
  | 'invalid-cwd'
  | 'storage-unavailable'
  | 'host-unknown'

/** Result of one quick-command operation. */
export type QuickCommandResult =
  | { readonly ok: true; readonly value: QuickCommand | readonly QuickCommand[] }
  | { readonly ok: false; readonly reason: QuickCommandFailure }

/** Durable record written to storage; field names match the wire type. */
export interface QuickCommandRecord {
  readonly id: string
  readonly hostId: string
  readonly name: string
  readonly command: string
  readonly description?: string | undefined
  readonly cwd?: string | undefined
  readonly confirm: boolean
  readonly createdAt: number
  readonly updatedAt: number
}
