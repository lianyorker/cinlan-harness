/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */

import { stat } from 'node:fs/promises'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import type { ExecutionBinding } from '@deepseek-ai/dsh-execution-host-targets/types'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId } from './types.ts'
import { WorkspaceDirectoryMissingError, workspaceIdentity } from './execution.ts'

/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceMoveInvalidError'
  }
}

/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
  /**
   * Resolve the open `workspaces` table.
   * @returns the table; throws while the registry has not started yet.
   */
  table(): KvTable<WorkspaceId, WorkspaceRecord>

  /**
   * Read a session's canonical directory from the registry's header index.
   * @param id - Session whose indexed path is requested.
   * @returns the canonical directory, or `undefined` when the header is
   * missing or its cwd cannot identify an existing directory.
   */
  sessionPath(id: SessionId): string | undefined

  /**
   * Read the execution selection indexed alongside a Session path.
   * @param id - Indexed Session.
   * @returns Its captured selection, or undefined when it is not indexed.
   */
  sessionExecution(id: SessionId): ExecutionBinding | undefined

  /**
   * Read live or durable Session execution metadata; lookup failures reject.
   * @param id - Known Session whose execution selection is required.
   * @returns The captured selection, with legacy Sessions interpreted as local.
   */
  readSessionExecution(id: SessionId): Promise<ExecutionBinding>

  /**
   * Retain the execution incarnation admitted for one Session.
   * @param id - Session whose published execution world is required.
   * @returns a caller-owned lease, or `undefined` when the optional service is absent.
   */
  sessionLease(id: SessionId): Promise<ExecutionLease | undefined>

  /**
   * Verify an existing directory in the selected filesystem.
   * @param path - Directory to verify.
   * @param execution - Captured execution selection.
   * @returns Its canonical path; rejects on missing directories or unavailable execution.
   */
  verifyDirectory(path: string, execution: ExecutionBinding): Promise<string>

  /**
   * Verify the cwd through a retained execution lease.
   * @param lease - Caller-owned Session execution lease.
   * @param path - Session cwd or its managed source Workspace path.
   * @returns the provider-canonical directory.
   */
  verifyLeaseDirectory(lease: ExecutionLease, path?: string): Promise<string>

  /**
   * Cache the binding published by a successful Session lease.
   * @param id - Validated Session id.
   * @param execution - Binding carried by the retained lease.
   */
  rememberSessionExecution(id: SessionId, execution: ExecutionBinding): void

  /**
   * Resolve an exact managed checkout to its source Workspace.
   * @param id - Session from the immutable header.
   * @param cwd - Exact checkout path from that header.
   * @returns registered source path, or `undefined` for an unmanaged Session.
   */
  sourcePath(id: SessionId, cwd: string): string | undefined

  /**
   * Read one stored session header for attach validation.
   * @param id - The session whose header to read.
   * @returns the header; rejects when session persistence is absent or holds
   * no session with this id.
   */
  readSessionHeader(id: SessionId): Promise<SessionHeader>

  /**
   * Publish a successfully validated canonical cwd to the projection index.
   * @param id - Validated session id.
   * @param path - Canonical existing directory from the immutable header cwd.
   */
  rememberSessionPath(id: SessionId, path: string): void
}

/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)')

