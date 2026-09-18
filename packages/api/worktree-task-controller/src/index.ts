/** Host Remote controller for Worktree Task lifecycle management. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorktreeTaskError } from '@deepseek-ai/dsh-worktree-task'
import type { WorktreeTask, WorktreeTaskService } from '@deepseek-ai/dsh-worktree-task'
import type {
  WorktreeTaskId, WorktreeTaskSettings, UpdateWorktreeTaskSettingsRequest, WorktreeTaskReview,
} from '@deepseek-ai/dsh-worktree-task/types'
import type {
  WorktreeTaskBindSessionRequest,
  WorktreeTaskBindSessionValue,
  WorktreeTaskCreateRequest,
  WorktreeTaskCreateValue,
  WorktreeTaskDeleteValue,
  WorktreeTaskListValue,
  WorktreeTaskOperation,
  WorktreeTaskRequest,
  WorktreeTaskValue,
  WorktreeTaskView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `worktreeTasks` Remote namespace. */
    worktreeTaskController: WorktreeTaskController
  }
}

/** Host API exposing Worktree Task lifecycle operations. */
export class WorktreeTaskController extends TypertRemoteService {
  static inject = ['typert']

  /** @param ctx - Host context carrying the optional worktree task provider. */
  constructor(ctx: Context) {
    super(ctx, 'worktreeTaskController', { namespace: 'worktreeTasks' })
  }

  /**
   * Create a new Worktree Task with its own branch and worktree checkout.
   * @param request - Task name, workspace, source path, and optional base ref.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns detached created task projection.
   */
  @Remote('create')
  async create(request: WorktreeTaskCreateRequest, signal: AbortSignal): Promise<WorktreeTaskCreateValue> {
    this.admit('create', signal)
    try {
      const service = this.provider()
      const task = await service.create({
        name: request.name,
        workspaceId: request.workspaceId,
        sourcePath: request.sourcePath,
        ...(request.baseRef === undefined ? {} : { baseRef: request.baseRef }),
        ...(request.linkedIssue === undefined ? {} : { linkedIssue: request.linkedIssue }),
      }, signal)
      this.admit('create', signal)
      return { task: projectTask(task) }
    } catch (error) {
      throw mapFailure('create', undefined, error, signal)
    }
  }

  /**
   * List every task without activating a checkout.
   * @param signal - Caller cancellation checked before reading provider state.
   * @returns detached task projections.
   */
  @Remote('list')
  list(signal: AbortSignal): WorktreeTaskListValue {
    this.admit('list', signal)
    try {
      return { items: this.provider().list().map(projectTask) }
    } catch (error) {
      throw mapFailure('list', undefined, error, signal)
    }
  }

  /**
   * Get one task by id without filesystem work.
   * @param request - Task identity.
   * @param signal - Caller cancellation checked before reading provider state.
   * @returns detached task projection; an unknown id rejects with not-found.
   */
  @Remote('get')
  get(request: WorktreeTaskRequest, signal: AbortSignal): WorktreeTaskValue {
    this.admit('get', signal)
    try {
      const task = this.provider().get(request.taskId)
      return { task: projectTask(task) }
    } catch (error) {
      throw mapFailure('get', request.taskId, error, signal)
    }
  }

  /**
   * Read provider defaults without running hooks or materializing tasks.
   * @param signal - Caller cancellation checked before the read.
   * @returns detached defaults, revision, and managed root.
   */
  @Remote('settings')
  settings(signal: AbortSignal): WorktreeTaskSettings {
    this.admit('settings', signal)
    try {
      return structuredClone(this.provider().settings())
    } catch (error) {
      throw mapFailure('settings', undefined, error, signal)
    }
  }

  /**
   * Save defaults for future tasks without changing existing tasks or running hooks.
   * @param request - Complete defaults and the revision observed by the caller.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns persisted defaults with their new revision; a stale revision rejects.
   */
  @Remote('updateSettings')
  async updateSettings(request: UpdateWorktreeTaskSettingsRequest, signal: AbortSignal): Promise<WorktreeTaskSettings> {
    this.admit('updateSettings', signal)
    try {
      const settings = await this.provider().updateSettings(request, signal)
      this.admit('updateSettings', signal)
      return structuredClone(settings)
    } catch (error) {
      throw mapFailure('updateSettings', undefined, error, signal)
    }
  }

