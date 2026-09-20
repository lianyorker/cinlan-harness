/** Source Loader composition with a scripted model and no external effects. */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import * as AutoReview from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

class ScriptedModel extends LlmAdapter {
  readonly reviews: GenerateOptions[] = []
  private mainCalls = 0

  constructor(private readonly decision: string | Error) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const review = options.system?.startsWith('REVIEW_POLICY') === true
    if (review) {
      this.reviews.push(options)
      if (this.decision instanceof Error) throw this.decision
    } else if (this.mainCalls++ === 0) {
      const block = { type: 'tool-call' as const, id: ToolCallId('pending'), name: 'probe', arguments: '{}' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = review ? String(this.decision) : 'Complete.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function load(decision: string | Error) {
  const model = new ScriptedModel(decision)
  let bodies = 0
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-user-approval', ApprovalService],
    ['@deepseek-ai/dsh-permission-presets', PermissionPresetService],
    ['@deepseek-ai/dsh-experimental-auto-review', AutoReview],
    ['@fixture/external', { inject: ['llm', 'tools'], apply(ctx: Context) {
      ctx.provide('shell', {
        sandboxMode: 'workspace-write',
        resolve() { throw new Error('No shell effects in Auto composition') },
        run() { throw new Error('No shell effects in Auto composition') },
        start() { throw new Error('No shell effects in Auto composition') },
      })
      ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
      ctx.effect(() => ctx.tools.register(defineContentToolFixture({
        name: 'probe', description: 'Perform one project action.', parameters: {},
        async execute() { bodies += 1; return [{ type: 'text', text: 'Executed.' }] },
      })))
    } }],
  ])
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = new URL('./', import.meta.url).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected AutoReview Loader import: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  const path = pathToFileURL(fileURLToPath(new URL('./cordis.yml', import.meta.url))).href
  await ctx.loader.create({ name: 'cordis:include', config: { path } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(e => e.fiber !== undefined).every(e => e.fiber?.state === FiberState.ACTIVE)).toBe(true)
  return { ctx, model, bodies: () => bodies }
}

describe('optional AutoReview Loader composition', () => {
  it.each([
    { label: 'allow', decision: '{"risk":"low","decision":"allow"}', runs: 1 },
    { label: 'explicit hard deny', decision: '{"risk":"high","decision":"deny","reason":"private detail"}', runs: 0 },
    { label: 'invalid high allow', decision: '{"risk":"high","decision":"allow"}', runs: 0 },
    { label: 'review service failure', decision: new Error('provider unavailable'), runs: 0 },
  ])('settles $label through the real loop without approval bypass', async ({ decision, runs }) => {
    const { ctx, model, bodies } = await load(decision)
    const agent = await ctx.agentLoop.create(SessionId('auto-composition'), { provider: 'fixture', model: 'same-model' }, { cwd: process.cwd() })
    expect(ctx.permissionPresets.current(agent.session)).toBe('workspace-write')
    ctx.permissionPresets.set(agent.session, 'auto')
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect this project.' }], source: { kind: 'user' } }))
    await idle
    expect(model.reviews).toHaveLength(1)
    expect(bodies()).toBe(runs)
    const events = agent.session.snapshotEvents()
    const result = events.find(event => event.type === 'tool/result')
    expect(result).toBeDefined()
    if (runs === 0) {
      expect(result?.data).toMatchObject({ error: { name: 'AutoReviewDeniedError', code: 'AUTO_REVIEW_DENIED' } })
      expect(JSON.stringify(agent.session.deriveMessages())).toContain('Auto review rejected tool')
      expect(JSON.stringify(agent.session.deriveMessages())).not.toContain('private detail')
    }
    expect(events.some(event => event.type === 'approval/asked' || event.type === 'approval/decided')).toBe(false)
    expect(ctx.permissionPresets.defaultPreset).toBe('workspace-write')
    const header = {
      type: 'session', version: 3, id: agent.session.id, createdAt: 1, isSeeded: false, delegationDepth: 0,
    }
    const restore = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    for (const event of events) restore.decodeRow(JSON.parse(JSON.stringify(event)))
    const validated = restore.finish()
    const reopened = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    for (const event of validated.events) {
      reopened.decodeRow(JSON.parse(JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))))
    }
    const cold = reopened.finish()
    expect(cold.events.find(event => event.type === 'tool/result')).toEqual(result)
    if (result?.type !== 'tool/result') throw new Error('Missing recorded tool result')
    expect({
      permission: ctx.permissionPresets.current(agent.session),
      runs: bodies(),
      result: result.data.message.content,
      error: result.data.error ?? null,
    }).toMatchSnapshot()
    if (typeof decision === 'string' && decision.includes('private detail')) {
      expect(cold.events.find(event => event.type === 'tool/result')?.data)
        .toMatchObject({ error: { reason: 'private detail' } })
    }
  })
})
