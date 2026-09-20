/** Execution-aware directory verification, durable binding folding, and Workspace identity. */
import { stat } from 'node:fs/promises'
import { posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import type {} from '@deepseek-ai/dsh-execution-binding'
import type { ExecutionBinding } from '@deepseek-ai/dsh-execution-host-targets/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-fs'
import { realpathNormalize } from './paths.ts'
import { workspaceExecutionBinding } from './spec.ts'

/**
 * Fold the immutable execution selection from a validated Session log.
 * @param events - Durable events in sequence order.
 * @returns the captured binding, or `undefined` when the log has no binding event.
 * @throws when a binding event is malformed or changes the captured selection.
 */
export function foldDurableExecutionBinding(events: readonly SessionEvent[]): ExecutionBinding | undefined {
  let binding: ExecutionBinding | undefined
  for (const event of events) {
    if (event.type !== 'execution/bound') continue
    const next = workspaceExecutionBinding.parse(event.data.binding)
    if (binding !== undefined && JSON.stringify(binding) !== JSON.stringify(next)) {
      throw new Error('Session execution binding cannot change')
    }
    binding = next
  }
  return binding
}

/** The selected filesystem reports an absent or non-directory Workspace path. */
export class WorkspaceDirectoryMissingError extends Error {}

/**
 * Identify a canonical directory within one captured execution selection.
 * @param path - Canonical directory in the selected filesystem.
 * @param execution - Captured local or SSH selection.
 * @returns A stable key independent of object property insertion order.
 */
export function workspaceIdentity(path: string, execution: ExecutionBinding): string {
  if (execution.kind === 'local') return JSON.stringify(['local', path])
  const { endpoint } = execution
  return JSON.stringify([
    'ssh', execution.targetId, execution.revision,
    endpoint.host, endpoint.port, endpoint.username, endpoint.hostKeySHA256,
    execution.node, execution.helper, execution.helperHash, execution.workspace,
    execution.bootstrapPath, execution.bootstrapHash, path,
  ])
}

/**
 * Normalize a stored remote cwd without connecting or consulting the Host filesystem.
 * @param path - Absolute POSIX path recorded by Session admission.
 * @returns Its normalized absolute POSIX spelling.
 */
export function remoteWorkspacePath(path: string): string {
  if (!posix.isAbsolute(path) || path.includes('\0')) {
    throw new TypeError(`Workspace path is not an absolute remote path: '${path}'`)
  }
  return posix.normalize(path).replace(/\/$/, '') || '/'
}

/**
 * Verify a directory through one retained execution incarnation.
 * @param lease - Caller-owned lease retained through the complete check.
 * @param path - Absolute path in the lease filesystem; defaults to its admitted cwd.
 * @returns the provider's canonical process path.
 * @throws when the lease, filesystem, path, or directory is unavailable.
 */
export async function verifyWorkspaceLeaseDirectory(lease: ExecutionLease, path: string = lease.cwd): Promise<string> {
  lease.assertCurrent()
  if (lease.binding.kind === 'local') {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new WorkspaceDirectoryMissingError(`path '${path}' is not a directory`)
    }
    lease.assertCurrent()
    return canonical
  }
  remoteWorkspacePath(path)
  const fs = lease.ctx.get('fs')
  if (fs === undefined) throw new Error('workspace execution lease has no filesystem')
  const target = await fs.resolve(path, { cwd: lease.cwd, signal: lease.signal })
  if ((await fs.stat(target, lease.signal))?.type !== 'directory') {
    throw new WorkspaceDirectoryMissingError(`path '${path}' is not a directory`)
  }
  lease.assertCurrent()
  return remoteWorkspacePath(fs.processPath(target))
}

/**
 * Verify a directory in its captured execution world; release every acquired lease.
 * @param ctx - Host context providing optional execution bindings.
 * @param path - Directory to verify.
 * @param execution - Execution selection; local verification retains Host realpath semantics.
 * @returns The verified canonical path.
 */
export async function verifyWorkspaceDirectory(ctx: Context, path: string, execution: ExecutionBinding): Promise<string> {
  if (execution.kind === 'local') {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) throw new WorkspaceDirectoryMissingError(`path '${path}' is not a directory`)
    return canonical
  }
  const bindings = ctx.get('executionBindings')
  if (bindings === undefined) throw new Error('remote workspace requires executionBindings')
  remoteWorkspacePath(path)
  const lease = await bindings.acquire(execution, path)
  try {
    return await verifyWorkspaceLeaseDirectory(lease)
  } finally {
    await lease.release()
  }
}
