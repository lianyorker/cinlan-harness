/**
 * Explicit status-transition tables for the SQLite coordination provider.
 *
 * Every durable transition passes through one of these tables before it is
 * journaled: an illegal edge throws {@link INVALID_TRANSITION}, nothing is
 * written, and no event is emitted. Replay validates consecutive snapshots
 * against the same tables, so a tampered journal fails loudly at startup.
 * The `ready → failed` edge exists because executor contributions can unload
 * while a task sits admitted-but-undispatched.
 * @module
 */
import { CoordinationError } from '@cinlan/coordination'
import type { RunStatus, TaskStatus } from '@cinlan/coordination'

/** Legal task status transitions; terminal statuses list no outgoing edge. */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['ready', 'cancelled'],
  ready: ['running', 'cancelled', 'failed'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
}

/** Legal run status transitions; runs are published as `running` and end once. */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  pending: ['running'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
}

/** Assert one task status edge is legal, or fail closed with `INVALID_TRANSITION`. */
export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!TASK_TRANSITIONS[from].includes(to)) {
    throw new CoordinationError(`task status cannot transition from ${from} to ${to}`, 'INVALID_TRANSITION')
  }
}

/** Assert one run status edge is legal, or fail closed with `INVALID_TRANSITION`. */
export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!RUN_TRANSITIONS[from].includes(to)) {
    throw new CoordinationError(`run status cannot transition from ${from} to ${to}`, 'INVALID_TRANSITION')
  }
}
