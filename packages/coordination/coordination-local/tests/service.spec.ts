import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RunId, TaskId } from '@deepseek-ai/dsh-coordination'
import type { CoordinationApprovalDecision, CoordinationEvent, TaskSnapshot } from '@deepseek-ai/dsh-coordination'
import { LocalCoordinationService, type Config } from '@deepseek-ai/dsh-coordination-local'

function deferred(): {
  readonly promise: Promise<void>
  resolve(): void
} {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

async function setup(config: Config = {}): Promise<{
  readonly ctx: Context
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalCoordinationService, config)
  return { ctx, fiber }
}

async function waitForStatus(ctx: Context, taskId: TaskId, status: TaskSnapshot['status']): Promise<void> {
  await vi.waitFor(() => { expect(ctx.coordination.getTask(taskId).status).toBe(status) })
}

describe('LocalCoordinationService scheduling', () => {
  it('runs reverse-declared dependencies and dynamically added tasks at bounded concurrency', async () => {
    const { ctx } = await setup({ maxConcurrency: 1 })
    const first = deferred()
    const order: string[] = []
    ctx.coordination.registerExecutor(' work ', async (task) => {
      order.push(`${String(task.id)}:start`)
      if (task.id === TaskId('a')) await first.promise
      order.push(`${String(task.id)}:end`)
      return { status: 'succeeded', output: task.input }
    })

    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('b'), label: 'B', executor: 'work', dependencies: [TaskId('a')], input: 2 },
      { id: TaskId('a'), label: 'A', executor: 'work', input: 1 },
      { id: TaskId('c'), label: 'C', executor: 'work', input: 3 },
    ] })
    const generated = ctx.coordination.addTask(run.snapshot.id, {
      label: ' generated ',
      executor: ' work ',
      dependencies: [TaskId('c')],
      input: 4,
    })

    await waitForStatus(ctx, TaskId('a'), 'running')
    expect(ctx.coordination.getRun(run.snapshot.id).status).toBe('running')
    expect(ctx.coordination.listTasks(run.snapshot.id)).toHaveLength(4)
    expect(run.snapshot.taskIds).toContain(generated)
    first.resolve()

    await expect(run.result).resolves.toMatchObject({ status: 'succeeded' })
    expect(ctx.coordination.getTask(generated)).toMatchObject({ label: 'generated', output: 4 })
    expect(order).toEqual([
      'a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end',
      `${String(generated)}:start`, `${String(generated)}:end`,
    ])
    run.cancel('too late')
    expect(run.snapshot.status).toBe('succeeded')
    await ctx.fiber.dispose()
  })

  it('propagates failure through a reverse-declared multi-level DAG to a terminal run', async () => {
    const { ctx } = await setup()
    ctx.coordination.registerExecutor('fail', task => task.id === TaskId('root')
      ? { status: 'failed', error: 'root failed' }
      : { status: 'succeeded', output: task.input })
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('leaf'), label: 'leaf', executor: 'fail', dependencies: [TaskId('middle')] },
      { id: TaskId('middle'), label: 'middle', executor: 'fail', dependencies: [TaskId('root')] },
      { id: TaskId('root'), label: 'root', executor: 'fail' },
    ] })

    await expect(run.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('root'))).toMatchObject({ status: 'failed', error: 'root failed' })
    expect(ctx.coordination.getTask(TaskId('middle'))).toMatchObject({ status: 'cancelled', error: 'dependency did not succeed' })
    expect(ctx.coordination.getTask(TaskId('leaf'))).toMatchObject({ status: 'cancelled', error: 'dependency did not succeed' })
    await ctx.fiber.dispose()
  })

  it('settles explicit executor outcomes and keeps status-like output as data', async () => {
    const { ctx } = await setup()
    ctx.coordination.registerExecutor('outcome', (task) => {
      switch (task.input) {
        case 'success': return { status: 'succeeded', output: 2 }
        case 'status-output': return { status: 'succeeded', output: { status: 'failed', error: 'data only' } }
        case 'failed': return { status: 'failed', error: 'task executor failed' }
        case 'cancelled': return { status: 'cancelled', error: 'executor cancelled' }
        case 'cancelled-without-error': return { status: 'cancelled' }
        case 'error': throw new Error('executor error')
        case 'string-error': throw 'string failure'
        default: throw new Error('unexpected outcome fixture')
      }
    })
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('success'), label: 'success', executor: 'outcome', input: 'success' },
      { id: TaskId('status-output'), label: 'status-output', executor: 'outcome', input: 'status-output' },
      { id: TaskId('failed'), label: 'failed', executor: 'outcome', input: 'failed' },
      { id: TaskId('cancelled'), label: 'cancelled', executor: 'outcome', input: 'cancelled' },
      { id: TaskId('cancelled-empty'), label: 'cancelled-empty', executor: 'outcome', input: 'cancelled-without-error' },
      { id: TaskId('error'), label: 'error', executor: 'outcome', input: 'error' },
      { id: TaskId('string-error'), label: 'string-error', executor: 'outcome', input: 'string-error' },
    ] })

    await expect(run.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('success')).output).toBe(2)
    expect(ctx.coordination.getTask(TaskId('status-output')).output).toEqual({ status: 'failed', error: 'data only' })
    expect(ctx.coordination.getTask(TaskId('failed')).error).toBe('task executor failed')
    expect(ctx.coordination.getTask(TaskId('cancelled')).error).toBe('executor cancelled')
    expect(ctx.coordination.getTask(TaskId('cancelled-empty')).error).toBeUndefined()
    expect(ctx.coordination.getTask(TaskId('error')).error).toBe('executor error')
    expect(ctx.coordination.getTask(TaskId('string-error')).error).toBe('string failure')
    await ctx.fiber.dispose()
  })

  it('fails a ready task when its executor contribution unloads before admission', async () => {
    const { ctx } = await setup()
    const unregister = ctx.coordination.registerExecutor('ephemeral', () => ({ status: 'succeeded' }))
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('task'), label: 'task', executor: 'ephemeral' },
    ] })
    unregister()

    await expect(run.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('task')).error).toContain('unavailable')
    await ctx.fiber.dispose()
  })

  it('fails a running task and frees its slot when its executor contribution unloads mid-flight', async () => {
    const { ctx } = await setup({ maxConcurrency: 1 })
    const release = deferred()
    let aborted = false
    // Never settles on its own until released, so only the unregister path can
    // move the task off `running`. A promise with no owner would otherwise hang.
    const unregister = ctx.coordination.registerExecutor('orphan', (_task, signal) => {
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
      return release.promise.then(() => ({ status: 'succeeded' }))
    })
    ctx.coordination.registerExecutor('after', () => ({ status: 'succeeded' }))

    const orphaned = ctx.coordination.start({ tasks: [{ id: TaskId('orphan'), label: 'orphan', executor: 'orphan' }] })
    await waitForStatus(ctx, TaskId('orphan'), 'running')
    unregister()

    // The running task is failed immediately with the admission diagnostic and
    // its controller is aborted best-effort, without awaiting the dead promise.
    await expect(orphaned.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('orphan')).error).toContain('unavailable')
    expect(aborted).toBe(true)

    // The concurrency slot was released, so a fresh single-slot run admits.
    const next = ctx.coordination.start({ tasks: [{ id: TaskId('next'), label: 'next', executor: 'after' }] })
    await expect(next.result).resolves.toMatchObject({ status: 'succeeded' })

    // A late settle of the orphaned executor's promise is absorbed: finish is
    // idempotent on a terminal task, so the slot is not released twice.
    release.resolve()
    await Promise.resolve()
    expect(ctx.coordination.getTask(TaskId('orphan')).status).toBe('failed')
    const readmit = ctx.coordination.start({ tasks: [{ id: TaskId('readmit'), label: 'readmit', executor: 'after' }] })
    await expect(readmit.result).resolves.toMatchObject({ status: 'succeeded' })
    await ctx.fiber.dispose()
  })
})

