import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { resolveChildAgentOptions, captureDelegatedPolicyOverrides, appendDelegatedPolicyOverrides } from '../src/child-agent.ts'

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
