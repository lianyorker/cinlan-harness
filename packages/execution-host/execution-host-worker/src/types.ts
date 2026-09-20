/** Pure wire DTOs shared by execution-host workers and target managers. */

import type { ExecutionHostId, ExecutionHostInfo } from '@deepseek-ai/dsh-execution-host/types'

/** An explicitly exported directory; paths belong to the worker execution world. */
export interface ExportedRoot {
  /** Unique root identifier within this worker, used by inspection requests. */
  readonly id: string
  /** Human-readable directory name shown to the caller. */
  readonly label: string
  /** Directory path resolved in the worker's execution world at startup. */
  readonly path: string
}

/** Initialized worker identity and its implemented operations. */
export interface WorkerInfo {
  readonly protocolVersion: 1
  readonly executionHost: ExecutionHostInfo
  readonly roots: readonly ExportedRoot[]
  readonly capabilities: readonly ['directory-inspection']
}

/** Bounded metadata for the direct children of a root-relative directory. */
export interface DirectoryInspection {
  readonly executionHostId: ExecutionHostId
  readonly rootId: string
  readonly path: string
  readonly entries: readonly {
    readonly name: string
    readonly type: 'file' | 'directory' | 'symlink' | 'other'
  }[]
  readonly truncated: boolean
}

/** Sanitized operation outcome; provider errors never cross the wire verbatim. */
export type WorkerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Handshake parameters; unsupported integer versions receive UNSUPPORTED_VERSION. */
export interface InitializeParams { readonly protocolVersion: number }

/** Inspection parameters; operation IDs must be unique while active or retained. */
export interface InspectDirectoryParams {
  readonly operationId: string
  readonly expectedHostId: string
  readonly rootId: string
  readonly path: string
}

/** Cancellation names an active or recently completed inspection. */
export interface CancelParams { readonly operationId: string }
