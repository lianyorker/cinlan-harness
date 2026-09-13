import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { RunId, TaskId } from '@deepseek-ai/dsh-coordination'
import type { CoordinationEventListener } from '@deepseek-ai/dsh-coordination'
import LocalCoordinationService from '@deepseek-ai/dsh-coordination-local'
import type { Config as CoordinationConfig } from '@deepseek-ai/dsh-coordination-local'
import * as subagentExecutor from '@deepseek-ai/dsh-coordination-subagent-executor'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest, SubagentCapabilities, SubagentProvider, SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as tool from '@deepseek-ai/dsh-tool-coordination'

const signal = new AbortController().signal

function fakeAgent(ctx: Context, id: string): Agent {
  const sessionId = SessionId(id)
  return {
    id: sessionId,
    ctx,
    status: 'idle',
    session: { id: sessionId, header: {} },
  } as unknown as Agent
}

async function setup(config: Partial<tool.Config> = {}, coordinationConfig: CoordinationConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalCoordinationService, { maxConcurrency: 4, ...coordinationConfig })
  const toolFiber = await ctx.plugin(tool, { defaultExecutor: 'test', waitTimeoutMs: 10, maxWaitTimeoutMs: 100, ...config })
  const owner = fakeAgent(ctx, 'owner')
  const other = fakeAgent(ctx, 'other')
  const removeOwner = ctx.agents.register(owner)
  ctx.agents.register(other)
  return { ctx, owner, other, removeOwner, toolFiber }
}

let callCounter = 0
function call(ctx: Context, agent: Agent, name: string, args: unknown, callSignal = signal) {
  return ctx.tools.execute({
    callId: ToolCallId(`coordination-${++callCounter}`),
    name,
    arguments: args,
    agent,
    signal: callSignal,
  })
}

