import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Policy from '../src/index.ts'
import {
  MOBILE_DEVICE_NAVIGATION_APPROVAL_REASON,
  MOBILE_OBSERVE_APPROVAL_REASON,
  MOBILE_TEXT_INPUT_APPROVAL_REASON,
  MOBILE_TOUCH_APPROVAL_REASON,
  resolveMobileDevicePermissionConfig,
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

describe('Mobile Device permission configuration', () => {
  it('defaults and validates all independent classes', () => {
    expect(resolveMobileDevicePermissionConfig()).toEqual({
      observe: 'ask', touch: 'ask', textInput: 'ask', deviceNavigation: 'ask',
    })
    expect(resolveMobileDevicePermissionConfig({
      observe: 'allow', touch: 'deny', textInput: 'ask', deviceNavigation: 'allow',
    })).toEqual({ observe: 'allow', touch: 'deny', textInput: 'ask', deviceNavigation: 'allow' })
    expect(() => resolveMobileDevicePermissionConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    for (const key of ['observe', 'touch', 'textInput', 'deviceNavigation'] as const) {
      expect(() => resolveMobileDevicePermissionConfig({ [key]: 'sometimes' })).toThrow(new RegExp(key))
    }
  })
})

describe('Mobile Device permission decisions', () => {
  it.each([
    ['mobile_list_devices', 'observe', MOBILE_OBSERVE_APPROVAL_REASON],
    ['mobile_observe', 'observe', MOBILE_OBSERVE_APPROVAL_REASON],
    ['mobile_touch', 'touch', MOBILE_TOUCH_APPROVAL_REASON],
    ['mobile_type', 'textInput', MOBILE_TEXT_INPUT_APPROVAL_REASON],
    ['mobile_button', 'deviceNavigation', MOBILE_DEVICE_NAVIGATION_APPROVAL_REASON],
  ] as const)('classifies %s as %s', async (tool, permissionClass, reason) => {
    const config = { observe: 'allow', touch: 'ask', textInput: 'deny', deviceNavigation: 'ask' } as const
    const { ctx, guard } = await directHarness(config)
    const next = vi.fn(() => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
    const exec = execution(tool)
    const decision = await decide(ctx, exec, next)
    if (permissionClass === 'observe') {
      expect(decision).toEqual({ kind: 'allow' })
      expect(next).toHaveBeenCalledOnce()
      expect(guard()(exec)).toBeUndefined()
    } else if (permissionClass === 'textInput') {
      expect(decision).toEqual({ kind: 'deny', reason: 'Mobile device text input is denied by policy.' })
      expect(guard()(exec)).toBe('Mobile device text input is denied by policy.')
    } else {
      expect(decision).toEqual({ kind: 'ask', reason })
      expect(guard()(exec)).toBeUndefined()
      expect(guard()(exec)).toBe(reason)
    }
  })

  it('delegates unrelated tools', async () => {
    const { ctx, guard } = await directHarness({
      observe: 'deny', touch: 'deny', textInput: 'deny', deviceNavigation: 'deny',
    })
    const next = vi.fn(() => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
    const exec = execution('bash')
    await expect(decide(ctx, exec, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()
    expect(guard()(exec)).toBeUndefined()
  })
})

describe('Mobile Device monotonic guard', () => {
  async function runtimeHarness(config: Policy.Config) {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(Policy, config)
    const body = vi.fn(() => Promise.resolve('EXECUTED'))
    for (const name of ['mobile_observe', 'mobile_touch', 'mobile_type', 'mobile_button']) {
      ctx.tools.register(defineTool({
        name, description: name, parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: body,
      }))
    }
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }), { prepend: true })
    return { ctx, fiber, body }
  }

  it.each([
    ['mobile_observe', MOBILE_OBSERVE_APPROVAL_REASON],
    ['mobile_touch', MOBILE_TOUCH_APPROVAL_REASON],
    ['mobile_type', MOBILE_TEXT_INPUT_APPROVAL_REASON],
    ['mobile_button', MOBILE_DEVICE_NAVIGATION_APPROVAL_REASON],
  ])('blocks prepended allow from bypassing ask policy for %s', async (name, reason) => {
    const { ctx, body } = await runtimeHarness({})
    const result = await ctx.tools.execute({
      callId: ToolCallId(`policy-${name}`), name, arguments: {}, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: `Error: ${reason}` }] })
    expect(body).not.toHaveBeenCalled()
  })

  it('allows explicit decisions through the guard', async () => {
    const { ctx, body } = await runtimeHarness({
      observe: 'allow', touch: 'allow', textInput: 'allow', deviceNavigation: 'allow',
    })
    const result = await ctx.tools.execute({
      callId: ToolCallId('policy-allow'), name: 'mobile_touch', arguments: {}, signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(body).toHaveBeenCalledOnce()
  })

  it('blocks a prepended allow from bypassing deny policy', async () => {
    const { ctx, body } = await runtimeHarness({
      observe: 'deny', touch: 'deny', textInput: 'deny', deviceNavigation: 'deny',
    })
    const result = await ctx.tools.execute({
      callId: ToolCallId('policy-deny'), name: 'mobile_touch', arguments: {}, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({
      isError: true, content: [{ type: 'text', text: 'Error: Mobile device touch input is denied by policy.' }],
    })
    expect(body).not.toHaveBeenCalled()
  })

  it('removes decision and guard layers on HMR disposal', async () => {
    const { ctx, fiber, body } = await runtimeHarness({})
    const before = await ctx.tools.execute({
      callId: ToolCallId('policy-before-dispose'), name: 'mobile_touch', arguments: {}, signal: new AbortController().signal,
    })
    expect(before.isError).toBe(true)
    await fiber.dispose()
    const after = await ctx.tools.execute({
      callId: ToolCallId('policy-after-dispose'), name: 'mobile_touch', arguments: {}, signal: new AbortController().signal,
    })
    expect(after.isError).toBe(false)
    expect(body).toHaveBeenCalledOnce()
  })
})
