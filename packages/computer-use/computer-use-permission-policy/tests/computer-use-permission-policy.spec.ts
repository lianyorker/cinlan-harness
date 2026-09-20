import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Policy from '../src/index.ts'
import {
  COMPUTER_ACCESSIBILITY_APPROVAL_REASON,
  COMPUTER_NATIVE_APPROVAL_REASON,
  COMPUTER_KEYBOARD_APPROVAL_REASON,
  COMPUTER_OBSERVE_APPROVAL_REASON,
  COMPUTER_POINTER_APPROVAL_REASON,
  resolveComputerUsePermissionConfig,
} from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function execution(name: string): ToolExecution {
  return { name } as ToolExecution
}

async function decide(ctx: Context, exec: ToolExecution, next: () => Promise<PreToolDecision>) {
  return ctx.waterfall(ctx as never, 'tools/pre-execute', exec, next)
}

async function directHarness(config: Policy.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  let guard: ToolGuard | undefined
  ctx.provide('tools', { guard(candidate: ToolGuard) { guard = candidate; return () => {} } } as never)
  await ctx.plugin(Policy, config)
  return { ctx, guard: () => guard! }
}

describe('Computer Use permission config', () => {
  it('defaults and validates all independent classes', () => {
    expect(resolveComputerUsePermissionConfig()).toEqual({
      observe: 'ask', pointer: 'ask', keyboard: 'ask', accessibilityAction: 'ask', native: 'ask',
    })
    expect(resolveComputerUsePermissionConfig({
      observe: 'allow', pointer: 'deny', keyboard: 'ask', accessibilityAction: 'allow',
    })).toEqual({ observe: 'allow', pointer: 'deny', keyboard: 'ask', accessibilityAction: 'allow', native: 'ask' })
    expect(() => resolveComputerUsePermissionConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    for (const key of ['observe', 'pointer', 'keyboard', 'accessibilityAction', 'native'] as const) {
      expect(() => resolveComputerUsePermissionConfig({ [key]: 'sometimes' })).toThrow(new RegExp(key))
    }
  })
})

describe('Computer Use permission decisions', () => {
  it.each([
    ['computer_list_apps', 'observe', COMPUTER_OBSERVE_APPROVAL_REASON],
    ['computer_list_windows', 'observe', COMPUTER_OBSERVE_APPROVAL_REASON],
    ['computer_observe', 'observe', COMPUTER_OBSERVE_APPROVAL_REASON],
    ['computer_pointer', 'pointer', COMPUTER_POINTER_APPROVAL_REASON],
    ['computer_keyboard', 'keyboard', COMPUTER_KEYBOARD_APPROVAL_REASON],
    ['computer_accessibility', 'accessibilityAction', COMPUTER_ACCESSIBILITY_APPROVAL_REASON],
  ] as const)('classifies %s as %s', async (tool, permissionClass, reason) => {
    const config = {
      observe: 'allow', pointer: 'ask', keyboard: 'deny', accessibilityAction: 'ask',
    } as const
    const { ctx, guard } = await directHarness(config)
    const next = vi.fn(() => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
    const exec = execution(tool)
    const decision = await decide(ctx, exec, next)
    if (permissionClass === 'observe') {
      expect(decision).toEqual({ kind: 'allow' })
      expect(next).toHaveBeenCalledOnce()
      expect(guard()(exec)).toBeUndefined()
    } else if (permissionClass === 'keyboard') {
      expect(decision).toEqual({ kind: 'deny', reason: 'Desktop keyboard or clipboard input is denied by policy.' })
      expect(guard()(exec)).toBe('Desktop keyboard or clipboard input is denied by policy.')
    } else {
      expect(decision).toEqual({ kind: 'ask', reason })
      expect(guard()(exec)).toBeUndefined()
      expect(guard()(exec)).toBe(reason)
    }
  })

  it('delegates unrelated tools', async () => {
    const { ctx, guard } = await directHarness({ observe: 'deny', pointer: 'deny', keyboard: 'deny', accessibilityAction: 'deny' })
    const next = vi.fn(() => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
    const exec = execution('bash')
    await expect(decide(ctx, exec, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()
    expect(guard()(exec)).toBeUndefined()
  })
})

describe('Computer Use monotonic guard', () => {
  async function runtimeHarness(config: Policy.Config) {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Policy, config)
    const body = vi.fn(() => Promise.resolve('EXECUTED'))
    for (const name of ['computer_observe', 'computer_pointer', 'computer_keyboard', 'computer_accessibility', 'cua_driver_native__future_tool']) {
      ctx.tools.register(defineTool({
        name, description: name, parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: body,
      }))
    }
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }), { prepend: true })
    return { ctx, body }
  }

  it.each([
    ['computer_observe', COMPUTER_OBSERVE_APPROVAL_REASON],
    ['computer_pointer', COMPUTER_POINTER_APPROVAL_REASON],
    ['computer_keyboard', COMPUTER_KEYBOARD_APPROVAL_REASON],
    ['computer_accessibility', COMPUTER_ACCESSIBILITY_APPROVAL_REASON],
    ['cua_driver_native__future_tool', COMPUTER_NATIVE_APPROVAL_REASON],
  ])('blocks prepended allow from bypassing ask policy for %s', async (name, reason) => {
    const { ctx, body } = await runtimeHarness({})
    const result = await ctx.tools.execute({
      callId: ToolCallId(`policy-${name}`), name, arguments: {}, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: `Error: ${reason}` }] })
    expect(body).not.toHaveBeenCalled()
  })

  it('allows explicitly allowed actions through the guard', async () => {
    const { ctx, body } = await runtimeHarness({
      observe: 'allow', pointer: 'allow', keyboard: 'allow', accessibilityAction: 'allow',
    })
    const result = await ctx.tools.execute({
      callId: ToolCallId('policy-allow'), name: 'computer_pointer', arguments: {}, signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(body).toHaveBeenCalledOnce()
  })
})