  /**
   * Read tracked changes against the captured base without activating a dormant task.
   * @param request - Provider-issued task identity.
   * @param signal - Caller cancellation forwarded to queued and active provider reads.
   * @returns complete bounded review, captured hooks, and untracked names without contents.
   */
  @Remote('review')
  async review(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskReview> {
    this.admit('review', signal)
    try {
      const review = await this.provider().review(request.taskId, signal)
      this.admit('review', signal)
      return structuredClone(review)
    } catch (error) {
      throw mapFailure('review', request.taskId, error, signal)
    }
  }

  /**
   * Bind a session to an existing task.
   * @param request - Task id and session id.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns updated task and checkout path.
   */
  @Remote('bindSession')
  async bindSession(request: WorktreeTaskBindSessionRequest, signal: AbortSignal): Promise<WorktreeTaskBindSessionValue> {
    this.admit('bindSession', signal)
    try {
      const service = this.provider()
      const result = await service.bindSession({ taskId: request.taskId, sessionId: request.sessionId }, signal)
      this.admit('bindSession', signal)
      return { task: projectTask(result.task), checkoutPath: result.checkoutPath }
    } catch (error) {
      throw mapFailure('bindSession', request.taskId, error, signal)
    }
  }

  /**
   * Reactivate a hibernated task's checkout.
   * @param request - Task identity.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns detached active task projection.
   */
  @Remote('activate')
  async activate(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue> {
    this.admit('activate', signal)
    try {
      const service = this.provider()
      const task = await service.activate({ taskId: request.taskId }, signal)
      this.admit('activate', signal)
      return { task: projectTask(task) }
    } catch (error) {
      throw mapFailure('activate', request.taskId, error, signal)
    }
  }

  /**
   * Checkpoint and reclaim one inactive task's checkout.
   * @param request - Task identity.
   * @param signal - Cancellation forwarded to queued work and provider subprocesses.
   * @returns detached hibernated task projection.
   */
  @Remote('hibernate')
  async hibernate(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue> {
    this.admit('hibernate', signal)
    try {
      const service = this.provider()
      const task = await service.hibernate({ taskId: request.taskId }, signal)
      this.admit('hibernate', signal)
      return { task: projectTask(task) }
    } catch (error) {
      throw mapFailure('hibernate', request.taskId, error, signal)
    }
  }

  /**
   * Run captured cleanup and archive a task, retaining its branch and records for review.
   * A succeeded receipt prevents repeat execution; an unsettled receipt rejects another attempt.
   * @param request - Task identity; repeating a settled failure explicitly retries cleanup.
   * @param signal - Cancellation forwarded to queued work and provider subprocesses.
   * @returns detached archived task projection, including any cleanup receipt.
   */
  @Remote('archive')
  async archive(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue> {
    this.admit('archive', signal)
    try {
      const service = this.provider()
      const task = await service.archive({ taskId: request.taskId }, signal)
      this.admit('archive', signal)
      return { task: projectTask(task) }
    } catch (error) {
      throw mapFailure('archive', request.taskId, error, signal)
    }
  }

  /**
   * Archive through captured cleanup, then remove an integrated task branch when safe.
   * An unmerged branch remains archived and reviewable; successful cleanup is not repeated.
   * @param request - Task identity; repeating a settled failure explicitly retries cleanup.
   * @param signal - Cancellation forwarded to queued work and provider subprocesses.
   * @returns deletion or retained-branch result, including any cleanup receipt.
   */
  @Remote('delete')
  async delete(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskDeleteValue> {
    this.admit('delete', signal)
    try {
      const service = this.provider()
      const result = await service.delete({ taskId: request.taskId }, signal)
      this.admit('delete', signal)
      const receipt = result.cleanupReceipt === undefined ? {} : { cleanupReceipt: structuredClone(result.cleanupReceipt) }
      if (result.deleted) return { status: 'deleted', taskId: request.taskId, ...receipt }
      // oxlint-disable-next-line typescript/no-non-null-assertion -- A retained deletion result identifies its surviving branch.
      return { status: 'retained', taskId: request.taskId, retainedBranch: result.retainedBranch!, ...receipt }
    } catch (error) {
      throw mapFailure('delete', request.taskId, error, signal)
    }
  }

  private provider(): WorktreeTaskService {
    const provider = this.ctx.get('worktreeTask')
    if (provider === undefined) {
      throw new RemoteError(
        'worktree-task/unavailable',
        'Worktree Task provider is unavailable in this Host composition',
        {},
      )
    }
    return provider
  }

  private admit(operation: WorktreeTaskOperation, signal: AbortSignal): void {
    if (signal.aborted) throw cancelled(operation, signal.reason)
  }
}

/** Project one trusted provider object into detached JSON data. */
function projectTask(task: WorktreeTask): WorktreeTaskView {
  return {
    taskId: task.id,
    name: task.name,
    workspaceId: task.workspaceId,
    sourcePath: task.sourcePath,
    baseRef: task.baseRef,
    branch: task.branch,
    checkoutPath: task.checkoutPath,
    status: task.status,
    ...(task.cleanupReceipt === undefined ? {} : { cleanupReceipt: structuredClone(task.cleanupReceipt) }),
    ...(task.linkedIssue === undefined ? {} : { linkedIssue: task.linkedIssue }),
    sessionIds: [...task.sessionIds],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function mapFailure(
  operation: WorktreeTaskOperation,
  taskId: WorktreeTaskId | undefined,
  error: unknown,
  signal?: AbortSignal,
): unknown {
  if (signal?.aborted === true) return cancelled(operation, error)
  if (!(error instanceof WorktreeTaskError)) return error
  if (error.code === 'unavailable') {
    return new RemoteError('worktree-task/unavailable', error.message, {}, { cause: error })
  }
  if (error.code === 'not-found' && taskId !== undefined) {
    return new RemoteError('worktree-task/not-found', error.message, { operation, taskId }, { cause: error })
  }
  if (error.code === 'busy' && taskId !== undefined) {
    return new RemoteError('worktree-task/busy', error.message, { operation, taskId }, { cause: error })
  }
  if (error.code === 'conflict') {
    return new RemoteError('worktree-task/conflict', error.message,
      { operation, ...(taskId === undefined ? {} : { taskId }) }, { cause: error })
  }
  return new RemoteError(
    'worktree-task/operation-failed',
    error.message,
    { operation, ...(taskId === undefined ? {} : { taskId }), providerCode: error.code },
    { cause: error },
  )
}

function cancelled(operation: WorktreeTaskOperation, cause: unknown): RemoteError<'gateway/cancelled'> {
  return new RemoteError(
    'gateway/cancelled',
    `Worktree task ${operation} was cancelled`,
    {},
    { cause },
  )
}

export default WorktreeTaskController
