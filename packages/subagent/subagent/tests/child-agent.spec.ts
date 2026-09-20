import { describe, expect, it, vi } from 'vitest'
import type { SshExecutionSnapshot } from '@deepseek-ai/dsh-execution-binding/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { resolveChildAgentOptions, captureDelegatedPolicyOverrides, appendDelegatedPolicyOverrides, applyChildComposition } from '../src/child-agent.ts'

function parentAgent(): Agent {
  const id = SessionId('parent')
  return {
    id,
    options: {
      provider: 'parent-provider',
      model: 'parent-model',
      reasoningEffort: ReasoningEffortId('high'),
      maxTokens: 512,
    },
    session: Session.create(id),
  } as Agent
}

describe('child Agent options', () => {
  it('inherits the parent effort while the exact route is unchanged', () => {
    expect(resolveChildAgentOptions(parentAgent(), undefined, 1)).toEqual({
      provider: 'parent-provider',
      model: 'parent-model',
      reasoningEffort: 'high',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('clears an inherited effort when the child route changes', () => {
    expect(resolveChildAgentOptions(parentAgent(), { model: 'child-model' }, 1)).toEqual({
      provider: 'parent-provider',
      model: 'child-model',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('keeps an explicit child effort when the child route changes', () => {
    expect(resolveChildAgentOptions(parentAgent(), {
      provider: 'child-provider',
      model: 'child-model',
      reasoningEffort: ReasoningEffortId('max'),
    }, 1)).toEqual({
      provider: 'child-provider',
      model: 'child-model',
      reasoningEffort: 'max',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })

  it('inherits the latest logged request selection over creation-time values', () => {
    const parent = parentAgent()
    parent.session.append('request/header', {
      header: {
        config: {
          provider: 'current-provider',
          model: 'current-model',
          reasoningEffort: ReasoningEffortId('low'),
        },
      },
      reason: 'initial',
    })

    expect(resolveChildAgentOptions(parent, undefined, 1)).toEqual({
      provider: 'current-provider',
      model: 'current-model',
      reasoningEffort: 'low',
      maxTokens: 512,
      subagentDepth: 1,
    })
  })
})

describe('delegated Auto identity', () => {
  it.each(['auto', 'danger-full-access'] as const)('captures %s before later parent changes and overwrites a stale fork identity', async (initial) => {
    const ctx = new Context()
    try {
      let preset: string = initial
      ctx.provide('permissionPresets', { current: () => preset })
      ctx.provide('approval', {})
      ctx.provide('sandboxPolicy', { overrideOf: () => 'danger-full-access' })
      const parent = { ...parentAgent(), ctx } as Agent
      const captured = captureDelegatedPolicyOverrides(parent)
      preset = initial === 'auto' ? 'danger-full-access' : 'auto'
      const child = Session.create(SessionId('child-auto'))
      child.append('permission/preset', { preset })
      appendDelegatedPolicyOverrides(child, captured)
      expect(child.snapshotEvents().slice(1).map(event => [event.type, event.data])).toEqual([
        ['sandbox/mode', { mode: 'danger-full-access', source: 'delegation' }],
        ['approval/policy', { policy: 'never', source: 'delegation' }],
        ['permission/preset', { preset: initial }],
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not invent an Auto identity for confined or permissionless parents', async () => {
    const ctx = new Context()
    try {
      const parent = { ...parentAgent(), ctx } as Agent
      expect(captureDelegatedPolicyOverrides(parent).permissionPreset).toBeUndefined()
      ctx.provide('permissionPresets', { current: () => 'read-only' })
      expect(captureDelegatedPolicyOverrides(parent).permissionPreset).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

const remoteBinding: SshExecutionSnapshot = {
  kind: 'ssh', targetId: '11111111-1111-4111-8111-111111111111' as SshExecutionSnapshot['targetId'], revision: 1,
  endpoint: { host: 'execution.example', port: 22, username: 'worker', hostKeySHA256: 'a'.repeat(64) },
  node: '/usr/bin/node', helper: '/opt/dsh/helper.mjs', helperHash: 'b'.repeat(64),
  workspace: '/workspace', bootstrapPath: '/opt/dsh/bootstrap.mjs', bootstrapHash: 'c'.repeat(64),
}

it('prepares child execution before joining the parent composition and retains the commit', async () => {
  const ctx = new Context()
  try {
    const parent = { ...parentAgent(), ctx } as Agent
    const child = { ...parentAgent(), id: SessionId('child'), session: Session.create(SessionId('child')), ctx } as Agent
    const order: string[] = []
    const commit = { commit: vi.fn() }
    const setup = vi.fn(async () => { order.push('execution'); return commit })
    ctx.provide('executionBindings', { bindingForSession: async () => remoteBinding, setup } as never)
    ctx.provide('agentPresets', { composeFrom: () => { order.push('preset'); return undefined } } as never)
    ctx.provide('systemPrompt', { context: () => {}, getContextOrder: () => 0 } as never)
    expect(await applyChildComposition(ctx, parent, {}, child)).toBe(commit)
    expect(setup).toHaveBeenCalledWith(ctx, child, remoteBinding)
    expect(order).toEqual(['execution', 'preset'])
    setup.mockClear()
    child.session.append('execution/bound', { binding: remoteBinding })
    await applyChildComposition(ctx, parent, {}, child, true)
    expect(setup).toHaveBeenCalledWith(ctx, child, undefined)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('rejects a resumed child whose durable execution differs from its parent before composition', async () => {
  const ctx = new Context()
  try {
    const parent = { ...parentAgent(), ctx } as Agent
    const childSession = Session.create(SessionId('child'))
    const child = { ...parentAgent(), id: childSession.header.id, session: childSession, ctx } as Agent
    const setup = vi.fn()
    const composeFrom = vi.fn()
    ctx.provide('executionBindings', { bindingForSession: async () => remoteBinding, setup } as never)
    ctx.provide('agentPresets', { composeFrom } as never)
    await expect(applyChildComposition(ctx, parent, {}, child, true)).rejects.toThrow('differs from its parent')
    expect(setup).not.toHaveBeenCalled()
    expect(composeFrom).not.toHaveBeenCalled()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('rejects a child whose durable preset differs from its parent composition', async () => {
  const ctx = new Context()
  try {
    const parent = { ...parentAgent(), ctx } as Agent
    const childId = SessionId('child')
    const childSession = Session.create(childId, undefined, { ...Session.create(childId).header, agentPreset: 'recorded' })
    const child = { ...parentAgent(), id: childSession.header.id, session: childSession, ctx } as Agent
    ctx.provide('agentPresets', { composeFrom: () => 'mounted' } as never)
    const context = vi.fn()
    ctx.provide('systemPrompt', { context, getContextOrder: () => 0 } as never)
    await expect(applyChildComposition(ctx, parent, {}, child)).rejects.toThrow('preset differs')
    expect(context).not.toHaveBeenCalled()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('rejects remote delegation when the execution service is absent', async () => {
  const ctx = new Context()
  try {
    const parent = { ...parentAgent(), ctx } as Agent
    parent.session.append('execution/bound', { binding: remoteBinding })
    const child = { ...parentAgent(), id: SessionId('child'), session: Session.create(SessionId('child')), ctx } as Agent
    await expect(applyChildComposition(ctx, parent, {}, child)).rejects.toThrow('requires the execution binding service')
  } finally {
    await ctx.fiber.dispose()
  }
})