describe('LocalCoordinationService validation', () => {
  it('rejects invalid configuration and executor registrations', async () => {
    const invalid = new Context()
    await expect(invalid.plugin(LocalCoordinationService, { maxConcurrency: 0 })).rejects.toThrow()

    const { ctx } = await setup()
    expect(() => ctx.coordination.registerExecutor(' ', () => ({ status: 'succeeded' }))).toThrow(/non-empty/)
    ctx.coordination.registerExecutor('same', () => ({ status: 'succeeded' }))
    expect(() => ctx.coordination.registerExecutor(' same ', () => ({ status: 'succeeded' }))).toThrow(/already registered/)
    expect(() => ctx.coordination.start({ tasks: [] })).toThrow(/at least one task/)
    await ctx.fiber.dispose()
  })

  it('enforces run, task, and retained-byte caps before publication', async () => {
    const active = await setup({
      maxConcurrency: 1,
      maxActiveRuns: 1,
      maxTasksPerRun: 1,
      maxRetainedRuns: 1,
      maxRetainedBytes: 4096,
    })
    active.ctx.coordination.registerExecutor('wait', (_task, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    expect(() => active.ctx.coordination.start({ tasks: [
      { id: TaskId('too-many-a'), label: 'A', executor: 'wait' },
      { id: TaskId('too-many-b'), label: 'B', executor: 'wait' },
    ] })).toThrow(/per-run cap/)
    const first = active.ctx.coordination.start({ tasks: [
      { id: TaskId('active'), label: 'active', executor: 'wait' },
    ] })
    expect(() => active.ctx.coordination.addTask(first.snapshot.id, {
      id: TaskId('over-task-cap'), label: 'over task cap', executor: 'wait',
    })).toThrow(/task cap/)
    expect(() => active.ctx.coordination.start({ tasks: [
      { id: TaskId('second-active'), label: 'second', executor: 'wait' },
    ] })).toThrow(/active-run cap/)
    first.cancel()
    await first.result
    await active.ctx.fiber.dispose()

    const bytes = await setup({ maxRetainedBytes: 1 })
    bytes.ctx.coordination.registerExecutor('noop', () => ({ status: 'succeeded' }))
    expect(() => bytes.ctx.coordination.start({ tasks: [
      { id: TaskId('too-large'), label: 'too-large', executor: 'noop' },
    ] })).toThrow(/retained-byte cap/)
    await bytes.ctx.fiber.dispose()
  })

  it('evicts the oldest terminal run and releases its task ids', async () => {
    const { ctx } = await setup({ maxRetainedRuns: 1 })
    ctx.coordination.registerExecutor('noop', () => ({ status: 'succeeded' }))
    const evicted: RunId[] = []
    ctx.coordination.onEvent((event) => {
      if (event.type === 'run/evicted') evicted.push(event.run.id)
    })

    const first = ctx.coordination.start({ tasks: [
      { id: TaskId('reusable'), label: 'first', executor: 'noop' },
    ] })
    await first.result
    const second = ctx.coordination.start({ tasks: [
      { id: TaskId('second'), label: 'second', executor: 'noop' },
    ] })
    await second.result

    expect(evicted).toEqual([first.snapshot.id])
    expect(() => ctx.coordination.getRun(first.snapshot.id)).toThrow(/unknown run/)
    expect(() => ctx.coordination.getTask(TaskId('reusable'))).toThrow(/unknown task/)
    expect(ctx.coordination.getRun(second.snapshot.id).status).toBe('succeeded')

    const reused = ctx.coordination.start({ tasks: [
      { id: TaskId('reusable'), label: 'reused', executor: 'noop' },
    ] })
    await expect(reused.result).resolves.toMatchObject({ status: 'succeeded' })
    await ctx.fiber.dispose()
  })

  it('bounds oversized outcomes and cancellation diagnostics', async () => {
    const { ctx } = await setup({ maxRetainedBytes: 512 })
    const oversized = 'x'.repeat(2_000)
    ctx.coordination.registerExecutor('large-success', () => ({ status: 'succeeded', output: oversized }))
    ctx.coordination.registerExecutor('large-failure', () => ({ status: 'failed', error: oversized }))
    ctx.coordination.registerExecutor('wait', (_task, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))

    const succeeded = ctx.coordination.start({ tasks: [
      { id: TaskId('large-success'), label: 'large success', executor: 'large-success' },
    ] })
    await expect(succeeded.result).resolves.toMatchObject({ status: 'failed' })
    const succeededTask = ctx.coordination.getTask(TaskId('large-success'))
    expect(succeededTask.status).toBe('failed')
    expect(succeededTask.error).toContain('retained-byte cap')

    const failed = ctx.coordination.start({ tasks: [
      { id: TaskId('large-failure'), label: 'large failure', executor: 'large-failure' },
    ] })
    await expect(failed.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('large-failure')).error).toContain('retained-byte cap')

    const cancelled = ctx.coordination.start({ tasks: [
      { id: TaskId('large-cancel'), label: 'large cancel', executor: 'wait' },
    ] })
    await waitForStatus(ctx, TaskId('large-cancel'), 'running')
    cancelled.cancel(oversized)
    await expect(cancelled.result).resolves.toMatchObject({ status: 'cancelled' })
    expect(ctx.coordination.getTask(TaskId('large-cancel')).error).toContain('cancellation reason exceeded')
    await ctx.fiber.dispose()
  })

  it('evicts terminal runs to admit a larger declaration within the retained-byte cap', async () => {
    const { ctx } = await setup({ maxRetainedBytes: 512, maxRetainedRuns: 10 })
    ctx.coordination.registerExecutor('noop', () => ({ status: 'succeeded' }))
    const evicted: RunId[] = []
    ctx.coordination.onEvent((event) => {
      if (event.type === 'run/evicted') evicted.push(event.run.id)
    })
    const first = ctx.coordination.start({ tasks: [
      { id: TaskId('byte-first'), label: 'first', executor: 'noop' },
    ] })
    await first.result

    const second = ctx.coordination.start({ tasks: [
      { id: TaskId('byte-second'), label: 'second', executor: 'noop', input: 'x'.repeat(320) },
    ] })
    await second.result
    expect(evicted).toContain(first.snapshot.id)
    expect(() => ctx.coordination.getRun(first.snapshot.id)).toThrow(/unknown run/)
    expect(ctx.coordination.getRun(second.snapshot.id).status).toBe('succeeded')
    await ctx.fiber.dispose()
  })

  it('rejects invalid task fields, graph references, duplicates, and cycles before publication', async () => {
    const { ctx } = await setup()
    ctx.coordination.registerExecutor('test', () => ({ status: 'succeeded' }))
    for (const task of [
      { id: TaskId('label'), label: ' ', executor: 'test' },
      { id: TaskId('executor'), label: 'task', executor: ' ' },
      { id: TaskId('typed-label'), label: 1, executor: 'test' },
      { id: TaskId('typed-executor'), label: 'task', executor: 1 },
    ]) {
      expect(() => ctx.coordination.start({ tasks: [task as never] })).toThrow(/label and executor/)
    }
    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('duplicate'), label: 'one', executor: 'test' },
      { id: TaskId('duplicate'), label: 'two', executor: 'test' },
    ] })).toThrow(/duplicate task/)
    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('missing'), label: 'missing', executor: 'test', dependencies: [TaskId('absent')] },
    ] })).toThrow(/missing task/)
    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('orphan'), label: 'orphan', executor: 'test', parentId: TaskId('absent') },
    ] })).toThrow(/missing parent/)
    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('a'), label: 'A', executor: 'test', dependencies: [TaskId('b')] },
      { id: TaskId('b'), label: 'B', executor: 'test', dependencies: [TaskId('a')] },
    ] })).toThrow(/cycle/)
    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('self-parent'), label: 'self', executor: 'test', parentId: TaskId('self-parent') },
    ] })).toThrow(/parent cycle/)
    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('parent-a'), label: 'A', executor: 'test', parentId: TaskId('parent-b') },
      { id: TaskId('parent-b'), label: 'B', executor: 'test', parentId: TaskId('parent-a') },
    ] })).toThrow(/parent cycle/)
    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('missing-executor'), label: 'task', executor: 'missing' },
    ] })).toThrow(/unavailable/)
    await ctx.fiber.dispose()
  })

  it('detaches task input and output snapshots and rejects values that cannot be detached', async () => {
    const { ctx } = await setup()
    const input = { nested: { value: 1 } }
    ctx.coordination.registerExecutor('snapshot', (task) => {
      ;(task.input as { nested: { value: number } }).nested.value = 2
      return { status: 'succeeded', output: { nested: { value: 3 } } }
    })
    ctx.coordination.registerExecutor('invalid-output', () => ({
      status: 'succeeded',
      output: { callback: () => {} },
    }))
    ctx.coordination.registerExecutor('unaccountable-output', () => ({
      status: 'succeeded',
      output: new SharedArrayBuffer(8),
    }))

    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('snapshot'), label: 'snapshot', executor: 'snapshot', input },
    ] })
    input.nested.value = 9
    const firstResult = await run.result
    const secondResult = await run.result
    expect(firstResult).toMatchObject({ status: 'succeeded' })
    ;(firstResult.taskIds as TaskId[])[0] = TaskId('mutated-result')
    expect(secondResult.taskIds).toEqual([TaskId('snapshot')])

    const first = ctx.coordination.getTask(TaskId('snapshot'))
    expect(first.input).toEqual({ nested: { value: 1 } })
    expect(first.output).toEqual({ nested: { value: 3 } })
    ;(first.input as { nested: { value: number } }).nested.value = 7
    ;(first.output as { nested: { value: number } }).nested.value = 8
    expect(ctx.coordination.getTask(TaskId('snapshot'))).toMatchObject({
      input: { nested: { value: 1 } },
      output: { nested: { value: 3 } },
    })

    expect(() => ctx.coordination.start({ tasks: [
      { id: TaskId('invalid-input'), label: 'invalid-input', executor: 'snapshot', input: () => {} },
    ] })).toThrow(/task input must be structured-cloneable/)
    const invalidOutput = ctx.coordination.start({ tasks: [
      { id: TaskId('invalid-output'), label: 'invalid-output', executor: 'invalid-output' },
    ] })
    await expect(invalidOutput.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('invalid-output')).error).toContain('task output must be structured-cloneable')
    const unaccountableOutput = ctx.coordination.start({ tasks: [
      { id: TaskId('unaccountable-output'), label: 'unaccountable-output', executor: 'unaccountable-output' },
    ] })
    await expect(unaccountableOutput.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('unaccountable-output')).error).toContain('serializable for retained-byte accounting')
    await ctx.fiber.dispose()
  })

  it('rejects task ids already owned by another run before publication', async () => {
    const { ctx } = await setup({ maxConcurrency: 2 })
    const gate = deferred()
    const events: CoordinationEvent[] = []
    ctx.coordination.onEvent((event) => { events.push(event) })
    ctx.coordination.registerExecutor('wait', async () => {
      await gate.promise
      return { status: 'succeeded' }
    })
    const sharedId = TaskId('shared')
    const first = ctx.coordination.start({ tasks: [
      { id: sharedId, label: 'first', executor: 'wait' },
    ] })

    const beforeDuplicateStart = events.length
    let duplicateStart: unknown
    try {
      ctx.coordination.start({ tasks: [
        { id: sharedId, label: 'duplicate', executor: 'wait' },
      ] })
    } catch (error: unknown) {
      duplicateStart = error
    }
    expect(duplicateStart).toMatchObject({ code: 'DUPLICATE_TASK' })
    expect(events).toHaveLength(beforeDuplicateStart)
    expect(ctx.coordination.getTask(sharedId).runId).toBe(first.snapshot.id)

    const secondId = TaskId('second')
    const second = ctx.coordination.start({ tasks: [
      { id: secondId, label: 'second', executor: 'wait' },
    ] })
    const beforeDuplicateAdd = events.length
    let duplicateAdd: unknown
    try {
      ctx.coordination.addTask(second.snapshot.id, {
        id: sharedId,
        label: 'duplicate add',
        executor: 'wait',
      })
    } catch (error: unknown) {
      duplicateAdd = error
    }
    expect(duplicateAdd).toMatchObject({ code: 'DUPLICATE_TASK' })
    expect(events).toHaveLength(beforeDuplicateAdd)
    expect(ctx.coordination.listTasks(second.snapshot.id).map(task => task.id)).toEqual([secondId])
    expect(ctx.coordination.getTask(sharedId).runId).toBe(first.snapshot.id)

    gate.resolve()
    await Promise.all([first.result, second.result])
    await ctx.fiber.dispose()
  })

  it('validates dynamic tasks and unknown projections without mutating the run', async () => {
    const { ctx } = await setup({ maxConcurrency: 1 })
    const gate = deferred()
    ctx.coordination.registerExecutor('wait', async () => {
      await gate.promise
      return { status: 'succeeded' }
    })
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('root'), label: 'root', executor: 'wait' },
      { id: TaskId('child'), label: 'child', executor: 'wait', parentId: TaskId('root') },
    ] })
    await waitForStatus(ctx, TaskId('root'), 'running')

    expect(() => ctx.coordination.addTask(RunId('missing'), { label: 'x', executor: 'wait' })).toThrow(/unknown run/)
    expect(() => ctx.coordination.addTask(run.snapshot.id, { id: TaskId('root'), label: 'x', executor: 'wait' })).toThrow(/already exists/)
    expect(() => ctx.coordination.addTask(run.snapshot.id, {
      id: TaskId('missing-dependency'), label: 'x', executor: 'wait', dependencies: [TaskId('missing')],
    })).toThrow(/missing task/)
    expect(() => ctx.coordination.addTask(run.snapshot.id, {
      id: TaskId('missing-parent'), label: 'x', executor: 'wait', parentId: TaskId('missing'),
    })).toThrow(/missing parent/)
    expect(() => ctx.coordination.addTask(run.snapshot.id, { id: TaskId('missing-executor'), label: 'x', executor: 'missing' })).toThrow(/unavailable/)
    expect(() => ctx.coordination.getRun(RunId('missing'))).toThrow(/unknown run/)
    expect(() => ctx.coordination.getTask(TaskId('missing'))).toThrow(/unknown task/)
    expect(() => ctx.coordination.listTasks(RunId('missing'))).toThrow(/unknown run/)
    expect(() => { ctx.coordination.cancel(TaskId('missing')) }).toThrow(/unknown coordination target/)

    gate.resolve()
    await run.result
    expect(() => ctx.coordination.addTask(run.snapshot.id, { label: 'late', executor: 'wait' })).toThrow(/terminal/)
    await ctx.fiber.dispose()
  })

  it('accepts a shared dependency without revisiting it as a cycle', async () => {
    const { ctx } = await setup()
    ctx.coordination.registerExecutor('noop', () => ({ status: 'succeeded' }))
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('root'), label: 'root', executor: 'noop' },
      { id: TaskId('left'), label: 'left', executor: 'noop', dependencies: [TaskId('root')] },
      { id: TaskId('right'), label: 'right', executor: 'noop', dependencies: [TaskId('root')] },
      { id: TaskId('leaf'), label: 'leaf', executor: 'noop', dependencies: [TaskId('left'), TaskId('right')] },
    ] })
    await expect(run.result).resolves.toMatchObject({ status: 'succeeded' })
    await ctx.fiber.dispose()
  })
})

