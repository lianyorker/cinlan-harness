/**
 * Worktree Task Workspace bridge (`ctx.worktreeTaskWorkspaces`): registers
 * each materialized task checkout as a Workspace, titles it after the task,
 * links it to the Workspace registered at the task's source path, and attaches
 * the task's sessions through the registry's own validated `attachSession`.
 * @module @cinlan/worktree-task-workspace
 */

import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorktreeTask, WorktreeTaskChange } from '@cinlan/worktree-task'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { worktreeTaskWorkspaceSpec } from './spec.ts'
import type { WorktreeTaskWorkspaceLinkRecord } from './spec.ts'
import type { WorktreeTaskWorkspaceLink } from './types.ts'

export type { WorktreeTaskWorkspaceLink } from './types.ts'
export { worktreeTaskWorkspaceSpec, worktreeTaskWorkspaceLink } from './spec.ts'
export type { WorktreeTaskWorkspaceLinkRecord } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Task checkout Workspace links. */
    worktreeTaskWorkspaces: WorktreeTaskWorkspaces
  }

  interface Events {
    /**
     * The link set changed durably: a checkout Workspace was registered, its
     * parent was resolved, or its one-time membership backfill completed.
     * @mode emit
     */
    'worktree-task-workspaces/changed'(): void
  }
}

/**
 * Bridge between Worktree Task lifecycle and the Workspace registry. It
 * consumes committed `worktree-task/changed` transitions on one serial queue;
 * a failed step is logged and never fails the task operation that emitted it.
 * Hibernation, archival, and deletion keep the Workspace registration and its
 * link, so accounted sessions keep their group while the directory is absent.
 */
export class WorktreeTaskWorkspaces extends Service {
  static inject = ['storageDomain', 'workspaceRegistry', 'sessionPersistence']

