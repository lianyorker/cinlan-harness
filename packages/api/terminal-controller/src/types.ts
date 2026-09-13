/**
 * Client-safe types for the terminal Remote namespace.
 * @module @deepseek-ai/dsh-api-terminal-controller/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque terminal session identity for Remote clients. */
export type TerminalSessionId = Branded<'TerminalSessionId'>

/** Terminal session status visible to Remote clients. */
export type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: string | null }

/** Client-safe terminal session snapshot. */
export interface TerminalView {
  readonly terminalSessionId: TerminalSessionId
  readonly name?: string
  readonly type: string
  readonly pid?: number
  readonly status: TerminalSessionStatus
}

/** Request to list terminals for one session. */
export interface TerminalListRequest {
  readonly sessionId: SessionId
}

/** Result of listing terminals. */
export interface TerminalListValue {
  readonly terminals: readonly TerminalView[]
}

/** Request to spawn a new terminal. */
export interface TerminalSpawnRequest {
  readonly sessionId: SessionId
  readonly type: string
  readonly name?: string
  readonly cwd?: string
}

/** Result of spawning a terminal. */
export interface TerminalSpawnValue extends TerminalView {
  readonly motd: string
}

/** Request to send input to a terminal. */
export interface TerminalSendRequest {
  readonly sessionId: SessionId
  readonly terminalSessionId: TerminalSessionId
  readonly text: string
  readonly submit: boolean
}

/** Why one terminal send operation completed. */
export type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'

/** Result of sending input to a terminal. */
export interface TerminalSendValue {
  readonly viewport: string
  readonly waitReason: TerminalWaitReason
  readonly sessionStatus: TerminalSessionStatus
  readonly truncated: boolean
}

/** Request to read terminal scrollback. */
export interface TerminalReadRequest {
  readonly sessionId: SessionId
  readonly terminalSessionId: TerminalSessionId
  readonly offset?: number
  readonly count?: number
}

/** Result of reading terminal scrollback. */
export interface TerminalReadValue {
  readonly text: string
  readonly totalLines: number
  readonly lineBegin: number
  readonly lineEnd: number
  readonly truncated: boolean
}

/** Allowed terminal signals. */
export type TerminalSignalName = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** Request to signal a terminal. */
export interface TerminalSignalRequest {
  readonly sessionId: SessionId
  readonly terminalSessionId: TerminalSessionId
  readonly signal: TerminalSignalName
}

/** Result of signaling a terminal. */
export interface TerminalSignalValue {
  readonly delivered: true
  readonly targetPgid: number
}

/** Request to kill a terminal. */
export interface TerminalKillRequest {
  readonly sessionId: SessionId
  readonly terminalSessionId: TerminalSessionId
}

/** Result of killing a terminal. */
export interface TerminalKillValue {
  readonly closed: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Terminal service is unavailable. */
    'terminal/unavailable': {}
    /** Session is not live or agent is not owned. */
    'terminal/session-not-live': { readonly sessionId: SessionId }
    /** Terminal session not found. */
    'terminal/not-found': { readonly sessionId: SessionId; readonly terminalSessionId: TerminalSessionId }
    /** Terminal backend type not registered. */
    'terminal/no-backend': { readonly sessionId: SessionId; readonly type: string }
    /** Terminal name already in use. */
    'terminal/duplicate-name': { readonly sessionId: SessionId; readonly name: string }
    /** Terminal has active send operation. */
    'terminal/send-active': { readonly sessionId: SessionId; readonly terminalSessionId: TerminalSessionId }
  }
}