describe('LocalCoordinationService cancellation and approvals', () => {
  it('cancels a multi-level parent subtree, dependency descendants, and running executors', async () => {
    const { ctx } = await setup({ maxConcurrency: 1 })
    let observedReason: unknown
    ctx.coordination.registerExecutor('wait', (_task, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedReason = signal.reason
        reject(new Error('aborted executor'))
      }, { once: true })
    }))
    const ended: string[] = []
    ctx.coordination.onEvent((event) => { if (event.type === 'run/ended') ended.push(event.run.status) })
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('root'), label: 'root', executor: 'wait' },
      { id: TaskId('grandchild'), label: 'grandchild', executor: 'wait', parentId: TaskId('child') },
      { id: TaskId('child'), label: 'child', executor: 'wait', parentId: TaskId('root') },
      { id: TaskId('dependent'), label: 'dependent', executor: 'wait', dependencies: [TaskId('child')] },
    ] })
    await waitForStatus(ctx, TaskId('root'), 'running')

    ctx.coordination.cancel(TaskId('root'), 'stop subtree')
    await expect(run.result).resolves.toMatchObject({ status: 'cancelled' })
    expect(observedReason).toBe('stop subtree')
    for (const id of ['root', 'child', 'grandchild', 'dependent']) {
      expect(ctx.coordination.getTask(TaskId(id)).status).toBe('cancelled')
    }
    ctx.coordination.cancel(TaskId('root'))
    run.cancel()
    expect(ended).toEqual(['cancelled'])
    await ctx.fiber.dispose()
  })

  it('routes approval decisions while isolating throwing adapters', async () => {
    const { ctx } = await setup()
    const gate = deferred()
    ctx.coordination.registerExecutor('wait', async () => {
      await gate.promise
      return { status: 'succeeded' }
    })
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('task'), label: 'task', executor: 'wait' },
      { id: TaskId('other'), label: 'other', executor: 'wait' },
    ] })
    await waitForStatus(ctx, TaskId('task'), 'running')
    const warnings = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.coordination.onApprovalRequest(() => { throw new Error('sync adapter failure') })
    ctx.coordination.onApprovalRequest(() => Promise.reject(new Error('async adapter failure')))
    ctx.coordination.onApprovalRequest((request) => {
      ;(request as { prompt: string }).prompt = 'mutated by earlier adapter'
    })
    const observedPrompts: string[] = []
    ctx.coordination.onApprovalRequest((request) => {
      observedPrompts.push(request.prompt)
      ctx.coordination.decideApproval({ ...request, approved: true, decidedAt: Date.now() })
    })
    ctx.coordination.onEvent((event) => {
      if (event.type === 'task/approval-decided') {
        ;(event.decision as { approved: boolean }).approved = false
      }
    })

    await expect(ctx.coordination.requestApproval({
      taskId: TaskId('task'), gateId: 'gate', prompt: 'continue?',
    })).resolves.toMatchObject({ approved: true })
    expect(observedPrompts).toEqual(['continue?'])
    await vi.waitFor(() => { expect(warnings).toHaveBeenCalledTimes(2) })
    gate.resolve()
    await run.result
    await ctx.fiber.dispose()
  })

  it('validates approval gates and rejects pending gates on cancellation', async () => {
    const { ctx } = await setup()
    ctx.coordination.registerExecutor('wait', (_task, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('task'), label: 'task', executor: 'wait' },
      { id: TaskId('other'), label: 'other', executor: 'wait' },
    ] })
    await waitForStatus(ctx, TaskId('task'), 'running')

    expect(() => ctx.coordination.requestApproval({ taskId: TaskId('missing'), gateId: 'gate', prompt: 'continue?' })).toThrow(/unknown task/)
    expect(() => ctx.coordination.requestApproval({ taskId: TaskId('task'), gateId: 'gate', prompt: 'continue?' })).toThrow(/no approval adapter/)
    const stopListening = ctx.coordination.onApprovalRequest(() => undefined)
    expect(() => ctx.coordination.requestApproval({ taskId: TaskId('task'), gateId: ' ', prompt: 'continue?' })).toThrow(/non-empty/)
    expect(() => ctx.coordination.requestApproval({ taskId: TaskId('task'), gateId: 'gate', prompt: ' ' })).toThrow(/non-empty/)

    const request = { taskId: TaskId('task'), gateId: 'gate', prompt: 'continue?' }
    const pending = ctx.coordination.requestApproval(request)
    expect(() => ctx.coordination.requestApproval(request)).toThrow(/already pending/)
    expect(() => {
      ctx.coordination.decideApproval({ ...request, prompt: 'different', approved: true, decidedAt: 1 })
    }).toThrow(/does not match/)
    const decision: CoordinationApprovalDecision = { ...request, approved: false, decidedAt: 2 }
    ctx.coordination.decideApproval(decision)
    ;(decision as { approved: boolean }).approved = true
    await expect(pending).resolves.toEqual({ ...decision, approved: false })
    expect(() => { ctx.coordination.decideApproval(decision) }).toThrow(/not pending/)

    const other = ctx.coordination.requestApproval({ taskId: TaskId('other'), gateId: 'cancel', prompt: 'stop other?' })
    const otherResult = expect(other).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    const cancelled = ctx.coordination.requestApproval({ taskId: TaskId('task'), gateId: 'cancel', prompt: 'stop?' })
    const cancelledResult = expect(cancelled).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    run.cancel('approval cancelled')
    await otherResult
    await cancelledResult
    await run.result
    expect(() => ctx.coordination.requestApproval(request)).toThrow(/terminal/)
    stopListening()
    await ctx.fiber.dispose()
  })
})

