/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
/* oxlint-disable typescript/unbound-method -- Vitest inspects mock methods without invoking their receiver. */
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { BrowserElementSelectionId, BrowserPageId } from '@deepseek-ai/dsh-browser'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Consumer from '../src/index.ts'

const contexts: Context[] = []
let callNumber = 0

type CaptureTask = {
  readonly id: string
  readonly status: 'succeeded' | 'failed' | 'cancelled'
  readonly output?: unknown
  readonly error?: string
}

function setup(options: {
  readonly task?: CaptureTask
  readonly result?: Promise<unknown>
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const browser = {
    selectElement: vi.fn(async () => ({
      pageId: BrowserPageId('page-1'),
      selectionId: BrowserElementSelectionId('selection-1'),
      tagName: 'button',
      role: 'button',
      name: 'Continue',
      text: 'Continue',
      rect: { x: 1, y: 2, width: 30, height: 40 },
    })),
    captureElement: vi.fn(async () => ({
      pageId: BrowserPageId('page-1'),
      format: 'png' as const,
      mediaType: 'image/png' as const,
      data: Uint8Array.of(1, 2, 3),
      target: { kind: 'observation' as const, observationId: 'observation-1' as never, elementId: 'e1' as never },
      rect: { x: 1, y: 2, width: 30, height: 40 },
      viewport: { width: 800, height: 600 },
      verified: true as const,
      tagName: 'button',
      role: 'button',
      name: 'Continue',
    })),
  }
  const task: CaptureTask = options.task ?? {
    id: 'task-1',
    status: 'succeeded',
    output: {
      attachmentId: 'sha256:element',
      mediaType: 'image/png',
      bytes: 3,
      width: 30,
      height: 40,
      name: 'browser-element.png',
    },
  }
  const handle = {
    result: options.result ?? Promise.resolve({ id: 'run-1', status: 'succeeded', taskIds: [task.id], createdAt: 1 }),
    cancel: vi.fn(),
  }
  const coordination = {
    start: vi.fn(() => handle),
    getTask: vi.fn(() => task),
  }
  ctx.provide('browser', browser as never)
  ctx.provide('coordination', coordination as never)
  return { ctx, browser, coordination, task, handle }
}

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function execute(
  ctx: Context,
  name: string,
  arguments_: unknown,
  agent?: unknown,
  signal: AbortSignal = new AbortController().signal,
): Promise<ToolExecutionResult> {
  callNumber += 1
  return ctx.tools.execute({
    callId: ToolCallId(`capture-call-${callNumber}`),
    name,
    arguments: arguments_,
    signal,
    ...(agent === undefined ? {} : { agent: agent as never }),
  })
}

function visionAgent() {
  return {
    options: { provider: 'provider', model: 'vision' },
    session: { requestHeader: () => ({ config: { provider: 'provider', model: 'vision' } }) },
  }
}

function expectSuccess(result: ToolExecutionResult): asserts result is Extract<ToolExecutionResult, { isError: false }> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful tool result')
}