function directCall(ctx: Context, agent: Agent, name: string, args: unknown, callSignal: AbortSignal) {
  const callId = ToolCallId(`coordination-direct-${++callCounter}`)
  const definition = ctx.tools.get(name)
  if (definition === undefined) throw new Error(`missing tool ${name}`)
  return definition.execute(args, {
    callId,
    rootCallId: callId,
    name,
    arguments: args,
    agent,
    signal: callSignal,
    token: Symbol('coordination-test'),
    deferContext() {},
    concludeTurn() {},
  } as unknown as ToolRunContext)
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

function value(result: Awaited<ReturnType<typeof call>>): Record<string, unknown> {
  if (result.isError) throw new Error(result.content.map(block => block.type === 'text' ? block.text : '').join(''))
  return result.value as Record<string, unknown>
}

describe('tool-coordination', () => {
  it('registers six structured tools and removes them with the plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalCoordinationService, { maxConcurrency: 1 })
    const fiber = await ctx.plugin(tool, {})
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining([
      'coordination_start',
      'coordination_add_task',
      'coordination_status',
      'coordination_wait',
      'coordination_cancel',
      'coordination_send_message',
    ]))
    const start = ctx.tools.schemas().find(schema => schema.name === 'coordination_start')
    expect(start).toMatchObject({
      parameters: {
        type: 'object',
        required: ['tasks'],
        properties: { tasks: { type: 'array' } },
      },
    })

    await fiber.dispose()
    expect(ctx.tools.get('coordination_start')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('renders every tool call with stable generic presentation metadata', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('coordination_start')?.presentCall?.({ tasks: [] })).toEqual({
      card: 'generic', title: 'Start coordination run with 0 task(s)', kind: 'execute',
    })
    expect(ctx.tools.get('coordination_add_task')?.presentCall?.({
      run_id: 'run-1', task: { label: 'task', prompt: 'do it' },
    })).toEqual({
      card: 'generic', title: 'Add task to coordination run run-1', kind: 'execute', rawInput: 'run-1',
    })
    for (const [name, title, kind] of [
      ['coordination_status', 'Read coordination status', 'read'],
      ['coordination_wait', 'Wait for coordination work', 'read'],
      ['coordination_cancel', 'Cancel coordination work', 'execute'],
    ] as const) {
      expect(ctx.tools.get(name)?.presentCall?.({ run_id: 'run-1' })).toEqual({
        card: 'generic', title, kind, rawInput: 'run-1',
      })
      expect(ctx.tools.get(name)?.presentCall?.({ task_id: 'task-1' })).toEqual({
        card: 'generic', title, kind, rawInput: 'task-1',
      })
    }
    expect(ctx.tools.get('coordination_status')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Read coordination status', kind: 'read',
    })
    expect(ctx.tools.get('coordination_send_message')?.presentCall?.({
      task_id: 'task-1', message: 'note',
    })).toEqual({
      card: 'generic', title: 'Send message to coordination task task-1', kind: 'execute', rawInput: 'task-1',
    })
    await ctx.fiber.dispose()
  })

  it('starts, waits for, reads, and messages an owned DAG', async () => {
    const { ctx, owner } = await setup()
    const seen: unknown[] = []
    const messages: string[] = []
    ctx.coordination.registerExecutor('test', async (task) => {
      seen.push(task.input)
      return { status: 'succeeded', output: { answer: task.label } }
    })
    ctx.coordination.onMessage((message) => { messages.push(message.message) })

    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'first', label: 'First', prompt: 'do first' },
      { task_id: 'second', label: 'Second', prompt: 'do second', dependencies: ['first'] },
    ] }))
    const run = started['run'] as { id: string }
    expect(run.id).toMatch(/^run-/)

    const waited = value(await call(ctx, owner, 'coordination_wait', { run_id: run.id, timeout_ms: 100 }))
    expect(waited).toMatchObject({ run: { status: 'succeeded' }, timedOut: false })
    expect(waited['tasks']).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'first', status: 'succeeded', output: { answer: 'First' } }),
      expect.objectContaining({ id: 'second', status: 'succeeded', output: { answer: 'Second' } }),
    ]))
    expect(seen).toEqual([
      { prompt: 'do first', parentAgentId: 'owner' },
      { prompt: 'do second', parentAgentId: 'owner' },
    ])

    const status = value(await call(ctx, owner, 'coordination_status', { task_id: 'second' }))
    expect(status).toMatchObject({ task: { id: 'second', runId: run.id, status: 'succeeded' } })
    const sent = value(await call(ctx, owner, 'coordination_send_message', {
      task_id: 'second', message: 'record this',
    }))
    expect(sent).toMatchObject({ taskId: 'second', message: 'record this', sender: 'owner' })
    expect(messages).toEqual(['record this'])
    await ctx.fiber.dispose()
  })

  it('generates task ids, omits non-JSON outputs, and rejects unknown task ownership', async () => {
    const { ctx, owner } = await setup()
    ctx.coordination.registerExecutor('test', () => ({ status: 'succeeded', output: 1n }))

    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { label: 'Generated', prompt: 'return bigint' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    const taskId = ((started['tasks'] as { id: string }[])[0] as { id: string }).id
    expect(taskId).toMatch(/^task-/)
    await call(ctx, owner, 'coordination_wait', { run_id: runId, timeout_ms: 100 })

    const status = value(await call(ctx, owner, 'coordination_status', { task_id: taskId }))
    expect(status).toMatchObject({ task: { id: taskId, status: 'succeeded', outputOmitted: true } })
    expect(status['task']).not.toHaveProperty('output')

    const unknown = await call(ctx, owner, 'coordination_status', { task_id: 'missing' })
    expect(unknown.isError).toBe(true)
    expect(unknown.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('unknown or inaccessible')

    const blank = await call(ctx, owner, 'coordination_start', { tasks: [
      { label: ' ', prompt: 'invalid' },
    ] })
    expect(blank.isError).toBe(true)
    expect(blank.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('label must be non-empty')
    await ctx.fiber.dispose()
  })

  it('recognizes every terminal task status on immediate waits', async () => {
    const { ctx, owner } = await setup({ defaultExecutor: 'outcome' })
    ctx.coordination.registerExecutor('outcome', task => task.label === 'Success'
      ? { status: 'succeeded' }
      : task.label === 'Failure'
        ? { status: 'failed', error: 'failed' }
        : { status: 'cancelled' })
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'success', label: 'Success', prompt: 'x' },
      { task_id: 'failure', label: 'Failure', prompt: 'x' },
      { task_id: 'cancelled', label: 'Cancelled', prompt: 'x' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    await call(ctx, owner, 'coordination_wait', { run_id: runId, timeout_ms: 100 })

    for (const [taskId, status] of [
      ['success', 'succeeded'], ['failure', 'failed'], ['cancelled', 'cancelled'],
    ] as const) {
      const waited = value(await call(ctx, owner, 'coordination_wait', { task_id: taskId, timeout_ms: 100 }))
      expect(waited).toMatchObject({ task: { id: taskId, status }, timedOut: false })
    }
    expect(value(await call(ctx, owner, 'coordination_wait', { task_id: 'success' })))
      .toMatchObject({ task: { status: 'succeeded' }, timedOut: false })
    await ctx.fiber.dispose()
  })

  it('adds a task to a live run and cancels the resulting subtree', async () => {
    const { ctx, owner } = await setup()
    ctx.coordination.registerExecutor('test', (_task, taskSignal) => new Promise((resolve) => {
      taskSignal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'root', label: 'Root', prompt: 'wait' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    const added = value(await call(ctx, owner, 'coordination_add_task', {
      run_id: runId,
      task: { task_id: 'child', label: 'Child', prompt: 'wait', parent_task_id: 'root' },
    }))
    expect(added).toMatchObject({ id: 'child', parentId: 'root' })

    const cancelled = value(await call(ctx, owner, 'coordination_cancel', {
      task_id: 'root', reason: 'stop subtree',
    }))
    expect(cancelled).toMatchObject({ task: { id: 'root' } })
    const terminal = value(await call(ctx, owner, 'coordination_wait', { run_id: runId, timeout_ms: 100 }))
    expect(terminal).toMatchObject({ run: { status: 'cancelled' }, timedOut: false })
    expect(terminal['tasks']).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'root', status: 'cancelled' }),
      expect.objectContaining({ id: 'child', status: 'cancelled' }),
    ]))
    await ctx.fiber.dispose()
  })

  it('fences runs by the exact live caller and cancels them when their owner disappears', async () => {
    const { ctx, owner, other, removeOwner } = await setup()
    ctx.coordination.registerExecutor('test', (_task, taskSignal) => new Promise((resolve) => {
      taskSignal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'owned', label: 'Owned', prompt: 'wait' },
    ] }))
    const runId = (started['run'] as { id: string }).id

    const foreign = await call(ctx, other, 'coordination_status', { run_id: runId })
    expect(foreign.isError).toBe(true)
    expect(foreign.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('unknown or inaccessible')

    removeOwner()
    await vi.waitFor(() => { expect(ctx.coordination.getRun(RunId(runId))).toMatchObject({ status: 'cancelled' }) })
    const stale = await call(ctx, owner, 'coordination_status', { run_id: runId })
    expect(stale.isError).toBe(true)
    expect(stale.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('exact live calling agent')
    await ctx.fiber.dispose()
  })

  it('cancels only live owned runs when the tool plugin is disposed', async () => {
    const { ctx, owner, toolFiber } = await setup()
    ctx.coordination.registerExecutor('done', () => ({ status: 'succeeded' }))
    ctx.coordination.registerExecutor('test', (_task, taskSignal) => new Promise((resolve) => {
      taskSignal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const finished = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'finished', label: 'Finished', prompt: 'done', executor: 'done' },
    ] }))
    const finishedRunId = (finished['run'] as { id: string }).id
    await call(ctx, owner, 'coordination_wait', { run_id: finishedRunId, timeout_ms: 100 })
    const active = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'active', label: 'Active', prompt: 'wait' },
    ] }))
    const activeRunId = (active['run'] as { id: string }).id
    await vi.waitFor(() => { expect(ctx.coordination.getTask(TaskId('active')).status).toBe('running') })

    await toolFiber.dispose()
    await vi.waitFor(() => {
      expect(ctx.coordination.getRun(RunId(activeRunId)).status).toBe('cancelled')
    })
    expect(ctx.coordination.getRun(RunId(finishedRunId)).status).toBe('succeeded')
    expect(ctx.tools.get('coordination_start')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('preserves coordination error codes and drops ownership when the provider evicts a run', async () => {
    const { ctx, owner } = await setup({}, { maxRetainedRuns: 1 })
    ctx.coordination.registerExecutor('test', () => ({ status: 'succeeded' }))

    const unavailable = await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'missing-executor', label: 'missing', prompt: 'run', executor: 'missing' },
    ] })
    expect(unavailable).toMatchObject({
      isError: true,
      error: { info: { name: 'CoordinationError', code: 'EXECUTOR_UNAVAILABLE' } },
    })

    const first = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'first-evicted', label: 'first', prompt: 'run' },
    ] }))
    const firstRunId = (first['run'] as { id: string }).id
    await call(ctx, owner, 'coordination_wait', { run_id: firstRunId, timeout_ms: 100 })
    const second = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'second-retained', label: 'second', prompt: 'run' },
    ] }))
    const secondRunId = (second['run'] as { id: string }).id
    await call(ctx, owner, 'coordination_wait', { run_id: secondRunId, timeout_ms: 100 })

    const evicted = await call(ctx, owner, 'coordination_status', { run_id: firstRunId })
    expect(evicted.isError).toBe(true)
    expect(evicted.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('unknown or inaccessible')
    await ctx.fiber.dispose()
  })

  it('returns current state after a bounded wait timeout and rejects malformed targets', async () => {
    const { ctx, owner } = await setup()
    ctx.coordination.registerExecutor('test', (_task, taskSignal) => new Promise((resolve) => {
      taskSignal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'slow', label: 'Slow', prompt: 'wait' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    const timed = value(await call(ctx, owner, 'coordination_wait', { run_id: runId, timeout_ms: 1 }))
    expect(timed).toMatchObject({ run: { status: 'running' }, timedOut: true })

    const malformed = await call(ctx, owner, 'coordination_status', { run_id: runId, task_id: 'slow' })
    expect(malformed.isError).toBe(true)
    expect(malformed.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('exactly one')
    await call(ctx, owner, 'coordination_cancel', { run_id: runId })
    await ctx.fiber.dispose()
  })

  it('settles active run and task waits from lifecycle events and ignores stale queued callbacks', async () => {
    const { ctx, owner } = await setup({ defaultExecutor: 'wait' })
    const gate = deferred()
    ctx.coordination.registerExecutor('wait', async () => {
      await gate.promise
      return { status: 'succeeded' }
    })
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'event-task', label: 'Event task', prompt: 'wait' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    await vi.waitFor(() => { expect(ctx.coordination.getTask(TaskId('event-task')).status).toBe('running') })

    const listeners: CoordinationEventListener[] = []
    const originalOnEvent = ctx.coordination.onEvent.bind(ctx.coordination)
    const listen = vi.spyOn(ctx.coordination, 'onEvent').mockImplementation((listener) => {
      listeners.push(listener)
      return originalOnEvent(listener)
    })
    const taskWait = directCall(ctx, owner, 'coordination_wait', { task_id: 'event-task', timeout_ms: 100 }, signal)
    const runWait = directCall(ctx, owner, 'coordination_wait', { run_id: runId, timeout_ms: 100 }, signal)
    expect(listeners).toHaveLength(2)
    listeners[0]?.({ type: 'run/started', run: ctx.coordination.getRun(RunId(runId)) })
    gate.resolve()
    await expect(taskWait).resolves.toMatchObject({ task: { status: 'succeeded' }, timedOut: false })
    await expect(runWait).resolves.toMatchObject({ run: { status: 'succeeded' }, timedOut: false })

    listeners[0]?.({ type: 'task/changed', task: ctx.coordination.getTask(TaskId('event-task')) })
    listeners[1]?.({ type: 'run/ended', run: ctx.coordination.getRun(RunId(runId)) })
    listen.mockRestore()
    await ctx.fiber.dispose()
  })

  it('accepts task cancellation events and closes the registration race', async () => {
    const { ctx, owner } = await setup({ defaultExecutor: 'wait' })
    ctx.coordination.registerExecutor('wait', (_task, taskSignal) => new Promise((resolve) => {
      taskSignal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'cancel-event', label: 'Cancel event', prompt: 'wait' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    await vi.waitFor(() => { expect(ctx.coordination.getTask(TaskId('cancel-event')).status).toBe('running') })

    let listener: CoordinationEventListener | undefined
    const originalOnEvent = ctx.coordination.onEvent.bind(ctx.coordination)
    const capture = vi.spyOn(ctx.coordination, 'onEvent').mockImplementation((next) => {
      listener = next
      return originalOnEvent(next)
    })
    const waiting = directCall(ctx, owner, 'coordination_wait', { task_id: 'cancel-event', timeout_ms: 100 }, signal)
    const task = ctx.coordination.getTask(TaskId('cancel-event'))
    listener?.({ type: 'task/cancelled', task: { ...task, status: 'cancelled' } })
    await expect(waiting).resolves.toMatchObject({ task: { status: 'running' }, timedOut: false })
    capture.mockRestore()
    ctx.coordination.cancel(TaskId('cancel-event'))
    expect(ctx.coordination.getRun(RunId(runId)).status).toBe('running')

    const raced = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'race-root', label: 'Race root', prompt: 'wait' },
      {
        task_id: 'registration-race', label: 'Registration race', prompt: 'wait',
        dependencies: ['race-root'],
      },
    ] }))
    const racedRunId = (raced['run'] as { id: string }).id
    const raceOriginal = ctx.coordination.onEvent.bind(ctx.coordination)
    const race = vi.spyOn(ctx.coordination, 'onEvent').mockImplementation((next) => {
      ctx.coordination.cancel(TaskId('registration-race'), 'settled during registration')
      return raceOriginal(next)
    })
    await expect(directCall(ctx, owner, 'coordination_wait', {
      task_id: 'registration-race', timeout_ms: 100,
    }, signal)).resolves.toMatchObject({ task: { status: 'cancelled' }, timedOut: false })
    race.mockRestore()
    ctx.coordination.cancel(RunId(racedRunId))
    await ctx.fiber.dispose()
  })

  it('rejects aborted waits for Error and non-Error reasons without double settlement', async () => {
    const { ctx, owner } = await setup({ defaultExecutor: 'wait' })
    ctx.coordination.registerExecutor('wait', (_task, taskSignal) => new Promise((resolve) => {
      taskSignal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'abort-wait', label: 'Abort wait', prompt: 'wait' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    await vi.waitFor(() => { expect(ctx.coordination.getTask(TaskId('abort-wait')).status).toBe('running') })

    for (const reason of [new Error('caller stopped'), 'string reason']) {
      const controller = new AbortController()
      let abortListener: EventListener | undefined
      const originalAdd = controller.signal.addEventListener.bind(controller.signal)
      vi.spyOn(controller.signal, 'addEventListener').mockImplementation((type, next, options) => {
        if (type === 'abort') abortListener = next as EventListener
        originalAdd(type, next, options)
      })
      const waiting = directCall(ctx, owner, 'coordination_wait', {
        task_id: 'abort-wait', timeout_ms: 100,
      }, controller.signal)
      controller.abort(reason)
      abortListener?.(new Event('abort'))
      if (reason instanceof Error) await expect(waiting).rejects.toBe(reason)
      else await expect(waiting).rejects.toThrow('coordination wait aborted')
    }
    ctx.coordination.cancel(RunId(runId))
    await ctx.fiber.dispose()
  })

  it('validates wait durations and cancellation reasons inside accepted schemas', async () => {
    const { ctx, owner } = await setup()
    ctx.coordination.registerExecutor('test', (_task, taskSignal) => new Promise((resolve) => {
      taskSignal.addEventListener('abort', () => { resolve({ status: 'cancelled' }) }, { once: true })
    }))
    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'validated', label: 'Validated', prompt: 'wait' },
    ] }))
    const runId = (started['run'] as { id: string }).id

    for (const timeout_ms of [0, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await call(ctx, owner, 'coordination_wait', { run_id: runId, timeout_ms })
      expect(invalid.isError).toBe(true)
      expect(invalid.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('positive safe integer')
    }
    const blankReason = await call(ctx, owner, 'coordination_cancel', { run_id: runId, reason: ' ' })
    expect(blankReason.isError).toBe(true)
    expect(blankReason.content.map(block => block.type === 'text' ? block.text : '').join('')).toContain('reason must be non-empty')
    await call(ctx, owner, 'coordination_cancel', { run_id: runId })
    await ctx.fiber.dispose()
  })

  it('runs the complete tool to coordination to subagent path', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalCoordinationService, { maxConcurrency: 2 })
    const requests: ResolvedSubagentStartRequest[] = []
    const capabilities: SubagentCapabilities = {
      agentOptions: true, outputSchema: true, depthLimit: true,
      toolFilter: true, persona: true,
    }
    const provider: SubagentProvider = {
      name: 'stub',
      inheritsParentContext: false,
      capabilities,
      async start(request): Promise<SubagentRun> {
        requests.push(request)
        return {
          id: SessionId(`child-${requests.length}`),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: `done:${request.label}` }], stopReason: 'completed' }),
          async dispose() {},
        }
      },
    }
    ctx.subagents.registerProvider(provider)
    await ctx.plugin(subagentExecutor, { provider: 'stub' })
    await ctx.plugin(tool, {})
    const owner = fakeAgent(ctx, 'owner')
    ctx.agents.register(owner)

    const started = value(await call(ctx, owner, 'coordination_start', { tasks: [
      { task_id: 'child-task', label: 'Child Task', prompt: 'do it' },
    ] }))
    const runId = (started['run'] as { id: string }).id
    const terminal = value(await call(ctx, owner, 'coordination_wait', { run_id: runId, timeout_ms: 100 }))
    expect(terminal).toMatchObject({
      run: { status: 'succeeded' },
      tasks: [{
        id: 'child-task',
        output: { subagentId: 'child-1', text: 'done:Child Task' },
      }],
    })
    expect(requests[0]).toMatchObject({ label: 'Child Task', parent: { id: SessionId('owner') } })
    await ctx.fiber.dispose()
  })

  it('validates direct config and registers its tools', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalCoordinationService, { maxConcurrency: 1 })
    expect(() => { tool.apply(ctx, { defaultExecutor: ' ' }) }).toThrow(/defaultExecutor must be non-empty/)
    expect(() => { tool.apply(ctx, { waitTimeoutMs: 0 }) }).toThrow(/waitTimeoutMs/)
    expect(() => { tool.apply(ctx, { waitTimeoutMs: 1.5 }) }).toThrow(/waitTimeoutMs/)
    expect(() => { tool.apply(ctx, { maxWaitTimeoutMs: 0 }) }).toThrow(/maxWaitTimeoutMs/)
    expect(() => { tool.apply(ctx, { maxWaitTimeoutMs: 1.5 }) }).toThrow(/maxWaitTimeoutMs/)
    expect(() => { tool.apply(ctx, { waitTimeoutMs: 2, maxWaitTimeoutMs: 1 }) }).toThrow(/exceeds/)
    tool.apply(ctx, {})
    expect(ctx.tools.get('coordination_start')).toBeDefined()
    await ctx.fiber.dispose()
  })
})
