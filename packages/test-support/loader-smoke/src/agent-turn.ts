/**
 * Test-only direct-agent turn driver shared by assembled Loader fixtures.
 * @module @deepseek-ai/dsh-loader-smoke/agent-turn
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, expandAssistantStream, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Result envelope consumed only by snapshot and composition tests. */
export interface FixtureTurnResult {
  readonly type: 'result'
  readonly sessionId: string
  readonly output: string
  readonly usage?: TokenUsage
}

/** Options for one fixture turn against exactly one configured root agent. */
export interface FixtureTurnOptions {
  readonly task: string
  /** Cancels the wait for successful startup; does not interrupt idle waits or a submitted task. */
  readonly signal?: AbortSignal
  readonly onEvent?: (sessionId: string, event: SessionEvent) => void
}

function addUsage(total: TokenUsage | undefined, step: TokenUsage): TokenUsage {
  const next: TokenUsage = {
    inputTokens: (total?.inputTokens ?? 0) + step.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + step.outputTokens,
  }
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (total?.[key] !== undefined || step[key] !== undefined) next[key] = (total?.[key] ?? 0) + (step[key] ?? 0)
  }
  return next
}

function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string | undefined {
  const blocks = event.data.message.content.filter(block => block.type === 'text')
  return blocks.length === 0 ? undefined : blocks.map(block => block.text).join('')
}

async function onlyRootAgent(ctx: Context, signal: AbortSignal | undefined): Promise<Agent> {
  signal?.throwIfAborted()
  const registry = ctx.get('agents')
  if (registry === undefined) throw new Error('fixture turn requires exactly one top-level agent, found 0')
  // Configured agents publish asynchronously (persistence create/resume runs
  // before publication), so a settled Loader does not imply a registered
  // agent yet. Only session-start confirms creation listeners succeeded.
  if (registry.roots().length === 0) {
    const ready = Promise.withResolvers<void>()
    let pending: Agent | undefined
    const abort = (): void => { ready.reject(signal?.reason) }
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (registry.roots().includes(agent)) pending = agent
    })
    const stopStarted = ctx.on('agent/session-start', ({ agent }) => {
      if (registry.roots().includes(agent)) ready.resolve()
    })
    const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
      if (agent === pending) ready.reject(new Error(`fixture agent "${agent.id}" was disposed before startup completed`))
    })
    signal?.addEventListener('abort', abort, { once: true })
    try {
      signal?.throwIfAborted()
      await ready.promise
    } finally {
      signal?.removeEventListener('abort', abort)
      const cleanups = await Promise.allSettled([stopCreated, stopStarted, stopDisposed]
        .map(dispose => Promise.resolve().then(dispose)))
      const failures = cleanups.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'fixture startup listener cleanup failed')
    }
  }
  const agents = registry.roots()
  const [agent] = agents
  if (agent === undefined || agents.length !== 1) {
    throw new Error(`fixture turn requires exactly one top-level agent, found ${agents.length}`)
  }
  return agent
}

/**
 * Drive one task from its durable inbox receipt through whole-agent idle.
 * The caller may abort the wait for `agent/session-start` with `options.signal`
 * and must await this operation before disposing its context. Cancellation
 * does not interrupt `whenIdle()` or stop a task after submission.
 * @param ctx - Loader context with one ready root agent or one pending root creation.
 * @param options - task, optional publication signal, and canonical-event observer.
 * @returns the final assistant text and accumulated model usage after listener cleanup.
 */
export async function runFixtureTurn(ctx: Context, options: FixtureTurnOptions): Promise<FixtureTurnResult> {
  const agent = await onlyRootAgent(ctx, options.signal)
  await agent.whenIdle()
  options.signal?.throwIfAborted()

  const message = createUserMessage({
    content: [{ type: 'text', text: options.task }],
    source: { kind: 'user' },
  })
  let received = false
  let output = ''
  const usageByStep = new Map<string, TokenUsage>()
  const disposeListener = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (!received) {
      if (event.type !== 'agent/inbox/spliced'
        || !event.data.inserted.some(inserted => inserted.id === message.id)) return
      received = true
    }
    options.onEvent?.(session.id, event)
    if (event.type === 'assistant/message') {
      output = assistantText(event) ?? output
      if (event.data.usage !== undefined) {
        usageByStep.set(`${event.data.turn}/${event.data.step}`, event.data.usage)
      }
    } else if (event.type === 'assistant/attempt') {
      const usage = expandAssistantStream(event.data.stream)
        .findLast(member => member.chunk.type === 'usage')?.chunk
      if (usage?.type === 'usage') {
        usageByStep.set(`${event.data.turn}/${event.data.step}`, usage.usage)
      }
    }
  })

  try {
    agent.followup(message)
    await agent.whenIdle()
  } finally {
    await Promise.resolve().then(disposeListener)
  }
  await ctx.sessions.flush(agent.session)
  const usage = [...usageByStep.values()].reduce<TokenUsage | undefined>(addUsage, undefined)
  return {
    type: 'result',
    sessionId: agent.session.id,
    output,
    ...usage === undefined ? {} : { usage },
  }
}