describe('browser element capture Consumer', () => {
  it('registers two tools and stable English model guidance', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'browser_select_element',
      'browser_capture_element',
    ])
    expect((await ctx.systemPrompt.assemble()).sections).toContainEqual({
      name: 'tool:browser-element-capture',
      text: Consumer.BROWSER_ELEMENT_CAPTURE_SYSTEM_PROMPT,
    })
    expect(Consumer.BROWSER_ELEMENT_CAPTURE_SYSTEM_PROMPT).toMatch(/browser_select_element/)
    expect(Consumer.BROWSER_ELEMENT_CAPTURE_SYSTEM_PROMPT).toMatch(/browser_capture_element/)
    expect(Consumer.BROWSER_ELEMENT_CAPTURE_SYSTEM_PROMPT).not.toMatch(/[\u4e00-\u9fff]/u)
  })

  it('selects through the Browser extension and rejects mixed capture identities', async () => {
    const { ctx, browser } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)

    const selection = await execute(ctx, 'browser_select_element', { page_id: 'page-1' })
    expectSuccess(selection)
    expect(selection.value).toMatchObject({
      page_id: 'page-1',
      selection_id: 'selection-1',
      role: 'button',
      name: 'Continue',
      rect: { width: 30, height: 40 },
    })
    expect(browser.selectElement).toHaveBeenCalledWith({ pageId: 'page-1' }, expect.any(AbortSignal))

    const invalid = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1',
      selection_id: 'selection-1',
      observation_id: 'observation-1',
      element_id: 'e1',
    }, visionAgent())
    expect(invalid.isError).toBe(true)
    expect(browser.captureElement).not.toHaveBeenCalled()
  })

  it('submits exact JSON-safe task input and renders only the durable attachment result', async () => {
    const { ctx, coordination } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)

    const result = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', observation_id: 'observation-1', element_id: 'e1',
    }, visionAgent())
    expectSuccess(result)
    expect(coordination.start).toHaveBeenCalledWith({
      tasks: [{
        id: expect.stringMatching(/^browser-capture-/),
        label: 'Capture browser element',
        executor: 'browser-element-capture',
        input: {
          page_id: 'page-1',
          kind: 'observation',
          observation_id: 'observation-1',
          element_id: 'e1',
          format: 'png',
        },
      }],
    })
    expect(result.value).toEqual({
      page_id: 'page-1',
      target: { kind: 'observation', observation_id: 'observation-1', element_id: 'e1' },
      verified: true,
      image: {
        attachmentId: 'sha256:element',
        mediaType: 'image/png',
        bytes: 3,
        width: 30,
        height: 40,
        name: 'browser-element.png',
      },
    })
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('Captured a verified browser element image.') },
      { type: 'image', attachment: expect.objectContaining({ attachmentId: AttachmentId('sha256:element') }) },
    ])
  })

  it('hides the capture tool from non-image routes while retaining selection', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.systemPrompt.variable('provider', () => 'provider')
    ctx.systemPrompt.variable('model', () => 'text-only')
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'text-only', name: 'Text only', inputModalities: ['text'],
      })),
    } as never)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual(['browser_select_element'])
  })

  it('keeps nested capture images in the same deferred user context', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)
    const deferred: UserMessage[] = []
    const definition = ctx.tools.get('browser_capture_element')
    if (definition === undefined) throw new Error('capture tool was not registered')
    const execution = {
      callId: ToolCallId('nested-capture'),
      rootCallId: ToolCallId('nested-capture'),
      name: 'browser_capture_element',
      arguments: { page_id: 'page-1', selection_id: 'selection-1' },
      signal: new AbortController().signal,
      agent: visionAgent(),
      parent: Symbol('parent') as never,
      deferContext: (message: UserMessage) => { deferred.push(message) },
      token: Symbol('token') as never,
    } as unknown as ToolRunContext

    const value = await definition.execute(execution.arguments, execution)
    expect(value).toMatchObject({ verified: true, image: { attachmentId: 'sha256:element' } })
    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toMatchObject({
      role: 'user',
      source: { kind: 'plugin', plugin: 'tool-browser-element-capture' },
      content: [
        { type: 'text' },
        { type: 'image', attachment: { attachmentId: 'sha256:element' } },
      ],
    })
  })

  it('reports a Coordination run that rejects with undefined', async () => {
    let rejectRun!: (reason?: unknown) => void
    const runResult = new Promise<void>((_resolve, reject) => { rejectRun = reject })
    const { ctx } = setup({ result: runResult })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)

    const pending = execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    }, visionAgent())
    await vi.waitFor(() => { expect(ctx.coordination.start).toHaveBeenCalledOnce() })
    rejectRun(undefined)
    await expect(pending).resolves.toMatchObject({ isError: true })
  })
  it('waits for cancellation settlement and reports failed task output', async () => {
    let resolveRun!: () => void
    const runResult = new Promise<void>((resolve) => { resolveRun = resolve })
    const { ctx, handle } = setup({
      result: runResult,
      task: { id: 'task-1', status: 'failed', error: 'capture failed' },
    })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)
    const controller = new AbortController()
    const pending = execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    }, visionAgent(), controller.signal)
    await vi.waitFor(() => { expect(ctx.coordination.start).toHaveBeenCalledOnce() })
    controller.abort(new Error('caller stopped'))
    await vi.waitFor(() => { expect(handle.cancel).toHaveBeenCalledWith('browser element capture cancelled') })
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    resolveRun()
    await expect(pending).resolves.toMatchObject({ isError: true })
  })
})
