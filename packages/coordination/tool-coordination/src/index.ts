/** Model-facing Consumer for task graphs managed by `ctx.coordination`. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  RunId, TaskId,
} from '@deepseek-ai/dsh-coordination'
import type { CoordinationEvent, RunSnapshot, TaskSnapshot, TaskSpec } from '@deepseek-ai/dsh-coordination'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-coordination'
export const inject = ['agents', 'coordination', 'tools']

/** Tool defaults for executor selection and bounded waits. */
export interface Config {
  /** Executor used when a task omits `executor` (default `subagent`). */
  defaultExecutor?: string
  /** Wait duration when `coordination_wait` omits `timeout_ms` (default 30000). */
  waitTimeoutMs?: number
  /** Maximum model-selected wait duration (default 600000). */
  maxWaitTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  defaultExecutor: z.string().default('subagent'),
  waitTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(30_000),
  maxWaitTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(600_000),
})

interface PublicRun {
  id: string
  status: RunSnapshot['status']
  taskIds: string[]
  createdAt: number
  finishedAt?: number
}

interface PublicTask {
  id: string
  runId: string
  label: string
  dependencies: string[]
  executor: string
  parentId?: string
  status: TaskSnapshot['status']
  output?: JsonValue
  outputOmitted?: boolean
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

interface ModelTaskRequest {
  task_id?: string
  label: string
  prompt: string
  dependencies?: string[]
  executor?: string
  parent_task_id?: string
}

interface TargetRequest {
  run_id?: string
  task_id?: string
}

type OwnedTarget =
  | { readonly kind: 'run'; readonly id: ReturnType<typeof RunId> }
  | { readonly kind: 'task'; readonly id: ReturnType<typeof TaskId>; readonly runId: ReturnType<typeof RunId> }

const RUN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'] },
    taskIds: { type: 'array', required: true, items: { type: 'string' } },
    createdAt: { type: 'integer', required: true },
    finishedAt: { type: 'integer' },
  },
} as const

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    runId: { type: 'string', required: true },
    label: { type: 'string', required: true },
    dependencies: { type: 'array', required: true, items: { type: 'string' } },
    executor: { type: 'string', required: true },
    parentId: { type: 'string' },
    status: { type: 'string', required: true, enum: ['pending', 'ready', 'running', 'succeeded', 'failed', 'cancelled'] },
    output: { type: 'json' },
    outputOmitted: { type: 'boolean' },
    error: { type: 'string' },
    createdAt: { type: 'integer', required: true },
    startedAt: { type: 'integer' },
    finishedAt: { type: 'integer' },
  },
} as const

const TARGET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    run: RUN_SCHEMA,
    tasks: { type: 'array', items: TASK_SCHEMA },
    task: TASK_SCHEMA,
    timedOut: { type: 'boolean' },
  },
} as const

const TASK_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', description: 'Optional stable id. Assign ids to tasks referenced by dependencies.' },
    label: { type: 'string', required: true, description: 'Short task label.' },
    prompt: { type: 'string', required: true, description: 'Standalone instructions for the task executor.' },
    dependencies: { type: 'array', items: { type: 'string' }, description: 'Task ids that must succeed first.' },
    executor: { type: 'string', description: 'Registered executor kind. Omit to use the configured default.' },
    parent_task_id: { type: 'string', description: 'Optional acyclic parent task for subtree cancellation.' },
  },
} as const

function publicTiming(value: {
  readonly createdAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
}): Pick<PublicTask, 'createdAt' | 'startedAt' | 'finishedAt'> {
  return {
    createdAt: value.createdAt,
    ...value.startedAt === undefined ? {} : { startedAt: value.startedAt },
    ...value.finishedAt === undefined ? {} : { finishedAt: value.finishedAt },
  }
}

function publicRun(run: RunSnapshot): PublicRun {
  return {
    id: String(run.id),
    status: run.status,
    taskIds: run.taskIds.map(String),
    ...publicTiming(run),
  }
}