/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity implements Workspace {
  private record: WorkspaceRecord

  /**
   * @param host - Registry-owned table, session-path index, and header reads.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(
    private readonly host: WorkspaceEntityHost,
    readonly id: WorkspaceId,
    record: WorkspaceRecord,
  ) {
    this.record = record
  }

  get path(): string {
    return this.record.path
  }

  get execution(): ExecutionBinding {
    return this.record.execution
  }

  get title(): string {
    return this.record.title
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  get sessionIds(): readonly SessionId[] {
    return this.record.sessionIds.filter(id => this.matchesSession(id, this.record))
  }

  async setTitle(title: string): Promise<void> {
    await this.mutate(record => ({ ...record, title }))
  }

  async attachSession(sessionId: SessionId): Promise<void> {
    // Validate new membership through the published Session incarnation.
    if (!this.record.sessionIds.includes(sessionId)) {
      const header = await this.host.readSessionHeader(sessionId)
      if (header.cwd === undefined) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + 'its stored header carries no cwd to validate against',
        )
      }
      const lease = await this.host.sessionLease(sessionId)
      try {
        const execution = lease?.binding
          ?? this.host.sessionExecution(sessionId)
          ?? await this.host.readSessionExecution(sessionId)
        if (workspaceIdentity('', execution) !== workspaceIdentity('', this.execution)) {
          throw new Error(`cannot attach session '${sessionId}': execution binding differs from workspace '${this.id}'`)
        }
        let cwd: string
        try {
          if (lease !== undefined) {
            const source = lease.binding.kind === 'local' ? this.host.sourcePath(sessionId, header.cwd) : undefined
            cwd = await this.host.verifyLeaseDirectory(lease, source ?? lease.cwd)
          } else {
            const source = execution.kind === 'local' ? this.host.sourcePath(sessionId, header.cwd) : undefined
            cwd = await this.host.verifyDirectory(source ?? header.cwd, execution)
          }
        } catch (error) {
          throw new Error(
            `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
            + `its cwd '${header.cwd}' does not resolve, so it cannot be validated: ${String(error)}`,
            { cause: error },
          )
        }
        if (cwd !== this.record.path) {
          throw new Error(
            `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
            + `its cwd resolves to '${cwd}'`,
          )
        }
        this.host.rememberSessionExecution(sessionId, execution)
        this.host.rememberSessionPath(sessionId, cwd)
      } finally {
        await lease?.release()
      }
    }
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? record
      : { ...record, sessionIds: [sessionId, ...record.sessionIds] })
  }

  async insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    await this.mutate((record) => {
      if (!record.sessionIds.includes(sessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`,
        )
      }
      if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': `
          + 'the anchor session is not accounted',
        )
      }
      if (beforeSessionId === sessionId) return record
      const without = record.sessionIds.filter(id => id !== sessionId)
      const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
      const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
      return sessionIds.every((id, index) => id === record.sessionIds[index])
        ? record
        : { ...record, sessionIds }
    })
  }

  async detachSession(sessionId: SessionId): Promise<void> {
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId) }
      : record)
  }

  async status(): Promise<'ok' | 'missing-dir'> {
    if (this.execution.kind !== 'local') {
      try {
        await this.host.verifyDirectory(this.path, this.execution)
        return 'ok'
      } catch (error) {
        if (error instanceof WorkspaceDirectoryMissingError) return 'missing-dir'
        throw error
      }
    }
    try {
      return (await stat(this.record.path)).isDirectory() ? 'ok' : 'missing-dir'
    } catch {
      // Any stat failure (ENOENT, dangling parent, permission loss) means the
      // directory is not usable right now; the record itself never mutates.
      return 'missing-dir'
    }
  }

  private matchesSession(id: SessionId, record: WorkspaceRecord): boolean {
    const execution = this.host.sessionExecution(id)
    const path = this.host.sessionPath(id)
    return execution !== undefined && path !== undefined
      && workspaceIdentity(path, execution) === workspaceIdentity(record.path, record.execution)
  }

  /**
   * The single write path: run `fn` on the domain write chain via
   * `table.update`, stamping `updatedAt` and pruning candidates that no
   * longer pass the id-plus-canonical-cwd membership check, then swap the
   * snapshot.
   *
   * `fn` sees the value current at its chain slot, so membership decisions
   * (attach/detach idempotence) are race-free against queued writes; a fn
   * signalling no change by returning `current` verbatim aborts the slot
   * through the sentinel when pruning also finds nothing, so a no-op neither
   * rewrites the medium nor emits a change event.
   */
  private async mutate(fn: (record: WorkspaceRecord) => WorkspaceRecord): Promise<void> {
    let next: WorkspaceRecord
    try {
      next = await this.host.table().update(this.id, (current) => {
        const changed = fn(current)
        const sessionIds = changed.sessionIds.filter(
          id => this.matchesSession(id, changed),
        )
        if (changed === current && sessionIds.length === current.sessionIds.length) {
          throw unchangedSentinel
        }
        return { ...changed, sessionIds, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      if (error === unchangedSentinel) return
      throw error
    }
    this.record = next
  }
}