  private domain?: Domain<typeof worktreeTaskWorkspaceSpec>
  private tail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'worktreeTaskWorkspaces')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(worktreeTaskWorkspaceSpec)
    this.domain = domain
    this.ctx.effect(() => async () => {
      await this.tail
      await domain.close()
    }, 'worktree-task-workspaces.domain')
    this.ctx.on('worktree-task/changed', (change) => { this.enqueue(() => this.apply(change)) })
    for (const task of this.ctx.get('worktreeTask')?.list() ?? []) {
      if (task.status === 'active') this.enqueue(async () => { await this.ensure(task) })
    }
  }

  /**
   * Current links whose checkout Workspace is still registered. A link whose
   * parent registration was deleted is returned without its parent.
   * @returns links in storage order.
   */
  links(): readonly WorktreeTaskWorkspaceLink[] {
    const registry = this.ctx.workspaceRegistry
    const result: WorktreeTaskWorkspaceLink[] = []
    for (const [workspaceId, record] of this.table().entries()) {
      if (registry.get(workspaceId) === undefined) continue
      const parent = record.parentWorkspaceId !== undefined && registry.get(record.parentWorkspaceId) !== undefined
        ? record.parentWorkspaceId
        : undefined
      result.push({
        workspaceId,
        taskId: record.taskId,
        createdAt: record.createdAt,
        ...(parent === undefined ? {} : { parentWorkspaceId: parent }),
      })
    }
    return result
  }

  /**
   * Resolve once every transition queued so far has been handled.
   * @returns settlement of the current queue tail.
   */
  settled(): Promise<void> {
    return this.tail
  }

  private enqueue(step: () => Promise<void>): void {
    this.tail = this.tail.then(step).catch((error: unknown) => {
      this.ctx.logger.warn(`worktree-task-workspaces: ${String(error)}`)
    })
  }

  private async apply(change: WorktreeTaskChange): Promise<void> {
    switch (change.transition) {
      case 'created':
      case 'activated':
        await this.ensure(change.task)
        return
      case 'bound': {
        const workspace = await this.ensure(change.task)
        /* v8 ignore next -- bindSession emits only with a session id. */
        if (workspace === undefined || change.sessionId === undefined) return
        await this.attach(workspace, change.sessionId)
        return
      }
      case 'unbound':
      case 'hibernated':
      case 'archived':
      case 'deleted':
        // The registration and its account outlive the checkout on purpose.
        return
      /* v8 ignore next 2 -- closed transition union. */
      default:
        assertNever(change.transition)
    }
  }

  /**
   * Register the task checkout as a Workspace and record its link. A missing
   * checkout directory is skipped: the next activation retries.
   */
  private async ensure(task: WorktreeTask): Promise<Workspace | undefined> {
    const checkout = await existingDirectory(task.checkoutPath)
    if (checkout === undefined) return undefined
    const registry = this.ctx.workspaceRegistry
    const existing = await registry.resolveByPath(checkout)
    const workspace = existing ?? await registry.create(checkout)
    const table = this.table()
    const current = table.get(workspace.id)
    if (current === undefined && existing === undefined) await workspace.setTitle(task.name)
    const parentWorkspaceId = await this.resolveParent(task, workspace.id)
    let next: WorktreeTaskWorkspaceLinkRecord = {
      taskId: task.id,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      ...(parentWorkspaceId === undefined ? {} : { parentWorkspaceId }),
      ...(current?.backfilledAt === undefined ? {} : { backfilledAt: current.backfilledAt }),
    }
    if (next.backfilledAt === undefined) {
      await this.backfill(workspace, task)
      next = { ...next, backfilledAt: new Date().toISOString() }
    }
    if (current === undefined || !sameLink(current, next)) {
      await table.put(workspace.id, next)
      this.ctx.emit('worktree-task-workspaces/changed')
    }
    return workspace
  }

  /** The source Workspace: the task's recorded id when its path matches, else the one registered at the source path. */
  private async resolveParent(task: WorktreeTask, self: WorkspaceId): Promise<WorkspaceId | undefined> {
    const registry = this.ctx.workspaceRegistry
    const source = await existingDirectory(task.sourcePath)
    if (source === undefined) return undefined
    const recorded = registry.get(task.workspaceId)
    const parent = recorded !== undefined && recorded.path === source
      ? recorded
      : await registry.resolveByPath(source)
    return parent === undefined || parent.id === self ? undefined : parent.id
  }

  /**
   * One-time account repair for a checkout: the task's bound sessions plus
   * stored sessions whose canonical cwd is the checkout, unless another
   * Workspace already accounts them.
   */
  private async backfill(workspace: Workspace, task: WorktreeTask): Promise<void> {
    const accounted = new Set<SessionId>()
    for (const other of this.ctx.workspaceRegistry.list()) {
      if (other.id === workspace.id) continue
      for (const id of other.sessionIds) accounted.add(id)
    }
    const candidates = new Set<SessionId>(task.sessionIds)
    for (const snapshot of await this.ctx.sessionPersistence.list()) {
      const cwd = snapshot.header.cwd
      if (cwd === undefined) continue
      if (await existingDirectory(cwd) === workspace.path) candidates.add(snapshot.header.id)
    }
    for (const id of candidates) {
      if (accounted.has(id) || workspace.sessionIds.includes(id)) continue
      await this.attach(workspace, id)
    }
  }

  /** Attach through the registry's validated path; a rejection (no header yet, other cwd) is logged only. */
  private async attach(workspace: Workspace, sessionId: SessionId): Promise<void> {
    try {
      await workspace.attachSession(sessionId)
    } catch (error: unknown) {
      this.ctx.logger.debug(
        `worktree-task-workspaces: session '${sessionId}' stays outside '${workspace.path}': ${String(error)}`,
      )
    }
  }

  private table(): KvTable<WorkspaceId, WorktreeTaskWorkspaceLinkRecord> {
    if (this.domain === undefined) throw new Error('worktree-task-workspaces is not started yet')
    return this.domain.table('links')
  }
}

/** Canonical path of an existing directory, or undefined when it is absent or unresolvable. */
async function existingDirectory(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpathNormalize(path)
    return (await stat(canonical)).isDirectory() ? canonical : undefined
  } catch {
    // ENOENT, a dangling link, or permission loss: the directory is not usable now.
    return undefined
  }
}

const sameLink = (left: WorktreeTaskWorkspaceLinkRecord, right: WorktreeTaskWorkspaceLinkRecord): boolean =>
  left.taskId === right.taskId
  && left.parentWorkspaceId === right.parentWorkspaceId
  && left.createdAt === right.createdAt
  && left.backfilledAt === right.backfilledAt

export default WorktreeTaskWorkspaces
