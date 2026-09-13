import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as BrowserPermissionPolicy from '../src/index.ts'
import {
  BROWSER_INTERACT_APPROVAL_REASON,
  BROWSER_NAVIGATE_APPROVAL_REASON,
  BROWSER_OBSERVE_APPROVAL_REASON,
  resolveBrowserPermissionConfig,
} from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function execution(name: string): ToolExecution {
  return { name } as ToolExecution
}

async function decide(
  ctx: Context,
  exec: ToolExecution,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  return ctx.waterfall(ctx as never, 'tools/pre-execute', exec, next)
}

async function directHarness(config: BrowserPermissionPolicy.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  let guard: ToolGuard | undefined
  const guardDisposer = vi.fn()
  ctx.provide('tools', {
    guard(candidate: ToolGuard) {
      guard = candidate
      return guardDisposer
    },
  } as never)
  const fiber = await ctx.plugin(BrowserPermissionPolicy, config)
  return { ctx, fiber, guard: () => guard!, guardDisposer }
}

describe('browser permission config', () => {
  it('defaults independent observe, navigate, and interact decisions', () => {
    expect(resolveBrowserPermissionConfig()).toEqual({ observe: 'ask', navigate: 'ask', interact: 'ask' })
    expect(resolveBrowserPermissionConfig({ observe: 'deny', navigate: 'allow', interact: 'deny' })).toEqual({
      observe: 'deny', navigate: 'allow', interact: 'deny',
    })
    expect(() => resolveBrowserPermissionConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    expect(() => resolveBrowserPermissionConfig({ observe: 'sometimes' as never })).toThrow(/observe must be/)
    expect(() => resolveBrowserPermissionConfig({ navigate: 'sometimes' as never })).toThrow(/navigate must be/)
    expect(() => resolveBrowserPermissionConfig({ interact: 'sometimes' as never })).toThrow(/interact must be/)
  })
})

describe('browser permission decisions', () => {
  it.each([
    ['browser_list', 'observe'],
    ['browser_snapshot', 'observe'],
    ['browser_screenshot', 'observe'],
    ['browser_select_element', 'observe'],
    ['browser_capture_element', 'observe'],
    ['browser_downloads', 'observe'],
    ['browser_upload', 'interact'],
    ['browser_save_download', 'interact'],
    ['browser_history', 'observe'],
    ['browser_network', 'observe'],
    ['browser_home', 'navigate'],
    ['browser_search', 'navigate'],
    ['browser_back', 'navigate'],
    ['browser_forward', 'navigate'],
    ['browser_open', 'navigate'],
    ['browser_navigate', 'navigate'],
    ['browser_click', 'interact'],
    ['browser_close', 'interact'],
  ] as const)('classifies %s as %s', async (tool, permissionClass) => {
    const config = { observe: 'allow', navigate: 'ask', interact: 'deny' } as const
    const { ctx, guard } = await directHarness(config)
    const next = vi.fn(() => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
    const exec = execution(tool)
    const decision = await decide(ctx, exec, next)
    if (permissionClass === 'observe') {
      expect(decision).toEqual({ kind: 'allow' })
      expect(next).toHaveBeenCalledOnce()
      expect(guard()(exec)).toBeUndefined()
    } else if (permissionClass === 'navigate') {
      expect(decision).toEqual({ kind: 'ask', reason: BROWSER_NAVIGATE_APPROVAL_REASON })
      expect(next).not.toHaveBeenCalled()
      expect(guard()(exec)).toBeUndefined()
      expect(guard()(exec)).toBe(BROWSER_NAVIGATE_APPROVAL_REASON)
    } else {
      expect(decision).toEqual({ kind: 'deny', reason: 'Persistent browser interaction is denied by policy.' })
      expect(next).not.toHaveBeenCalled()
      expect(guard()(exec)).toBe('Persistent browser interaction is denied by policy.')
    }
  })

  it('delegates unrelated tools and leaves them outside the guard', async () => {
    const { ctx, guard } = await directHarness({ observe: 'deny', navigate: 'deny', interact: 'deny' })
    const next = vi.fn(() => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
    const exec = execution('bash')
    await expect(decide(ctx, exec, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()
    expect(guard()(exec)).toBeUndefined()
  })

  it('uses the distinct observe and interact approval text', async () => {
    const { ctx, guard } = await directHarness({ observe: 'ask', navigate: 'allow', interact: 'ask' })
    const next = () => Promise.resolve<PreToolDecision>({ kind: 'allow' })
    const observe = execution('browser_snapshot')
    const interact = execution('browser_click')
    await expect(decide(ctx, observe, next)).resolves.toEqual({ kind: 'ask', reason: BROWSER_OBSERVE_APPROVAL_REASON })
    await expect(decide(ctx, interact, next)).resolves.toEqual({ kind: 'ask', reason: BROWSER_INTERACT_APPROVAL_REASON })
    expect(guard()(observe)).toBeUndefined()
    expect(guard()(interact)).toBeUndefined()
  })
})

describe('browser permission monotonic guard', () => {
  async function runtimeHarness(config: BrowserPermissionPolicy.Config) {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(BrowserPermissionPolicy, config)
    const body = vi.fn(() => Promise.resolve('EXECUTED'))
    for (const name of ['browser_list', 'browser_open', 'browser_click', 'browser_home', 'browser_search', 'browser_back', 'browser_forward', 'browser_history', 'browser_network', 'browser_upload', 'browser_downloads', 'browser_save_download']) {
      ctx.tools.register(defineTool({
        name,
        description: name,
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: body,
      }))
    }
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }), { prepend: true })
    return { ctx, fiber, body }
  }

  it.each([
    ['browser_list', BROWSER_OBSERVE_APPROVAL_REASON],
    ['browser_open', BROWSER_NAVIGATE_APPROVAL_REASON],
    ['browser_click', BROWSER_INTERACT_APPROVAL_REASON],
    ['browser_home', BROWSER_NAVIGATE_APPROVAL_REASON],
    ['browser_search', BROWSER_NAVIGATE_APPROVAL_REASON],
    ['browser_back', BROWSER_NAVIGATE_APPROVAL_REASON],
    ['browser_forward', BROWSER_NAVIGATE_APPROVAL_REASON],
    ['browser_history', BROWSER_OBSERVE_APPROVAL_REASON],
    ['browser_network', BROWSER_OBSERVE_APPROVAL_REASON],
    ['browser_downloads', BROWSER_OBSERVE_APPROVAL_REASON],
    ['browser_upload', BROWSER_INTERACT_APPROVAL_REASON],
    ['browser_save_download', BROWSER_INTERACT_APPROVAL_REASON],
  ])('blocks a prepended allow from bypassing ask policy for %s', async (name, reason) => {
    const { ctx, body } = await runtimeHarness({ observe: 'ask', navigate: 'ask', interact: 'ask' })
    const result = await ctx.tools.execute({
      callId: ToolCallId(`bypass-${name}`), name, arguments: {}, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: `Error: ${reason}` }] })
    expect(body).not.toHaveBeenCalled()
  })

  it('blocks a prepended allow from bypassing deny policy', async () => {
    const { ctx, body } = await runtimeHarness({ observe: 'deny', navigate: 'deny', interact: 'deny' })
    const result = await ctx.tools.execute({
      callId: ToolCallId('deny-bypass'), name: 'browser_open', arguments: {}, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: Persistent browser navigation is denied by policy.' }],
    })
    expect(body).not.toHaveBeenCalled()
  })

  it('allows configured calls and removes both policy layers on HMR disposal', async () => {
    const { ctx, fiber, body } = await runtimeHarness({ observe: 'allow', navigate: 'ask', interact: 'ask' })
    const allowed = await ctx.tools.execute({
      callId: ToolCallId('observe-allow'), name: 'browser_list', arguments: {}, signal: new AbortController().signal,
    })
    expect(allowed.isError).toBe(false)
    expect(body).toHaveBeenCalledOnce()

    const before = await ctx.tools.execute({
      callId: ToolCallId('navigate-before-dispose'), name: 'browser_open', arguments: {}, signal: new AbortController().signal,
    })
    expect(before.isError).toBe(true)
    await fiber.dispose()
    const after = await ctx.tools.execute({
      callId: ToolCallId('navigate-after-dispose'), name: 'browser_open', arguments: {}, signal: new AbortController().signal,
    })
    expect(after.isError).toBe(false)
    expect(body).toHaveBeenCalledTimes(2)
  })
})