describe('LocalCoordinationService listeners and disposal', () => {
  it('isolates event and message listener failures and removes disposed contributions', async () => {
    const { ctx } = await setup()
    const warnings = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const events: string[] = []
    const eventMessages: string[] = []
    const eventTaskInputs: number[] = []
    ctx.coordination.onEvent((event) => {
      if (event.type === 'task/message') {
        ;(event.message as { message: string }).message = 'mutated event message'
      }
      if (event.type === 'task/changed') {
        ;(event.task.input as { nested: { value: number } }).nested.value = 9
      }
    })
    const stopEvent = ctx.coordination.onEvent((event) => {
      events.push(event.type)
      if (event.type === 'task/message') eventMessages.push(event.message.message)
      if (event.type === 'task/changed') {
        eventTaskInputs.push((event.task.input as { nested: { value: number } }).nested.value)
      }
    })
    ctx.coordination.onEvent(() => { throw new Error('event sync') })
    ctx.coordination.onEvent(() => Promise.reject(new Error('event async')))
    const messages: string[] = []
    ctx.coordination.onMessage((message) => {
      ;(message as { message: string }).message = 'mutated listener message'
    })
    const stopMessage = ctx.coordination.onMessage((message) => { messages.push(message.message) })
    ctx.coordination.onMessage(() => { throw new Error('message sync') })
    ctx.coordination.onMessage(() => Promise.reject(new Error('message async')))
    ctx.coordination.registerExecutor('noop', () => ({ status: 'succeeded' }))
    const run = ctx.coordination.start({ tasks: [{
      id: TaskId('task'), label: 'task', executor: 'noop', input: { nested: { value: 1 } },
    }] })

    const returned = ctx.coordination.sendMessage(TaskId('task'), 'first', 'tester')
    expect(returned).toMatchObject({ message: 'first', sender: 'tester' })
    ;(returned as { message: string }).message = 'mutated return message'
    stopEvent()
    stopMessage()
    expect(ctx.coordination.sendMessage(TaskId('task'), 'second')).not.toHaveProperty('sender')
    expect(() => ctx.coordination.sendMessage(TaskId('task'), ' ')).toThrow(/non-empty/)
    await run.result
    await vi.waitFor(() => { expect(warnings.mock.calls.length).toBeGreaterThanOrEqual(6) })
    expect(events[0]).toBe('run/started')
    expect(eventMessages).toEqual(['first'])
    expect(eventTaskInputs).toEqual(expect.arrayContaining([1]))
    expect(messages).toEqual(['first'])
    expect(ctx.coordination.getTask(TaskId('task')).input).toEqual({ nested: { value: 1 } })
    await ctx.fiber.dispose()
  })

  it('unloads executor and listeners with the contributing Cordis fiber', async () => {
    const { ctx } = await setup()
    const events: string[] = []
    const contributor = await ctx.plugin({
      name: 'coordination-contributor',
      inject: ['coordination'],
      apply(child: Context) {
        child.coordination.registerExecutor('hmr', () => ({ status: 'succeeded' }))
        child.coordination.onEvent((event) => { events.push(event.type) })
        child.coordination.onMessage((message) => { events.push(message.message) })
        child.coordination.onApprovalRequest(() => undefined)
      },
    })
    const run = ctx.coordination.start({ tasks: [{ id: TaskId('first'), label: 'first', executor: 'hmr' }] })
    await run.result
    const count = events.length

    await contributor.dispose()
    expect(() => ctx.coordination.start({ tasks: [{ id: TaskId('second'), label: 'second', executor: 'hmr' }] })).toThrow(/unavailable/)
    ctx.coordination.sendMessage(TaskId('first'), 'after unload')
    expect(events).toHaveLength(count)
    await ctx.fiber.dispose()
  })

  it('closes listeners, rejects approvals, aborts executors, and waits for quiescence before disposal completes', async () => {
    const { ctx, fiber } = await setup()
    const release = deferred()
    let aborted = false
    ctx.coordination.registerExecutor('slow', async (_task, signal) => {
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
      await release.promise
      return { status: 'succeeded' }
    })
    const events: string[] = []
    ctx.coordination.onEvent((event) => { events.push(event.type) })
    ctx.coordination.onApprovalRequest(() => undefined)
    const run = ctx.coordination.start({ tasks: [{ id: TaskId('task'), label: 'task', executor: 'slow' }] })
    await waitForStatus(ctx, TaskId('task'), 'running')
    const approval = ctx.coordination.requestApproval({ taskId: TaskId('task'), gateId: 'gate', prompt: 'continue?' })
    const approvalResult = expect(approval).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    const service = ctx.coordination
    const beforeDispose = events.length
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })

    await vi.waitFor(() => { expect(aborted).toBe(true) })
    await approvalResult
    expect(disposed).toBe(false)
    expect(events).toHaveLength(beforeDispose)
    release.resolve()
    await disposal
    await expect(run.result).resolves.toMatchObject({ status: 'cancelled' })
    expect(events).toHaveLength(beforeDispose)
    expect((ctx as Context & { coordination?: unknown }).coordination).toBeUndefined()
    expect(() => service.start({ tasks: [{ label: 'stale', executor: 'slow' }] })).toThrow(/disposed/)
    await ctx.fiber.dispose()
  })
})
