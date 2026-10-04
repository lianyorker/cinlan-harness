/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
/* oxlint-disable typescript/unbound-method -- Vitest inspects mock methods without invoking their receiver. */
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { BrowserElementSelectionId, BrowserPageId } from '@deepseek-ai/dsh-browser'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
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
      source: { kind: 'tool-browser-element-capture' },
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

  it('validates configuration and defaults both optional fields', () => {
    expect(Consumer.resolveBrowserElementCaptureConfig()).toEqual({ timeoutMs: 60_000, screenshotFormat: 'png' })
    expect(Consumer.resolveBrowserElementCaptureConfig({ timeoutMs: 1_000, screenshotFormat: 'jpeg' }))
      .toEqual({ timeoutMs: 1_000, screenshotFormat: 'jpeg' })
    expect(() => Consumer.resolveBrowserElementCaptureConfig({ timeoutMs: 0 }))
      .toThrow('timeoutMs must be a positive safe integer')
    expect(() => Consumer.resolveBrowserElementCaptureConfig({ timeoutMs: MAX_TIMER_DELAY_MS + 1 }))
      .toThrow('timeoutMs must be a positive safe integer')
    expect(() => Consumer.resolveBrowserElementCaptureConfig({ screenshotFormat: 'webp' as never }))
      .toThrow('screenshotFormat must be "png" or "jpeg"')
    expect(() => Consumer.resolveBrowserElementCaptureConfig({ unknown: true } as never))
      .toThrow("unsupported config key 'unknown'")
  })

  it('rejects a page id with surrounding whitespace before calling the Browser extension', async () => {
    const { ctx, browser } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)

    for (const pageId of ['', ' page-1']) {
      const result = await execute(ctx, 'browser_select_element', { page_id: pageId })
      expect(result).toMatchObject({
        isError: true,
        error: { message: 'page_id must be non-empty without surrounding whitespace' },
      })
    }
    expect(browser.selectElement).not.toHaveBeenCalled()
  })

  it('presents both capture calls as generic read cards', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)

    expect(ctx.tools.get('browser_select_element')?.presentCall?.({ page_id: 'page-1' }))
      .toEqual({ card: 'generic', title: 'Select element on page-1', kind: 'read' })
    expect(ctx.tools.get('browser_capture_element')?.presentCall?.({ page_id: 'page-2', selection_id: 'selection-1' }))
      .toEqual({ card: 'generic', title: 'Capture element on page-2', kind: 'read' })
  })

  it('rejects a capture that names no element identity', async () => {
    const { ctx, coordination } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)

    const result = await execute(ctx, 'browser_capture_element', { page_id: 'page-1' }, visionAgent())
    expect(result).toMatchObject({
      isError: true,
      error: { message: 'provide either selection_id or both observation_id and element_id' },
    })
    expect(coordination.start).not.toHaveBeenCalled()
  })

  it.each([
    ['a plain string', 'not-an-object', 'browser capture task output must be an object'],
    ['null', null, 'browser capture task output must be an object'],
    ['an array', [1], 'browser capture task output must be an object'],
    ['an unsupported field', { attachmentId: 'sha256:element', mediaType: 'image/png', bytes: 3, width: 30, height: 40, extra: true },
      "browser capture task output contains unsupported field 'extra'"],
    ['an empty attachment id', { attachmentId: '', mediaType: 'image/png', bytes: 3, width: 30, height: 40 },
      'browser capture task output field attachmentId is invalid'],
    ['a zero byte count', { attachmentId: 'sha256:element', mediaType: 'image/png', bytes: 0, width: 30, height: 40 },
      'browser capture task output field bytes is invalid'],
    ['a non-image media type', { attachmentId: 'sha256:element', mediaType: 'image/webp', bytes: 3, width: 30, height: 40 },
      'browser capture task output field mediaType is invalid'],
  ])('rejects %s returned by the Coordination executor', async (_label, output, message) => {
    const { ctx } = setup({ task: { id: 'task-1', status: 'succeeded', output } })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)

    const result = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    }, visionAgent())
    expect(result).toMatchObject({ isError: true, error: { message } })
  })

  it('durably references a capture image that carries no name', async () => {
    const { ctx } = setup({
      task: {
        id: 'task-1',
        status: 'succeeded',
        output: { attachmentId: 'sha256:element', mediaType: 'image/png', bytes: 3, width: 30, height: 40 },
      },
    })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)

    const result = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    }, visionAgent())
    expectSuccess(result)
    expect(result.value).toEqual({
      page_id: 'page-1',
      target: { kind: 'selection', selection_id: 'selection-1' },
      verified: true,
      image: { attachmentId: 'sha256:element', mediaType: 'image/png', bytes: 3, width: 30, height: 40 },
    })
    expect(result.content[1]).toEqual({
      type: 'image',
      attachment: {
        attachmentId: AttachmentId('sha256:element'),
        mediaType: 'image/png',
        bytes: 3,
        width: 30,
        height: 40,
      },
    })
  })

  // Presentation runs on replay of logged results, whose optional target ids an
  // older call may have omitted; the card must still render.
  it('renders a logged capture whose target omits identity fields', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    const capture = ctx.tools.get('browser_capture_element')
    if (capture === undefined) throw new Error('capture tool was not registered')
    const image = { attachmentId: 'sha256:element', mediaType: 'image/png' as const, bytes: 3, width: 30, height: 40 }

    const [selectionText] = capture.output.render({ page_id: 'page-1', selection_id: 'selection-1' }, {
      page_id: 'page-1', target: { kind: 'selection' }, verified: true, image,
    })
    expect(selectionText).toEqual({ type: 'text', text: expect.stringContaining('Target: selection \n') })
    const [observationText] = capture.output.render({ page_id: 'page-1', observation_id: 'observation-1', element_id: 'e1' }, {
      page_id: 'page-1', target: { kind: 'observation' }, verified: true, image,
    })
    expect(observationText).toEqual({ type: 'text', text: expect.stringContaining('Target: element  from observation \n') })
  })

  it('rejects a capture whose model route does not declare image input', async () => {
    const { ctx, coordination } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'text-only', name: 'Text only', inputModalities: ['text'],
      })),
    } as never)

    const result = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    }, visionAgent())
    expect(result).toMatchObject({
      isError: true,
      error: { message: "browser_capture_element requires an image-capable model; 'vision' does not declare image input" },
    })
    expect(coordination.start).not.toHaveBeenCalled()
  })

  it('requires a resolvable image-capable route before submitting capture work', async () => {
    const { ctx, coordination } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)

    const result = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    })
    expect(result).toMatchObject({
      isError: true,
      error: { message: 'browser_capture_element requires a resolvable image-capable model route' },
    })
    expect(coordination.start).not.toHaveBeenCalled()
  })

  it('falls back to agent options when the routed session header omits provider and model', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    const resolveModelInfo = vi.fn(async () => ({
      provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
    }))
    ctx.provide('llm', { resolveModelInfo } as never)
    const agent = {
      options: { provider: 'provider', model: 'vision' },
      session: { requestHeader: () => ({}) },
    }

    const result = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    }, agent)
    expectSuccess(result)
    expect(resolveModelInfo).toHaveBeenCalledWith('provider', 'vision', expect.any(AbortSignal))
  })

  it('reports the Coordination failure message when the run rejects with an error', async () => {
    let rejectRun!: (reason: unknown) => void
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
    rejectRun(new Error('installer exploded'))
    await expect(pending).resolves.toMatchObject({ isError: true, error: { message: 'installer exploded' } })
  })

  const settledFailures: ReadonlyArray<readonly [CaptureTask, string]> = [
    [{ id: 'task-1', status: 'failed', error: 'capture failed' }, 'capture failed'],
    [{ id: 'task-1', status: 'cancelled' }, 'browser element capture task ended with status cancelled'],
  ]
  it.each(settledFailures)('reports a settled Coordination task that did not succeed', async (task, message) => {
    const { ctx } = setup({ task })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)

    const result = await execute(ctx, 'browser_capture_element', {
      page_id: 'page-1', selection_id: 'selection-1',
    }, visionAgent())
    expect(result).toMatchObject({ isError: true, error: { message } })
  })

  it('cancels a Coordination run that starts after the caller already aborted', async () => {
    const { ctx, handle } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)
    const definition = ctx.tools.get('browser_capture_element')
    if (definition === undefined) throw new Error('capture tool was not registered')
    const controller = new AbortController()
    controller.abort('caller gave up')
    const execution = {
      callId: ToolCallId('pre-aborted-capture'),
      rootCallId: ToolCallId('pre-aborted-capture'),
      name: 'browser_capture_element',
      arguments: { page_id: 'page-1', selection_id: 'selection-1' },
      signal: controller.signal,
      agent: visionAgent(),
      token: Symbol('token') as never,
    } as unknown as ToolRunContext

    await expect(definition.execute(execution.arguments, execution))
      .rejects.toThrow('browser element capture cancelled')
    expect(handle.cancel).toHaveBeenCalledWith('browser element capture cancelled')
  })

  it('passes through an assembly that offers no capture tool', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('browser', {} as never)
    ctx.provide('coordination', {} as never)
    ctx.provide('tools', { register: vi.fn(() => () => {}) } as never)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Consumer)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools).toEqual([])
    expect(assembly.sections).toContainEqual({
      name: 'tool:browser-element-capture',
      text: Consumer.BROWSER_ELEMENT_CAPTURE_SYSTEM_PROMPT,
    })
  })

  it('keeps the capture tool when the route declares image input', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.systemPrompt.variable('provider', () => 'provider')
    ctx.systemPrompt.variable('model', () => 'vision')
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => ({
        provider: 'provider', id: 'vision', name: 'Vision', inputModalities: ['image'],
      })),
    } as never)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(tool => tool.name).sort()).toEqual(['browser_capture_element', 'browser_select_element'])
  })

  it('hides the capture tool when model capability resolution fails', async () => {
    const { ctx } = setup()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Consumer)
    ctx.systemPrompt.variable('provider', () => 'provider')
    ctx.systemPrompt.variable('model', () => 'vision')
    const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
    ctx.provide('llm', {
      resolveModelInfo: vi.fn(async () => { throw new Error('capability probe failed') }),
    } as never)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual(['browser_select_element'])
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('capability probe failed'))
  })
})
