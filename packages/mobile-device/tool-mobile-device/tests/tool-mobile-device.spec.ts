/* oxlint-disable typescript/unbound-method -- Mock assertions inspect methods without invoking their receiver. */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import MobileDeviceRuntime, {
  MobileDeviceGeneration,
  MobileDeviceId,
  MobileObservationId,
} from '@deepseek-ai/dsh-mobile-device'
import type {
  MobileDeviceProvider,
  MobileObservation,
  MobileObserveRequest,
} from '@deepseek-ai/dsh-mobile-device'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ToolMobileDevice from '../src/index.ts'
import {
  MOBILE_DEVICE_SYSTEM_PROMPT,
  resolveMobileDeviceToolConfig,
} from '../src/index.ts'

const contexts: Context[] = []
let call = 0

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function observation(withImage = false): MobileObservation {
  return {
    device: {
      backend: 'android', id: MobileDeviceId('device-1'), name: 'Pixel', state: 'booted',
      isAvailable: true, detail: 'API 35',
    },
    deviceGeneration: MobileDeviceGeneration('generation-1'),
    observationId: MobileObservationId(`observation-${call}`),
    coordinateSpace: 'normalized',
    tree: 'button Continue',
    screenshotStatus: withImage ? { state: 'captured' } : { state: 'skipped' },
    ...(withImage ? {
      screenshot: {
        mediaType: 'image/png' as const,
        data: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
        width: 2,
        height: 1,
      },
    } : {}),
  }
}

function provider(): MobileDeviceProvider {
  const mutate = vi.fn((request: {
    deviceId: ReturnType<typeof MobileDeviceId>
    observationId: ReturnType<typeof MobileObservationId>
  }) => Promise.resolve({
    device: observation().device,
    deviceGeneration: MobileDeviceGeneration('generation-1'),
    observationId: request.observationId,
  }))
  return {
    id: 'test',
    available: () => true,
    listDevices: vi.fn(() => Promise.resolve([
      observation().device,
      { backend: 'ios', id: MobileDeviceId('device-2'), name: 'iPhone', state: 'shutdown', isAvailable: false },
    ])),
    observe: vi.fn((request: MobileObserveRequest) => Promise.resolve(observation(request.captureScreenshot === true))),
    touch: mutate,
    typeText: mutate,
    pressButton: mutate,
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
      attachmentId: AttachmentId('sha256:image'), mediaType: 'image/png', bytes: 4,
      width: 2, height: 1, name: 'mobile-device-screenshot.png',
    })),
    readImage: vi.fn(() => Promise.reject(new Error('unused'))),
  }
}

async function harness(
  config: ToolMobileDevice.Config = {},
  selected = provider(),
  attachments = attachmentStore(),
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MobileDeviceRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('attachments', attachments as never)
  ctx.mobileDevice.registerProvider(selected)
  const fiber = await ctx.plugin(ToolMobileDevice, config)
  return { ctx, fiber, selected, attachments }
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
    callId: ToolCallId(`mobile-${call}`), name, arguments: args,
    signal: new AbortController().signal,
    ...(selectedAgent === undefined ? {} : { agent: selectedAgent }),
  })
}

function expectSuccess(result: ToolExecutionResult): asserts result is Extract<ToolExecutionResult, { isError: false }> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful tool result')
}

const base = { device_id: 'device-1', observation_id: 'observation-1' }

describe('Mobile Device tool registration', () => {
  it('validates config and registers five tools plus system guidance', async () => {
    expect(resolveMobileDeviceToolConfig()).toEqual({ timeoutMs: 60_000, maxTextChars: 100_000 })
    expect(resolveMobileDeviceToolConfig({ timeoutMs: 10, maxTextChars: 20 })).toEqual({ timeoutMs: 10, maxTextChars: 20 })
    expect(() => resolveMobileDeviceToolConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    for (const config of [{ timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: 2_147_483_648 }, { maxTextChars: 0 }]) {
      expect(() => resolveMobileDeviceToolConfig(config)).toThrow()
    }
    const { ctx, fiber } = await harness({ timeoutMs: 321 })
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'mobile_list_devices', 'mobile_observe', 'mobile_touch', 'mobile_type', 'mobile_button',
    ])
    expect(ctx.tools.get('mobile_list_devices')?.timeoutMs).toBe(321)
    expect(ctx.tools.get('mobile_list_devices')?.isConcurrencySafe?.({})).toBe(true)
    expect((await ctx.systemPrompt.assemble()).sections).toContainEqual({
      name: 'tool:mobile-device', text: MOBILE_DEVICE_SYSTEM_PROMPT,
    })
    expect(MOBILE_DEVICE_SYSTEM_PROMPT).toContain('one-use')
    expect(ctx.tools.get('mobile_list_devices')?.presentCall?.({})).toMatchObject({ title: 'List mobile devices' })
    expect(ctx.tools.get('mobile_observe')?.presentCall?.({ device_id: 'device-1' })).toMatchObject({ title: 'Observe device-1' })
    expect(ctx.tools.get('mobile_touch')?.presentCall?.({
      ...base, action: 'tap', x: 0.5, y: 0.5,
    })).toMatchObject({ title: 'tap device-1' })
    expect(ctx.tools.get('mobile_type')?.presentCall?.({ ...base, text: 'hidden' }))
      .toMatchObject({ title: 'Type text on device-1' })
    expect(ctx.tools.get('mobile_button')?.presentCall?.({ ...base, button: 'home' }))
      .toMatchObject({ title: 'Press home on device-1' })
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })
})