function publicTask(task: TaskSnapshot): PublicTask {
  const output = task.output === undefined ? undefined : snapshotJsonValue(task.output)
  return {
    id: String(task.id),
    runId: String(task.runId),
    label: task.label,
    dependencies: task.dependencies.map(String),
    executor: task.executor,
    ...task.parentId === undefined ? {} : { parentId: String(task.parentId) },
    status: task.status,
    ...output === undefined ? {} : { output: output as JsonValue },
    ...task.output !== undefined && output === undefined ? { outputOmitted: true } : {},
    ...task.error === undefined ? {} : { error: task.error },
    ...publicTiming(task),
  }
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${name} must be non-empty`)
  return normalized
}

function requireLiveAgent(ctx: Context, exec: ToolRunContext): Agent {
  const agent = exec.agent
  if (agent === undefined || ctx.agents.get(agent.id) !== agent) {
    throw new Error('coordination tools require the exact live calling agent')
  }
  return agent
}

function present(title: string, kind: 'read' | 'execute', rawInput?: string): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

function renderJson(value: JsonValue): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function isTerminalRun(status: RunSnapshot['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function isTerminalTask(status: TaskSnapshot['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export function apply(ctx: Context, config: Config): void {
  const defaultExecutor = requireNonEmpty(config.defaultExecutor ?? 'subagent', 'defaultExecutor')
  const waitDefault = config.waitTimeoutMs ?? 30_000
  const waitCap = config.maxWaitTimeoutMs ?? 600_000
  if (!Number.isSafeInteger(waitDefault) || waitDefault < 1) throw new Error('waitTimeoutMs must be a positive safe integer')
  if (!Number.isSafeInteger(waitCap) || waitCap < 1) throw new Error('maxWaitTimeoutMs must be a positive safe integer')
  if (waitDefault > waitCap) throw new Error(`waitTimeoutMs (${waitDefault}) exceeds maxWaitTimeoutMs (${waitCap})`)

  const runOwners = new Map<ReturnType<typeof RunId>, SessionId>()
  const taskRuns = new Map<ReturnType<typeof TaskId>, ReturnType<typeof RunId>>()

  const removeRun = (runId: ReturnType<typeof RunId>): void => {
    runOwners.delete(runId)
    for (const [taskId, ownerRun] of taskRuns) if (ownerRun === runId) taskRuns.delete(taskId)
  }
  ctx.coordination.onEvent((event) => {
    if (event.type === 'run/evicted') removeRun(event.run.id)
  })
  const releaseOwner = (ownerId: SessionId, reason: string): void => {
    for (const [runId, owner] of [...runOwners]) {
      if (owner !== ownerId) continue
      const run = ctx.coordination.getRun(runId)
      if (!isTerminalRun(run.status)) ctx.coordination.cancel(runId, reason)
      removeRun(runId)
    }
  }
  ctx.on('agent/disposed', ({ agent }) => { releaseOwner(agent.id, 'coordination owner disposed') })
  ctx.effect(() => () => {
    for (const owner of new Set(runOwners.values())) releaseOwner(owner, 'coordination tool disposed')
  }, 'tool-coordination.dispose')

  const assertRunOwner = (runId: ReturnType<typeof RunId>, agent: Agent): void => {
    if (runOwners.get(runId) !== agent.id) throw new Error(`coordination run ${String(runId)} is unknown or inaccessible`)
  }
  const resolveTarget = (request: TargetRequest, agent: Agent): OwnedTarget => {
    const hasRun = request.run_id !== undefined
    const hasTask = request.task_id !== undefined
    if (hasRun === hasTask) throw new Error('provide exactly one of run_id or task_id')
    if (request.run_id !== undefined) {
      const runId = RunId(requireNonEmpty(request.run_id, 'run_id'))
      assertRunOwner(runId, agent)
      return { kind: 'run', id: runId }
    }
    const taskId = TaskId(requireNonEmpty(request.task_id as string, 'task_id'))
    const runId = taskRuns.get(taskId)
    if (runId === undefined || runOwners.get(runId) !== agent.id) {
      throw new Error(`coordination task ${String(taskId)} is unknown or inaccessible`)
    }
    return { kind: 'task', id: taskId, runId }
  }
  const targetValue = (target: OwnedTarget): { run?: PublicRun; tasks?: PublicTask[]; task?: PublicTask } => {
    if (target.kind === 'task') return { task: publicTask(ctx.coordination.getTask(target.id)) }
    return {
      run: publicRun(ctx.coordination.getRun(target.id)),
      tasks: ctx.coordination.listTasks(target.id).map(publicTask),
    }
  }
  const targetTerminal = (target: OwnedTarget): boolean => target.kind === 'run'
    ? isTerminalRun(ctx.coordination.getRun(target.id).status)
    : isTerminalTask(ctx.coordination.getTask(target.id).status)

  const waitForTarget = async (target: OwnedTarget, timeoutMs: number, signal: AbortSignal): Promise<boolean> => {
    signal.throwIfAborted()
    if (targetTerminal(target)) return false
    return new Promise<boolean>((resolve, reject) => {
      let settled = false
      function cleanup(): void {
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        stopListening()
      }
      function finish(timedOut: boolean): void {
        if (settled) return
        settled = true
        cleanup()
        resolve(timedOut)
      }
      function aborted(): void {
        if (settled) return
        settled = true
        cleanup()
        reject(signal.reason instanceof Error
          ? signal.reason
          : new Error('coordination wait aborted', { cause: signal.reason }))
      }
      function changed(event: CoordinationEvent): void {
        if (target.kind === 'run') {
          if (event.type === 'run/ended' && event.run.id === target.id) finish(false)
          return
        }
        if ((event.type === 'task/changed' || event.type === 'task/cancelled')
          && event.task.id === target.id && isTerminalTask(event.task.status)) finish(false)
      }
      const stopListening = ctx.coordination.onEvent(changed)
      signal.addEventListener('abort', aborted, { once: true })
      const timer = setTimeout(() => { finish(true) }, timeoutMs)
      if (targetTerminal(target)) finish(false)
    })
  }

  const taskSpec = (request: ModelTaskRequest, owner: Agent): TaskSpec => ({
    ...request.task_id === undefined ? {} : { id: TaskId(requireNonEmpty(request.task_id, 'task_id')) },
    label: requireNonEmpty(request.label, 'label'),
    executor: requireNonEmpty(request.executor ?? defaultExecutor, 'executor'),
    input: {
      prompt: requireNonEmpty(request.prompt, 'prompt'),
      parentAgentId: String(owner.id),
    },
    ...request.dependencies === undefined ? {} : {
      dependencies: request.dependencies.map(id => TaskId(requireNonEmpty(id, 'dependency task id'))),
    },
    ...request.parent_task_id === undefined ? {} : {
      parentId: TaskId(requireNonEmpty(request.parent_task_id, 'parent_task_id')),
    },
  })

  ctx.tools.register(defineTool({
    name: 'coordination_start',
    description: 'Start a background task DAG. Independent tasks may run concurrently; dependency tasks start only after every named dependency succeeds. Keep the returned run and task ids for status, messages, cancellation, and waits.',
    parameters: {
      tasks: { type: 'array', required: true, items: TASK_REQUEST_SCHEMA, description: 'Complete initial task graph.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { run: { ...RUN_SCHEMA, required: true }, tasks: { type: 'array', required: true, items: TASK_SCHEMA } },
      },
      render: (_args, value) => renderJson(value),
    },
    execute(args, exec) {
      const owner = requireLiveAgent(ctx, exec)
      const handle = ctx.coordination.start({ tasks: args.tasks.map(task => taskSpec(task, owner)) })
      runOwners.set(handle.snapshot.id, owner.id)
      const tasks = ctx.coordination.listTasks(handle.snapshot.id)
      for (const task of tasks) taskRuns.set(task.id, handle.snapshot.id)
      return Promise.resolve({ run: publicRun(handle.snapshot), tasks: tasks.map(publicTask) })
    },
    presentCall: args => present(`Start coordination run with ${args.tasks.length} task(s)`, 'execute'),
  }))

  ctx.tools.register(defineTool({
    name: 'coordination_add_task',
    description: 'Add one task to a live coordination run. Its dependencies and parent must already belong to that run.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Run id returned by coordination_start.' },
      task: { ...TASK_REQUEST_SCHEMA, required: true },
    },
    output: { schema: TASK_SCHEMA, render: (_args, value) => renderJson(value) },
    execute(args, exec) {
      const owner = requireLiveAgent(ctx, exec)
      const runId = RunId(requireNonEmpty(args.run_id, 'run_id'))
      assertRunOwner(runId, owner)
      const taskId = ctx.coordination.addTask(runId, taskSpec(args.task, owner))
      taskRuns.set(taskId, runId)
      return Promise.resolve(publicTask(ctx.coordination.getTask(taskId)))
    },
    presentCall: args => present(`Add task to coordination run ${args.run_id}`, 'execute', args.run_id),
  }))

  ctx.tools.register(defineTool({
    name: 'coordination_status',
    description: 'Read one owned coordination run with all of its tasks, or one owned task. This call never waits.',
    parameters: {
      run_id: { type: 'string', description: 'Run id to inspect; mutually exclusive with task_id.' },
      task_id: { type: 'string', description: 'Task id to inspect; mutually exclusive with run_id.' },
    },
    output: { schema: TARGET_OUTPUT_SCHEMA, render: (_args, value) => renderJson(value) },
    execute(args, exec) {
      const target = resolveTarget(args, requireLiveAgent(ctx, exec))
      return Promise.resolve(targetValue(target))
    },
    presentCall: args => present('Read coordination status', 'read', args.run_id ?? args.task_id),
  }))

  ctx.tools.register(defineTool({
    name: 'coordination_wait',
    description: 'Wait for one owned run or task to become terminal, up to the configured timeout cap. A timeout returns current state with timedOut: true and leaves work running.',
    parameters: {
      run_id: { type: 'string', description: 'Run id to wait for; mutually exclusive with task_id.' },
      task_id: { type: 'string', description: 'Task id to wait for; mutually exclusive with run_id.' },
      timeout_ms: { type: 'integer', description: 'Optional positive wait duration, capped by deployment configuration.' },
    },
    output: { schema: TARGET_OUTPUT_SCHEMA, render: (_args, value) => renderJson(value) },
    async execute(args, exec) {
      const target = resolveTarget(args, requireLiveAgent(ctx, exec))
      if (args.timeout_ms !== undefined && (!Number.isSafeInteger(args.timeout_ms) || args.timeout_ms < 1)) {
        throw new Error('timeout_ms must be a positive safe integer')
      }
      const timedOut = await waitForTarget(target, Math.min(args.timeout_ms ?? waitDefault, waitCap), exec.signal)
      return { ...targetValue(target), timedOut }
    },
    presentCall: args => present('Wait for coordination work', 'read', args.run_id ?? args.task_id),
  }))

  ctx.tools.register(defineTool({
    name: 'coordination_cancel',
    description: 'Cancel one owned run, or one owned task parent-subtree plus tasks transitively blocked by cancelled dependencies. Running executors receive the reason through their AbortSignal.',
    parameters: {
      run_id: { type: 'string', description: 'Run id to cancel; mutually exclusive with task_id.' },
      task_id: { type: 'string', description: 'Task id whose parent-subtree and dependency-blocked descendants should be cancelled; mutually exclusive with run_id.' },
      reason: { type: 'string', description: 'Optional cancellation reason.' },
    },
    output: { schema: TARGET_OUTPUT_SCHEMA, render: (_args, value) => renderJson(value) },
    execute(args, exec) {
      const target = resolveTarget(args, requireLiveAgent(ctx, exec))
      const reason = args.reason === undefined ? undefined : requireNonEmpty(args.reason, 'reason')
      ctx.coordination.cancel(target.id, reason)
      return Promise.resolve(targetValue(target))
    },
    presentCall: args => present('Cancel coordination work', 'execute', args.run_id ?? args.task_id),
  }))

  ctx.tools.register(defineTool({
    name: 'coordination_send_message',
    description: 'Commit a message addressed to one owned task. Message listeners decide delivery; the coordination record itself does not imply that an executor supports live steering.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Recipient task id.' },
      message: { type: 'string', required: true, description: 'Non-empty message for the task.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          message: { type: 'string', required: true },
          sender: { type: 'string', required: true },
          createdAt: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute(args, exec) {
      const owner = requireLiveAgent(ctx, exec)
      const target = resolveTarget({ task_id: args.task_id }, owner) as Extract<OwnedTarget, { kind: 'task' }>
      const message = ctx.coordination.sendMessage(
        target.id,
        requireNonEmpty(args.message, 'message'),
        String(owner.id),
      )
      return Promise.resolve({
        taskId: String(message.taskId),
        message: message.message,
        sender: String(owner.id),
        createdAt: message.createdAt,
      })
    },
    presentCall: args => present(`Send message to coordination task ${args.task_id}`, 'execute', args.task_id),
  }))
}
