/**
 * Pure validation and normalization helpers for coordination providers.
 * No instance state: every function maps inputs to results or throws a
 * typed {@link CoordinationError}. Provider implementations share them so
 * admission rules cannot drift between the in-memory and durable providers.
 * @module
 */
import { randomUUID } from 'node:crypto'
import { serialize } from 'node:v8'
import { TaskId } from './brand.ts'
import { CoordinationError } from './types.ts'
import type {
  CoordinationApprovalRequest, RunStatus, TaskOutcome, TaskSpec, TaskStatus,
} from './types.ts'

/** A task spec with provider-assigned identity and defaults applied. */
export interface NormalizedTaskSpec extends TaskSpec {
  readonly id: TaskId
  readonly dependencies: readonly TaskId[]
}

export type TerminalTaskStatus = 'succeeded' | 'failed' | 'cancelled'
export type SettledTaskOutcome = { status: TerminalTaskStatus; output?: unknown; error?: string }

export function isTerminalTask(status: TaskStatus): status is TerminalTaskStatus {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export function isTerminalRun(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function normalizeSpec(spec: TaskSpec): NormalizedTaskSpec {
  if (typeof spec.label !== 'string' || spec.label.trim().length === 0 || typeof spec.executor !== 'string' || spec.executor.trim().length === 0) {
    throw new CoordinationError('task label and executor must be non-empty', 'INVALID_TASK')
  }
  return {
    ...spec,
    id: spec.id ?? TaskId(`task-${randomUUID()}`),
    dependencies: [...spec.dependencies ?? []],
    label: spec.label.trim(),
    executor: spec.executor.trim(),
    input: detachValue(spec.input, 'task input'),
  }
}

export function validateGraph(specs: readonly NormalizedTaskSpec[]): void {
  const byId = new Map<TaskId, NormalizedTaskSpec>()
  for (const spec of specs) {
    if (byId.has(spec.id)) throw new CoordinationError(`duplicate task ${String(spec.id)}`, 'DUPLICATE_TASK')
    byId.set(spec.id, spec)
  }
  for (const spec of specs) {
    for (const dependency of spec.dependencies) if (!byId.has(dependency)) {
      throw new CoordinationError(`task ${String(spec.id)} depends on missing task ${String(dependency)}`, 'DEPENDENCY_MISSING')
    }
    if (spec.parentId !== undefined && !byId.has(spec.parentId)) {
      throw new CoordinationError(`task ${String(spec.id)} has missing parent ${String(spec.parentId)}`, 'DEPENDENCY_MISSING')
    }
  }
  validateAcyclic(
    specs,
    spec => spec.dependencies,
    'dependency',
    'DEPENDENCY_CYCLE',
  )
  validateAcyclic(
    specs,
    spec => spec.parentId === undefined ? [] : [spec.parentId],
    'parent',
    'PARENT_CYCLE',
  )
}

function validateAcyclic(
  specs: readonly NormalizedTaskSpec[],
  related: (spec: NormalizedTaskSpec) => readonly TaskId[],
  label: 'dependency' | 'parent',
  code: 'DEPENDENCY_CYCLE' | 'PARENT_CYCLE',
): void {
  const byId = new Map(specs.map(spec => [spec.id, spec]))
  const visiting = new Set<TaskId>()
  const visited = new Set<TaskId>()
  const visit = (id: TaskId): void => {
    if (visiting.has(id)) throw new CoordinationError(`${label} cycle includes ${String(id)}`, code)
    if (visited.has(id)) return
    visiting.add(id)
    for (const next of related(byId.get(id) as NormalizedTaskSpec)) visit(next)
    visiting.delete(id)
    visited.add(id)
  }
  for (const spec of specs) visit(spec.id)
}

export function normalizeOutcome(value: TaskOutcome): { status: 'succeeded'; output?: unknown } | { status: 'failed'; error: string } | { status: 'cancelled'; error?: string } {
  switch (value.status) {
    case 'succeeded':
      return value.output === undefined
        ? { status: 'succeeded' }
        : { status: 'succeeded', output: detachValue(value.output, 'task output') }
    case 'failed': return { status: 'failed', error: value.error }
    case 'cancelled': return { status: 'cancelled', ...value.error === undefined ? {} : { error: value.error } }
  }
}

export function approvalKey(request: Pick<CoordinationApprovalRequest, 'taskId' | 'gateId'>): string {
  return `${String(request.taskId)}:${request.gateId}`
}

export function detachValue<T>(value: T, label: string): T {
  try {
    return structuredClone(value)
  } catch (error: unknown) {
    throw new CoordinationError(`${label} must be structured-cloneable`, 'INVALID_TASK', { cause: error })
  }
}

export function retainedByteLength(value: unknown, label: string): number {
  try {
    return serialize(value).byteLength
  } catch (error: unknown) {
    throw new CoordinationError(`${label} must be serializable for retained-byte accounting`, 'INVALID_TASK', { cause: error })
  }
}