describe('Mobile Device tool behavior', () => {
  it('lists and observes tree-only routes without requesting screenshots', async () => {
    const { ctx, selected } = await harness()
    const listed = await execute(ctx, 'mobile_list_devices', {})
    expectSuccess(listed)
    expect(listed.value).toMatchObject({
      devices: [{ device_id: 'device-1', detail: 'API 35' }, { device_id: 'device-2', is_available: false }],
    })
    const observed = await execute(ctx, 'mobile_observe', { device_id: 'device-1' })
    expectSuccess(observed)
    expect(observed.value).toMatchObject({
      device: { device_id: 'device-1' }, coordinate_space: 'normalized', screenshot_status: 'skipped',
    })
    expect(selected.observe).toHaveBeenCalledWith(
      { deviceId: 'device-1', captureScreenshot: false }, expect.any(AbortSignal),
    )
  })

  it('executes tap, swipe, type, and button without echoing text', async () => {
    const { ctx, selected } = await harness()
    for (const [name, args] of [
      ['mobile_touch', { ...base, action: 'tap', x: 0, y: 1 }],
      ['mobile_touch', { ...base, action: 'swipe', from_x: 0.1, from_y: 0.2, to_x: 0.8, to_y: 0.9 }],
      ['mobile_type', { ...base, text: 'typed secret' }],
      ['mobile_button', { ...base, button: 'home' }],
    ] as const) {
      const result = await execute(ctx, name, args)
      expectSuccess(result)
      expect(result.value).toMatchObject({ device_id: 'device-1', requires_fresh_observe: true })
      expect(JSON.stringify(result.content)).not.toContain('typed secret')
      const content = result.content[0]
      expect(content?.type).toBe('text')
      if (content?.type !== 'text') throw new Error('expected text result')
      expect(content.text).toContain('mobile_observe')
    }
    expect(selected.touch).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'tap', x: 0, y: 1 }), expect.any(AbortSignal))
    expect(selected.touch).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'swipe', toX: 0.8 }), expect.any(AbortSignal))
    expect(selected.typeText).toHaveBeenCalledWith(expect.objectContaining({ text: 'typed secret' }), expect.any(AbortSignal))
    expect(selected.pressButton).toHaveBeenCalledWith(expect.objectContaining({ button: 'home' }), expect.any(AbortSignal))
  })

  it('admits PNG only for the exact routed image-capable provider and model', async () => {
    const { ctx, selected, attachments } = await harness()
    const resolveModelInfo = vi.fn()
      .mockResolvedValueOnce({ provider: 'header-provider', id: 'header-model', name: 'Vision', inputModalities: ['image'] })
      .mockRejectedValueOnce(new Error('route unavailable'))
      .mockResolvedValueOnce({ provider: 'provider', id: 'model', name: 'Text' })
    ctx.provide('llm', { resolveModelInfo } as never)

    const image = await execute(
      ctx,
      'mobile_observe',
      { device_id: 'device-1' },
      routedAgent({ provider: 'header-provider', model: 'header-model' }, { provider: 'fallback', model: 'fallback' }),
    )
    expectSuccess(image)
    expect(resolveModelInfo).toHaveBeenNthCalledWith(1, 'header-provider', 'header-model', expect.any(AbortSignal))
    expect(selected.observe).toHaveBeenLastCalledWith(expect.objectContaining({ captureScreenshot: true }), expect.any(AbortSignal))
    expect(image.value).toMatchObject({ image: { attachmentId: 'sha256:image', mediaType: 'image/png' } })
    expect(attachments.saveImage).toHaveBeenCalledOnce()

    for (const selectedAgent of [
      routedAgent(undefined, { provider: 'provider', model: 'model' }),
      routedAgent(undefined, { model: 'model' }),
      routedAgent(undefined, { provider: 'provider' }),
      routedAgent(undefined, { provider: 'provider', model: 'model' }),
    ]) {
      const result = await execute(ctx, 'mobile_observe', { device_id: 'device-1' }, selectedAgent)
      expectSuccess(result)
      expect(selected.observe).toHaveBeenLastCalledWith(expect.objectContaining({ captureScreenshot: false }), expect.any(AbortSignal))
    }

    const unsupported = attachmentStore()
    unsupported.imageLimits.mediaTypes = []
    const noPng = await harness({}, provider(), unsupported)
    noPng.ctx.provide('llm', { resolveModelInfo: vi.fn() } as never)
    const result = await execute(
      noPng.ctx, 'mobile_observe', { device_id: 'device-1' },
      routedAgent(undefined, { provider: 'provider', model: 'model' }),
    )
    expectSuccess(result)
    expect(noPng.selected.observe).toHaveBeenCalledWith(expect.objectContaining({ captureScreenshot: false }), expect.any(AbortSignal))
  })

  it('defers nested native image context and reports optional persistence failures', async () => {
    const attachments = attachmentStore()
    attachments.saveImage.mockResolvedValueOnce({
      attachmentId: AttachmentId('sha256:unnamed'), mediaType: 'image/png', bytes: 4, width: 2, height: 1,
    })
    const { ctx } = await harness({}, provider(), attachments)
    ctx.provide('llm', { resolveModelInfo: () => Promise.resolve({
      provider: 'provider', id: 'model', name: 'Vision', inputModalities: ['image'],
    }) } as never)
    const deferred: UserMessage[] = []
    const definition = ctx.tools.get('mobile_observe')!
    const value = await definition.execute({ device_id: 'device-1' }, {
      callId: ToolCallId('nested-mobile-observe'),
      rootCallId: ToolCallId('root'),
      token: Symbol('token'),
      name: 'mobile_observe',
      arguments: { device_id: 'device-1' },
      signal: new AbortController().signal,
      agent: routedAgent(undefined, { provider: 'provider', model: 'model' }),
      parent: Symbol('parent'),
      deferContext: (message: UserMessage) => { deferred.push(message) },
      concludeTurn: () => {},
    } as unknown as ToolRunContext)
    expect(value).toMatchObject({ image: { attachmentId: 'sha256:unnamed' } })
    expect(deferred).toMatchObject([{
      role: 'user', source: { kind: 'plugin', plugin: 'tool-mobile-device' },
      content: [{ type: 'text' }, { type: 'image', attachment: { attachmentId: 'sha256:unnamed' } }],
    }])

    attachments.saveImage.mockRejectedValueOnce(new Error('store unavailable'))
    const failed = await execute(
      ctx, 'mobile_observe', { device_id: 'device-1' },
      routedAgent(undefined, { provider: 'provider', model: 'model' }),
    )
    expectSuccess(failed)
    expect(failed.value).toMatchObject({ image_error: 'store unavailable' })

    attachments.saveImage.mockRejectedValueOnce('string failure')
    const stringFailure = await execute(
      ctx, 'mobile_observe', { device_id: 'device-1' },
      routedAgent(undefined, { provider: 'provider', model: 'model' }),
    )
    expectSuccess(stringFailure)
    expect(stringFailure.value).toMatchObject({ image_error: 'string failure' })
  })

  it.each([
    ['mobile_observe', { device_id: '' }],
    ['mobile_observe', { device_id: ' device ' }],
    ['mobile_touch', { ...base, action: 'tap', x: -0.1, y: 0.5 }],
    ['mobile_touch', { ...base, action: 'tap', x: 0.5, y: 1.1 }],
    ['mobile_touch', { ...base, action: 'tap', x: 0.5 }],
    ['mobile_touch', { ...base, action: 'tap', x: 0.5, y: 0.5, from_x: 0 }],
    ['mobile_touch', { ...base, action: 'swipe', from_x: 0, from_y: 0, to_x: 1 }],
    ['mobile_touch', { ...base, action: 'swipe', from_x: 0, from_y: 0, to_x: 1, to_y: 1, x: 0 }],
    ['mobile_type', { ...base, text: 'toolong' }],
    ['mobile_button', { ...base, button: '' }],
    ['mobile_button', { ...base, button: ' home ' }],
  ])('rejects invalid model input for %s', async (name, args) => {
    const { ctx } = await harness({ maxTextChars: 3 })
    const result = await execute(ctx, name, args)
    expect(result.isError).toBe(true)
  })

  it('renders empty device lists and failed screenshot state', async () => {
    const selected = provider()
    vi.mocked(selected.listDevices).mockResolvedValueOnce([])
    vi.mocked(selected.observe).mockResolvedValueOnce({
      ...observation(),
      tree: '',
      screenshotStatus: { state: 'failed', code: 'capture_failed', message: 'unavailable' },
    })
    const { ctx } = await harness({}, selected)
    const listed = await execute(ctx, 'mobile_list_devices', {})
    expectSuccess(listed)
    expect(listed.content).toEqual([{ type: 'text', text: 'No mobile devices are available.' }])
    const observed = await execute(ctx, 'mobile_observe', { device_id: 'device-1' })
    expectSuccess(observed)
    const content = observed.content[0]
    expect(content?.type).toBe('text')
    if (content?.type !== 'text') throw new Error('expected text result')
    expect(content.text).toContain('Screenshot: failed (capture_failed: unavailable)')
    expect(content.text).toContain('(empty device tree)')
  })
})
