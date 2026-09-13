import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Policy from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function makeExecution(name: string, args: Record<string, unknown> = {}): ToolExecution {
  return { name, arguments: args, agent: { id: 'agent', session: { id: 'session' } } as never } as never
}

async function mount(outcome: 'allow' | 'deny' | 'approval-required' = 'allow') {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const authorize = vi.fn(() => ({ outcome, code: outcome === 'allow' ? 'ASSESSMENT_ALLOWED' : 'ASSESSMENT_ACTION_OUT_OF_SCOPE' }))
  ctx.provide('assessmentScopeSessions', {
    require: () => ({ targets: [{ id: 'target', value: 'example.test', kind: 'hostname' }] }), authorize,
  } as never)
  ctx.provide('executionHost', { current: () => ({ hostId: 'host' }) } as never)
  await ctx.plugin(Policy)
  return { ctx, authorize }
}

async function pre(ctx: Context, execution: ToolExecution): Promise<PreToolDecision> {
  return ctx.waterfall(ctx as never, 'tools/pre-execute', execution, () => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
}

describe('assessment scope tool policy', () => {
  it('classifies shell, network, and Browser calls', async () => {
    const b = await mount()
    const cases = [
      ['bash', {}, 'active-validation'],
      ['web_fetch', { url: 'https://example.test/a' }, 'reconnaissance'],
      ['browser_open', { url: 'https://example.test/a' }, 'active-validation'],
    ] as const
    for (const [name, args, action] of cases) {
      await expect(pre(b.ctx, makeExecution(name, args))).resolves.toMatchObject({ kind: 'allow' })
      expect(b.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ action }))
    }
  })

  it('returns deny and approval-required decisions from the scope service', async () => {
    const denied = await mount('deny')
    await expect(pre(denied.ctx, makeExecution('web_fetch', { url: 'https://example.test/' }))).resolves.toMatchObject({ kind: 'deny' })
    const approval = await mount('approval-required')
    await expect(pre(approval.ctx, makeExecution('bash'))).resolves.toMatchObject({ kind: 'ask' })
  })

  it('delegates unrelated tools and rejects duplicate configuration', async () => {
    const b = await mount()
    await expect(pre(b.ctx, makeExecution('finding_query'))).resolves.toEqual({ kind: 'allow' })
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    ctx.provide('assessmentScopeSessions', {} as never); ctx.provide('executionHost', {} as never)
    await expect(ctx.plugin(Policy, { shellTools: ['bash', 'bash'] })).rejects.toThrow(/invalid shellTools/)
  })
})
