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
import ApprovalService, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome, ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
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
    ['@deepseek-ai/dsh-auto-review', AutoReview],
  ])
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = new URL('./', import.meta.url).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins['auto-review-external'] = {
    inject: ['llm', 'tools'],
    apply(ctx: Context) {
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
    },
  }
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

describe('AutoReview Loader composition', () => {
  const cases: Array<{
    label: string
    decision: string | Error
    runs: number
    policy: ApprovalPolicy
    answer?: ApprovalOutcome
    asked: boolean
    error?: string
    hardDenial?: boolean
  }> = [
    { label: 'allow', decision: '{"risk":"low","decision":"allow"}', runs: 1, policy: 'ask', asked: false },
    { label: 'explicit hard deny', decision: '{"risk":"high","decision":"deny","reason":"private detail"}',
      runs: 0, policy: 'never', asked: false, hardDenial: true, error: 'Auto review rejected tool' },
    { label: 'human rejection', decision: '{"risk":"medium","decision":"deny"}', runs: 0,
      policy: 'ask', answer: 'rejected', asked: true, error: 'rejected' },
    { label: 'human approval', decision: '{"risk":"medium","decision":"deny"}', runs: 1,
      policy: 'ask', answer: 'allowed-once', asked: true },
    { label: 'human cancellation', decision: '{"risk":"medium","decision":"deny"}', runs: 0,
      policy: 'ask', answer: 'cancelled', asked: true, error: 'cancelled' },
    { label: 'missing approval channel', decision: '{"risk":"medium","decision":"deny"}', runs: 0,
      policy: 'ask', asked: true, error: 'no approval channel is available' },
    { label: 'invalid high allow', decision: '{"risk":"high","decision":"allow"}', runs: 0,
      policy: 'ask', asked: false, error: 'reviewer output does not match the risk/decision protocol' },
    { label: 'review service failure', decision: new Error('provider unavailable'), runs: 0,
      policy: 'ask', asked: false, error: 'provider unavailable' },
  ]
  it.each(cases)('settles $label through the real loop without approval bypass', async (item) => {
    const { ctx, model, bodies } = await load(item.decision)
    const agent = await ctx.agentLoop.create(SessionId('auto-composition'), { provider: 'fixture', model: 'same-model' }, { cwd: process.cwd() })
    expect(ctx.permissionPresets.current(agent.session)).toBe('workspace-write')
    expect(ctx.permissionPresets.names).toContain('auto')
    expect(model.reviews).toHaveLength(0)
    ctx.permissionPresets.set(agent.session, 'auto')
    setApprovalPolicy(agent.session, item.policy)
    const answer = item.answer
    if (answer !== undefined) ctx.on('approval/request', () => Promise.resolve(answer))
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect this project.' }], source: { kind: 'user' } }))
    await idle
    expect(model.reviews).toHaveLength(1)
    expect(model.reviews[0]!.maxTokens).toBe(1024)
    expect(bodies()).toBe(item.runs)
    const events = agent.session.snapshotEvents()
    const audit = events.filter(event => event.type === 'auto-review/request')
    expect(audit).toHaveLength(1)
    const request = model.reviews[0]!
    const input = request.messages[0]!.content[0]!
    if (input.type !== 'text') throw new Error('Unexpected review input')
    expect(audit[0]!.data).toMatchObject({
      mode: 'native', provider: request.provider, model: request.model, system: request.system,
      input: input.text, maxTokens: request.maxTokens, temperature: request.temperature,
    })
    expect(JSON.stringify(agent.session.deriveMessages())).not.toContain('REVIEW_POLICY')
    const result = events.find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('Missing recorded tool result')
    expect(result.data.message.isError).toBe(item.runs === 0)
    if (item.error !== undefined) expect(JSON.stringify(result.data.message.content)).toContain(item.error)
    if (item.hardDenial) {
      expect(result.data.error).toMatchObject({ name: 'AutoReviewDeniedError', code: 'AUTO_REVIEW_DENIED', reason: 'private detail' })
      expect(JSON.stringify(agent.session.deriveMessages())).not.toContain('private detail')
    } else {
      expect(result.data.error).toBeUndefined()
    }
    expect(events.filter(event => event.type === 'approval/asked')).toHaveLength(item.asked ? 1 : 0)
    expect(events.filter(event => event.type === 'approval/decided')).toHaveLength(item.asked ? 1 : 0)
    expect(ctx.permissionPresets.defaultPreset).toBe('workspace-write')
    const header = sessionFormatCatalog.encodeCurrentHeader(
      { ...agent.session.header, delegationDepth: 0 }, agent.session.inheritedEventCount,
    )
    const restore = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    for (const event of events) restore.decodeRow(JSON.parse(JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))))
    const validated = restore.finish()
    const reopened = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    for (const event of validated.events) {
      reopened.decodeRow(JSON.parse(JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))))
    }
    const cold = reopened.finish()
    expect(cold.events.find(event => event.type === 'tool/result')).toEqual(result)
    expect(cold.events.filter(event => event.type === 'auto-review/request')).toEqual(audit)
    expect({
      permission: ctx.permissionPresets.current(agent.session),
      runs: bodies(),
      result: result.data.message.content,
      error: result.data.error ?? null,
    }).toMatchSnapshot()
  })

  it('withdraws Auto through Loader and migrates live selections without reselecting on reload', async () => {
    const { ctx, bodies } = await load('{"risk":"low","decision":"allow"}')
    const agent = await ctx.agentLoop.create(SessionId('auto-unload'),
      { provider: 'fixture', model: 'same-model' }, { cwd: process.cwd() })
    ctx.permissionPresets.set(agent.session, 'auto')
    expect(ctx.permissionPresets.names).toContain('auto')
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'auto-review')
    if (entry === undefined) throw new Error('Missing AutoReview Loader entry')
    await entry.update({ disabled: true }, false, true)
    await ctx.loader.await()
    expect(ctx.permissionPresets.names).not.toContain('auto')
    expect(ctx.permissionPresets.current(agent.session)).toBe('danger-full-access')
    expect(ctx.approval.overrideOf(agent.session)).toBe('never')
    expect(() => { ctx.permissionPresets.set(agent.session, 'auto') }).toThrow()
    await entry.update({ disabled: false }, false, true)
    await ctx.loader.await()
    expect(ctx.permissionPresets.names).toContain('auto')
    expect(ctx.permissionPresets.current(agent.session)).toBe('danger-full-access')
    expect(bodies()).toBe(0)
  })
})
