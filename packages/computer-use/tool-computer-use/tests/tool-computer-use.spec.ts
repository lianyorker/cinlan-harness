/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
/* oxlint-disable typescript/unbound-method -- Mock assertions inspect functions without invoking their receiver. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import ComputerUseRuntime, {
  ComputerAppId,
  ComputerElementId,
  ComputerObservationId,
  ComputerWindowId,
} from '@deepseek-ai/dsh-computer-use'
import type {
  ComputerActionResult,
  ComputerObservation,
  ComputerObserveRequest,
  ComputerUseProvider,
} from '@deepseek-ai/dsh-computer-use'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ToolComputerUse from '../src/index.ts'
import {
  COMPUTER_USE_SYSTEM_PROMPT,
  resolveComputerUseToolConfig,
} from '../src/index.ts'

const contexts: Context[] = []
let call = 0

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function observation(withImage = false): ComputerObservation {
  return {
    observationId: ComputerObservationId(`observation-${call}`),
    app: {
      appId: ComputerAppId('app'), name: 'App', bundleId: 'app', pid: 1,
      running: true, lastUsedAt: null, useCount: null,
    },
    window: {
      windowId: ComputerWindowId('id:2'), appId: ComputerAppId('app'), title: 'Window',
      x: null, y: null, width: 100, height: 80, minimized: null, offscreen: null,
      screenIndex: null, main: null,
    },
    coordinateSpace: 'window',
    tree: '0 button Continue\n7 edit Name',
    elements: [{ elementId: ComputerElementId('0'), index: 0 }, { elementId: ComputerElementId('7'), index: 7 }],
    focusedElementId: ComputerElementId('7'),
    screenshotStatus: withImage ? { state: 'captured' } : { state: 'skipped', reason: 'no_screenshot_flag' },
    ...(withImage ? {
      screenshot: {
        mediaType: 'image/png' as const,
        data: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        width: 2, height: 1, scale: 1,
      },
    } : {}),
  }
}

function provider(): ComputerUseProvider {
  const action = (request: { captureScreenshot?: boolean }): Promise<ComputerActionResult> => Promise.resolve({
    observation: observation(request.captureScreenshot === true),
    action: { path: 'accessibility', actionName: 'Action', fallbackReason: null, verification: { state: 'verified', property: 'value' } },
  })
  return {
    id: 'test', available: () => true,
    capabilities: vi.fn(() => Promise.reject(new Error('unused'))),
    listApps: vi.fn(() => Promise.resolve([
      { appId: ComputerAppId('app'), name: 'App', bundleId: 'app', pid: 1, running: true, lastUsedAt: null, useCount: null },
      { appId: ComputerAppId('pid:2'), name: 'No bundle', bundleId: null, pid: 2, running: false, lastUsedAt: null, useCount: null },
    ])),
    listWindows: vi.fn(() => Promise.resolve([observation().window])),
    observe: vi.fn((request: ComputerObserveRequest) => Promise.resolve(observation(request.captureScreenshot === true))),
    click: vi.fn(action),
    performSecondaryAction: vi.fn(action),
    scroll: vi.fn(action),
    drag: vi.fn(action),
    typeText: vi.fn(action),
    pressKey: vi.fn(action),
    hotkey: vi.fn(action),
    pasteText: vi.fn(action),
    setValue: vi.fn(action),
  }
}

function attachmentStore() {
  return {
    imageLimits: {
      maxImageBytes: 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 4096,
      maxImagePixels: 1000, mediaTypes: ['image/png'],
    },
    validateImage: vi.fn(() => Promise.resolve()),
    saveImage: vi.fn((): Promise<ImageAttachmentRef> => Promise.resolve({
      attachmentId: AttachmentId('sha256:image'), mediaType: 'image/png', bytes: 8,
      width: 2, height: 1, name: 'computer-screenshot.png',
    })),
    readImage: vi.fn(() => Promise.reject(new Error('unused'))),
  }
}

async function harness(config: ToolComputerUse.Config = {}, selected = provider(), attachments = attachmentStore()) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(ComputerUseRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('attachments', attachments as never)
  ctx.computerUse.registerProvider(selected)
  const fiber = await ctx.plugin(ToolComputerUse, config)
  return { ctx, fiber, selected, attachments }
}

function agent(inputModalities: readonly string[] | undefined): Agent {
  return {
    options: { provider: 'provider', model: 'model' },
    session: { requestHeader: () => undefined },
    inputModalities,
  } as unknown as Agent
}

function routedAgent(
  header: { provider?: string; model?: string } | undefined,
  options: { provider?: string; model?: string } = {},
): Agent {
  return {
    options,
    session: { requestHeader: () => header === undefined ? undefined : { config: header } },
  } as unknown as Agent
}

async function execute(ctx: Context, name: string, args: unknown, selectedAgent?: Agent): Promise<ToolExecutionResult> {
  call += 1
  return ctx.tools.execute({
    callId: ToolCallId(`computer-${call}`), name, arguments: args,
    signal: new AbortController().signal,
    ...(selectedAgent === undefined ? {} : { agent: selectedAgent }),
  })
}

function expectSuccess(result: ToolExecutionResult): asserts result is Extract<ToolExecutionResult, { isError: false }> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful tool result')
}

const base = { app_id: 'app', window_id: 'id:2', observation_id: 'observation', restore_window: true }

describe('Computer Use tool registration', () => {
  it('validates config and registers six stable tools plus prompt guidance', async () => {
    expect(resolveComputerUseToolConfig()).toEqual({ timeoutMs: 60_000, maxTextChars: 100_000 })
    expect(resolveComputerUseToolConfig({ timeoutMs: 10, maxTextChars: 20 })).toEqual({ timeoutMs: 10, maxTextChars: 20 })
    expect(() => resolveComputerUseToolConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    for (const config of [{ timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: 2_147_483_648 }, { maxTextChars: 0 }]) {
      expect(() => resolveComputerUseToolConfig(config)).toThrow()
    }
    const { ctx, fiber } = await harness({ timeoutMs: 321 })
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'computer_list_apps', 'computer_list_windows', 'computer_observe',
      'computer_pointer', 'computer_keyboard', 'computer_accessibility',
    ])
    expect(ctx.tools.get('computer_list_apps')?.timeoutMs).toBe(321)
    expect(ctx.tools.get('computer_list_apps')?.isConcurrencySafe?.({})).toBe(true)
    expect(ctx.tools.get('computer_list_windows')?.isConcurrencySafe?.({ app_id: 'app' })).toBe(true)
    expect((await ctx.systemPrompt.assemble()).sections).toContainEqual({
      name: 'tool:computer-use', text: COMPUTER_USE_SYSTEM_PROMPT,
    })
    expect(COMPUTER_USE_SYSTEM_PROMPT).toContain('not echoed in result summaries')
    expect(COMPUTER_USE_SYSTEM_PROMPT).not.toContain('stdin')
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })
})

describe('Computer Use tool behavior', () => {
  it('lists apps/windows and observes text-only routes without screenshots', async () => {
    const { ctx, selected } = await harness()
    const apps = await execute(ctx, 'computer_list_apps', {})
    expectSuccess(apps)
    expect(apps.value).toMatchObject({ apps: [{ app_id: 'app', bundle_id: 'app' }, { app_id: 'pid:2' }] })
    expect(apps.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('pid:2') })
    const windows = await execute(ctx, 'computer_list_windows', { app_id: 'app' })
    expectSuccess(windows)
    expect(windows.value).toMatchObject({ windows: [{ window_id: 'id:2' }] })
    const observed = await execute(ctx, 'computer_observe', { app_id: 'app', restore_window: true })
    expectSuccess(observed)
    expect(observed.value).toMatchObject({ observation_id: expect.any(String), screenshot_status: 'skipped' })
    expect(selected.observe).toHaveBeenCalledWith(
      expect.objectContaining({ captureScreenshot: false, restoreWindow: true }),
      expect.any(AbortSignal),
    )
  })

  it('renders empty reads and sparse failed observations explicitly', async () => {
    const selected = provider()
    vi.mocked(selected.listApps).mockResolvedValueOnce([])
    vi.mocked(selected.listWindows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        ...observation().window,
        x: 1,
        y: 2,
        minimized: false,
        offscreen: true,
        main: false,
      }])
    vi.mocked(selected.observe).mockResolvedValueOnce({
      ...observation(),
      window: {
        ...observation().window,
        x: 1,
        y: 2,
        minimized: false,
        offscreen: true,
        main: false,
      },
      tree: '',
      elements: [],
      focusedElementId: null,
      screenshotStatus: { state: 'failed', code: 'capture_failed', message: 'capture unavailable' },
    })
    const { ctx } = await harness({}, selected)
    const apps = await execute(ctx, 'computer_list_apps', {})
    expectSuccess(apps)
    expect(apps.content).toEqual([{ type: 'text', text: 'No desktop applications are available.' }])
    const windows = await execute(ctx, 'computer_list_windows', { app_id: 'app' })
    expectSuccess(windows)
    expect(windows.content).toEqual([{ type: 'text', text: 'No windows are available for this application.' }])
    const positioned = await execute(ctx, 'computer_list_windows', { app_id: 'app' })
    expectSuccess(positioned)
    expect(positioned.value).toMatchObject({ windows: [{ x: 1, y: 2, minimized: false, offscreen: true, main: false }] })
    const observed = await execute(ctx, 'computer_observe', { app_id: 'app', window_id: 'id:2' })
    expectSuccess(observed)
    expect(observed.value).not.toHaveProperty('focused_element_id')
    expect(observed.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Screenshot: failed (capture unavailable)'),
    })
    expect(observed.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('(empty accessibility tree)') })
  })

  it('executes every grouped pointer, keyboard, and accessibility action', async () => {
    const { ctx, selected } = await harness()
    const calls = [
      ['computer_pointer', { ...base, action: 'click', element_id: '0', click_count: 2, mouse_button: 'right', modifiers: 'CmdOrCtrl' }],
      ['computer_pointer', { ...base, action: 'click', x: 1, y: 2 }],
      ['computer_pointer', { ...base, action: 'scroll', element_id: '0', direction: 'down', pages: 2 }],
      ['computer_pointer', { ...base, action: 'drag', element_id: '0', to_element_id: '7' }],
      ['computer_pointer', { ...base, action: 'drag', x: 1, y: 2, to_x: 3, to_y: 4 }],
      ['computer_keyboard', { ...base, action: 'type_text', text: 'typed' }],
      ['computer_keyboard', { ...base, action: 'paste_text', text: 'pasted' }],
      ['computer_keyboard', { ...base, action: 'press_key', key: 'Return' }],
      ['computer_keyboard', { ...base, action: 'hotkey', key: 'CmdOrCtrl+A' }],
      ['computer_accessibility', { ...base, action: 'secondary_action', element_id: '0', action_name: 'Press' }],
      ['computer_accessibility', { ...base, action: 'set_value', element_id: '7', value: '' }],
    ] as const
    for (const [name, args] of calls) {
      const result = await execute(ctx, name, args)
      expectSuccess(result)
      expect(result.value).toMatchObject({ action: { path: 'accessibility', verification: 'verified:value' } })
    }
    for (const method of [
      selected.click, selected.scroll, selected.drag, selected.typeText, selected.pasteText,
      selected.pressKey, selected.hotkey, selected.performSecondaryAction, selected.setValue,
    ]) expect(method).toHaveBeenCalled()
  })

  it('renders fallback and unverified action metadata without optional request fields', async () => {
    const selected = provider()
    vi.mocked(selected.click).mockResolvedValueOnce({
      observation: observation(),
      action: { path: 'synthetic', actionName: null, fallbackReason: 'accessibility unavailable' },
    })
    vi.mocked(selected.scroll).mockResolvedValueOnce({
      observation: observation(),
      action: {
        path: 'clipboard',
        actionName: null,
        fallbackReason: null,
        verification: { state: 'unverified', reason: 'clipboard_paste' },
      },
    })
    const { ctx } = await harness({}, selected)
    const clicked = await execute(ctx, 'computer_pointer', {
      app_id: 'app', window_id: 'id:2', observation_id: 'observation',
      action: 'click', element_id: '0',
    })
    expectSuccess(clicked)
    expect(clicked.value).toMatchObject({
      action: { path: 'synthetic', fallback_reason: 'accessibility unavailable' },
    })
    expect(clicked.value).not.toHaveProperty('action.action_name')
    expect(clicked.value).not.toHaveProperty('action.verification')

    const scrolled = await execute(ctx, 'computer_pointer', {
      app_id: 'app', window_id: 'id:2', observation_id: 'observation',
      action: 'scroll', element_id: '0', direction: 'down',
    })
    expectSuccess(scrolled)
    expect(scrolled.value).toMatchObject({ action: { verification: 'unverified:clipboard_paste' } })
    expect(selected.scroll).toHaveBeenCalledWith(expect.not.objectContaining({ pages: expect.anything() }), expect.any(AbortSignal))
  })

  it('persists screenshots only for an exact image-capable route', async () => {
    const { ctx, selected, attachments } = await harness()
    const resolveModelInfo = vi.fn()
      .mockResolvedValueOnce({ provider: 'provider', id: 'model', name: 'Model', inputModalities: ['text', 'image'] })
      .mockResolvedValueOnce({ provider: 'provider', id: 'model', name: 'Model', inputModalities: ['text'] })
    ctx.provide('llm', { resolveModelInfo } as never)
    const result = await execute(ctx, 'computer_observe', { app_id: 'app' }, agent(['image']))
    expectSuccess(result)
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'text' }),
      { type: 'image', attachment: expect.objectContaining({ attachmentId: 'sha256:image' }) },
    ])
    expect(selected.observe).toHaveBeenCalledWith(expect.objectContaining({ captureScreenshot: true }), expect.any(AbortSignal))
    expect(attachments.saveImage).toHaveBeenCalled()

    const text = await execute(ctx, 'computer_observe', { app_id: 'app' }, agent(['text']))
    expectSuccess(text)
    expect(text.content).toHaveLength(1)
  })

  it('uses routed model metadata and treats unavailable image routes as text-only', async () => {
    const { ctx, selected } = await harness()
    const resolveModelInfo = vi.fn()
      .mockResolvedValueOnce({ provider: 'header-provider', id: 'header-model', name: 'Vision', inputModalities: ['image'] })
      .mockRejectedValueOnce(new Error('route unavailable'))
      .mockResolvedValueOnce({ provider: 'provider', id: 'model', name: 'Unknown' })
    ctx.provide('llm', { resolveModelInfo } as never)

    const routed = await execute(
      ctx,
      'computer_observe',
      { app_id: 'app' },
      routedAgent({ provider: 'header-provider', model: 'header-model' }, { provider: 'fallback', model: 'fallback' }),
    )
    expectSuccess(routed)
    expect(resolveModelInfo).toHaveBeenNthCalledWith(1, 'header-provider', 'header-model', expect.any(AbortSignal))
    expect(selected.observe).toHaveBeenLastCalledWith(expect.objectContaining({ captureScreenshot: true }), expect.any(AbortSignal))

    for (const selectedAgent of [
      routedAgent(undefined, { provider: 'provider', model: 'model' }),
      routedAgent(undefined, { model: 'model' }),
      routedAgent(undefined, { provider: 'provider' }),
      routedAgent(undefined, { provider: 'provider', model: 'model' }),
    ]) {
      const result = await execute(ctx, 'computer_observe', { app_id: 'app' }, selectedAgent)
      expectSuccess(result)
      expect(selected.observe).toHaveBeenLastCalledWith(expect.objectContaining({ captureScreenshot: false }), expect.any(AbortSignal))
    }

    const unsupported = attachmentStore()
    unsupported.imageLimits.mediaTypes = []
    const noPng = await harness({}, provider(), unsupported)
    noPng.ctx.provide('llm', { resolveModelInfo: vi.fn() } as never)
    const result = await execute(noPng.ctx, 'computer_observe', { app_id: 'app' }, agent(['image']))
    expectSuccess(result)
    expect(noPng.selected.observe).toHaveBeenCalledWith(expect.objectContaining({ captureScreenshot: false }), expect.any(AbortSignal))
  })

  it('defers a durable image context for nested calls without requiring an attachment name', async () => {
    const attachments = attachmentStore()
    attachments.saveImage.mockResolvedValueOnce({
      attachmentId: AttachmentId('sha256:unnamed'), mediaType: 'image/png', bytes: 8, width: 2, height: 1,
    })
    const { ctx } = await harness({}, provider(), attachments)
    ctx.provide('llm', { resolveModelInfo: () => Promise.resolve({
      provider: 'provider', id: 'model', name: 'Vision', inputModalities: ['image'],
    }) } as never)
    const deferred: UserMessage[] = []
    const definition = ctx.tools.get('computer_observe')!
    const value = await definition.execute({ app_id: 'app' }, {
      callId: ToolCallId('nested-computer-observe'),
      name: 'computer_observe',
      arguments: { app_id: 'app' },
      signal: new AbortController().signal,
      agent: routedAgent(undefined, { provider: 'provider', model: 'model' }),
      parent: {} as ToolRunContext,
      deferContext: (message: UserMessage) => { deferred.push(message) },
    } as unknown as ToolRunContext)
    expect(value).toMatchObject({ image: { attachmentId: 'sha256:unnamed' } })
    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toMatchObject({
      role: 'user',
      source: { kind: 'plugin', plugin: 'tool-computer-use' },
      content: [{ type: 'text' }, { type: 'image', attachment: { attachmentId: 'sha256:unnamed' } }],
    })
  })

  it('keeps successful action state when optional image persistence fails', async () => {
    const attachments = attachmentStore()
    attachments.saveImage.mockRejectedValueOnce(new Error('store unavailable'))
    const { ctx } = await harness({}, provider(), attachments)
    ctx.provide('llm', { resolveModelInfo: () => Promise.resolve({
      provider: 'provider', id: 'model', name: 'Model', inputModalities: ['image'],
    }) } as never)
    const result = await execute(ctx, 'computer_keyboard', {
      ...base, action: 'press_key', key: 'Return',
    }, agent(['image']))
    expectSuccess(result)
    expect(result.value).toMatchObject({ image_error: 'store unavailable' })

    attachments.saveImage.mockRejectedValueOnce('string failure')
    const stringFailure = await execute(ctx, 'computer_keyboard', {
      ...base, action: 'press_key', key: 'Return',
    }, agent(['image']))
    expectSuccess(stringFailure)
    expect(stringFailure.value).toMatchObject({ image_error: 'string failure' })
  })

  it.each([
    ['computer_list_windows', { app_id: '' }],
    ['computer_observe', { app_id: ' app ' }],
    ['computer_pointer', { ...base, action: 'click' }],
    ['computer_pointer', { ...base, action: 'click', element_id: '0', x: 1, y: 2 }],
    ['computer_pointer', { ...base, action: 'scroll', element_id: '0' }],
    ['computer_pointer', { ...base, action: 'drag', element_id: '0' }],
    ['computer_pointer', { ...base, action: 'click', x: -1, y: 2 }],
    ['computer_pointer', { ...base, action: 'click', x: Number.POSITIVE_INFINITY, y: 2 }],
    ['computer_pointer', { ...base, action: 'click', element_id: '0', click_count: 0 }],
    ['computer_pointer', { ...base, action: 'click', element_id: '0', direction: 'down' }],
    ['computer_pointer', { ...base, action: 'click', element_id: '0', modifiers: ' Ctrl ' }],
    ['computer_pointer', { ...base, action: 'scroll', element_id: '0', direction: 'down', pages: 0 }],
    ['computer_keyboard', { ...base, action: 'type_text' }],
    ['computer_keyboard', { ...base, action: 'press_key', key: '' }],
    ['computer_keyboard', { ...base, action: 'press_key' }],
    ['computer_keyboard', { ...base, action: 'hotkey', key: 'A', text: 'extra' }],
    ['computer_accessibility', { ...base, action: 'secondary_action', element_id: '0' }],
    ['computer_accessibility', { ...base, action: 'set_value', element_id: '0' }],
  ])('rejects invalid model input for %s', async (name, args) => {
    const { ctx } = await harness({ maxTextChars: 3 })
    expect((await execute(ctx, name, args)).isError).toBe(true)
  })

  it('rejects over-limit text and declares pure generic render intent', async () => {
    const { ctx } = await harness({ maxTextChars: 3 })
    expect((await execute(ctx, 'computer_keyboard', { ...base, action: 'type_text', text: 'long' })).isError).toBe(true)
    expect(ctx.tools.get('computer_list_apps')?.presentCall?.({})).toEqual({ card: 'generic', title: 'List desktop apps', kind: 'read' })
    expect(ctx.tools.get('computer_list_windows')?.presentCall?.({ app_id: 'app' })).toEqual({ card: 'generic', title: 'List windows for app', kind: 'read' })
    expect(ctx.tools.get('computer_observe')?.presentCall?.({ app_id: 'app' })).toEqual({ card: 'generic', title: 'Observe app', kind: 'read' })
    expect(ctx.tools.get('computer_pointer')?.presentCall?.({ ...base, action: 'click', element_id: '0' })).toEqual({ card: 'generic', title: 'click in app', kind: 'execute' })
    expect(ctx.tools.get('computer_keyboard')?.presentCall?.({ ...base, action: 'press_key', key: 'Return' })).toEqual({ card: 'generic', title: 'press_key in app', kind: 'execute' })
    expect(ctx.tools.get('computer_accessibility')?.presentCall?.({ ...base, action: 'set_value', element_id: '7', value: 'value' })).toEqual({ card: 'generic', title: 'set_value in app', kind: 'execute' })
  })
})
