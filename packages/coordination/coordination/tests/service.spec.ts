import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CoordinationError, CoordinationService, RunId, TaskId } from '@deepseek-ai/dsh-coordination'

class StubCoordination extends CoordinationService {
  registerExecutor(): () => void { return () => {} }
  start(): never { throw new Error('stub') }
  getRun(): never { throw new Error('stub') }
  getTask(): never { throw new Error('stub') }
  listTasks(): never[] { return [] }
  addTask(): never { throw new Error('stub') }
  cancel(): void {}
  sendMessage(taskId: TaskId, message: string) { return { taskId, message, createdAt: 0 } }
  onMessage(): () => void { return () => {} }
  requestApproval(): Promise<never> { return Promise.reject(new Error('stub')) }
  decideApproval(): void {}
  onApprovalRequest(): () => void { return () => {} }
  onEvent(): () => void { return () => {} }
}

describe('coordination Service Definition', () => {
  it('registers a concrete service under ctx.coordination', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(StubCoordination)
    expect(ctx.coordination).toBeInstanceOf(StubCoordination)
    await fiber.dispose()
    expect((ctx as Context & { coordination?: unknown }).coordination).toBeUndefined()
  })

  it('rejects the abstract seam at load', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(CoordinationService as unknown as typeof StubCoordination))
      .rejects.toThrow(/abstract coordination seam/)
  })

  it('exposes machine-routable diagnostics', () => {
    const cause = new Error('cause')
    const error = new CoordinationError('cycle', 'DEPENDENCY_CYCLE', { cause })
    expect(error.code).toBe('DEPENDENCY_CYCLE')
    expect(error.name).toBe('CoordinationError')
    expect(error.cause).toBe(cause)
    expect(RunId('run')).toBe('run')
    expect(TaskId('task')).toBe('task')
  })
})
