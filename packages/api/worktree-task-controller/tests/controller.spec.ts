import { Context } from '@deepseek-ai/cordis'
import { WorktreeTaskError, WorktreeTaskId } from '@deepseek-ai/dsh-worktree-task'
import type { WorktreeTask, WorktreeTaskCleanupReceipt, WorktreeTaskReview, WorktreeTaskService, WorktreeTaskSettings } from '@deepseek-ai/dsh-worktree-task'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import WorktreeTaskController from '../src/index.ts'

function bench() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const receipt: WorktreeTaskCleanupReceipt = { operation: 'archive', status: 'succeeded',
    hook: { executable: '/fixture/node', args: ['cleanup.mjs', 'literal argument'] },
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' }
  const task: WorktreeTask = { id: WorktreeTaskId('fixture-task'), name: 'Reviewed task',
    workspaceId: 'fixture-workspace' as WorktreeTask['workspaceId'], sourcePath: '/source',
    baseRef: 'main', branch: 'task/fixture', checkoutPath: '/managed/task', status: 'archived',
    sessionIds: [], createdAt: receipt.startedAt, updatedAt: receipt.finishedAt, cleanupReceipt: receipt }
  const settings: WorktreeTaskSettings = { revision: 4, managedRoot: '/managed',
    value: { baseRef: 'main', defaultDirectory: 'team', setup: null, cleanup: receipt.hook } }
  const review: WorktreeTaskReview = { taskId: task.id, baseHead: 'a'.repeat(40), head: 'b'.repeat(40),
    checkoutRoot: '/managed/task', dirty: false, patch: 'diff --git a/file b/file\n+change\n',
    untracked: [], setup: null, cleanup: receipt.hook, cleanupReceipt: receipt }
  const provider = {
    get: vi.fn<WorktreeTaskService['get']>(() => task),
    list: vi.fn<WorktreeTaskService['list']>(() => [task]),
    settings: vi.fn<WorktreeTaskService['settings']>(() => settings),
    updateSettings: vi.fn<WorktreeTaskService['updateSettings']>(async () => settings),
    review: vi.fn<WorktreeTaskService['review']>(async () => review),
    archive: vi.fn<WorktreeTaskService['archive']>(async () => task),
    delete: vi.fn<WorktreeTaskService['delete']>(async () => ({ deleted: false, retainedBranch: task.branch, cleanupReceipt: receipt })),
  }
  // This controller fixture supplies only the service methods exercised below; Web tests own provider composition.
  ctx.provide('worktreeTask', provider as unknown as WorktreeTaskService)
  return { controller: new WorktreeTaskController(ctx), provider, task, receipt, settings, review,
    signal: new AbortController().signal, request: { taskId: task.id } }
}

describe('worktree task Remote results', () => {
  it('detaches nested cleanup receipts in task and deletion results', async () => {
    const h = bench()
    const read = h.controller.get(h.request, h.signal).task
    expect(read.cleanupReceipt).toEqual(h.receipt)
    expect(read.cleanupReceipt).not.toBe(h.receipt)
    expect(read.cleanupReceipt?.hook.args).not.toBe(h.receipt.hook.args)
    expect(h.controller.list(h.signal).items[0]?.cleanupReceipt).not.toBe(h.receipt)
    const archived = await h.controller.archive(h.request, h.signal)
    expect(h.provider.archive).toHaveBeenCalledWith(h.request, h.signal)
    expect(archived.task.cleanupReceipt).toEqual(h.receipt)
    const retained = await h.controller.delete(h.request, h.signal)
    expect(retained).toEqual({ status: 'retained', taskId: h.task.id, retainedBranch: h.task.branch, cleanupReceipt: h.receipt })
    expect(retained.cleanupReceipt?.hook.args).not.toBe(h.receipt.hook.args)
    h.provider.delete.mockResolvedValueOnce({ deleted: true, cleanupReceipt: h.receipt })
    expect(await h.controller.delete(h.request, h.signal)).toEqual({ status: 'deleted', taskId: h.task.id, cleanupReceipt: h.receipt })
  })

  it('forwards revisioned defaults and read-only review with caller cancellation', async () => {
    const h = bench()
    const value = h.controller.settings(h.signal)
    expect(value).toEqual(h.settings)
    expect(value.value.cleanup?.args).not.toBe(h.settings.value.cleanup?.args)
    const request = { expectedRevision: 4, value: h.settings.value }
    expect(await h.controller.updateSettings(request, h.signal)).toEqual(h.settings)
    expect(h.provider.updateSettings).toHaveBeenCalledWith(request, h.signal)
    const review = await h.controller.review(h.request, h.signal)
    expect(review).toEqual(h.review)
    expect(review.cleanupReceipt).not.toBe(h.receipt)
    expect(h.provider.review).toHaveBeenCalledWith(h.task.id, h.signal)
    h.provider.updateSettings.mockRejectedValueOnce(new WorktreeTaskError('conflict', 'defaults changed'))
    await expect(h.controller.updateSettings(request, h.signal)).rejects.toMatchObject({
      code: 'worktree-task/conflict', details: { operation: 'updateSettings' },
    })
  })

  it('refuses already cancelled work and maps unsettled cleanup without turning it into success', async () => {
    const h = bench()
    const abort = new AbortController()
    abort.abort(new Error('cancelled by caller'))
    await expect(h.controller.archive(h.request, abort.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(h.provider.archive).not.toHaveBeenCalled()
    h.provider.archive.mockRejectedValueOnce(new WorktreeTaskError('conflict', 'unsettled cleanup receipt'))
    await expect(h.controller.archive(h.request, h.signal)).rejects.toMatchObject({
      code: 'worktree-task/conflict', details: { operation: 'archive', taskId: h.task.id },
    })
    const pending = new AbortController()
    h.provider.review.mockImplementationOnce(async () => { pending.abort(); return h.review })
    await expect(h.controller.review(h.request, pending.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
  })
})
