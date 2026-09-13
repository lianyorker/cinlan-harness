/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
/* oxlint-disable typescript/unbound-method -- Mock assertions inspect functions without invoking their receiver. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import BrowserRuntime, {
  BrowserElementId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type { BrowserProvider } from '@deepseek-ai/dsh-browser'
import type {
  BrowserClickRequest,
  BrowserNavigateRequest,
  BrowserScreenshotRequest,
  BrowserSnapshotRequest,
} from '@deepseek-ai/dsh-browser'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ToolBrowser from '../src/index.ts'
import {
  BROWSER_SYSTEM_PROMPT,
  resolveBrowserToolConfig,
} from '../src/index.ts'

const contexts: Context[] = []
let call = 0

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function provider(): BrowserProvider {
  const pageId = BrowserPageId('page-1')
  const observationId = BrowserObservationId('observation-1')
  const elementId = BrowserElementId('e1')
  return {
    id: 'test',
    available: () => true,
    listPages: vi.fn(() => Promise.resolve([
      { pageId, index: 0, url: 'https://example.com', title: 'Example', active: true },
      { pageId: BrowserPageId('page-2'), index: 1, url: 'about:blank', title: '', active: false },
    ])),
    openPage: vi.fn(() => Promise.resolve({ pageId })),
    navigate: vi.fn((request: BrowserNavigateRequest) => Promise.resolve({ pageId: request.pageId, url: request.url, title: 'Destination' })),
    snapshot: vi.fn((request: BrowserSnapshotRequest) => Promise.resolve({
      observationId,
      pageId: request.pageId,
      url: 'https://example.com',
      title: 'Example',
      tree: 'button "Continue" [ref=e1]',
      elements: [{ elementId, role: 'button', name: 'Continue' }],
    })),
    click: vi.fn((request: BrowserClickRequest) => Promise.resolve(request)),
    screenshot: vi.fn((request: BrowserScreenshotRequest) => Promise.resolve({
      pageId: request.pageId,
      format: request.format,
      mediaType: request.format === 'png' ? 'image/png' as const : 'image/jpeg' as const,
      data: Uint8Array.of(1, 2, 3),
    })),
    closePage: vi.fn(() => Promise.resolve()),
  }
}

function attachmentStore(name: string | undefined = 'browser-screenshot.png') {
  return {
    imageLimits: {
      maxImageBytes: 1024,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 4096,
      maxImagePixels: 1_000_000,
      mediaTypes: ['image/png', 'image/jpeg'],
    },
    validateImage: vi.fn(() => Promise.resolve()),
    saveImage: vi.fn((): Promise<ImageAttachmentRef> => Promise.resolve({
      attachmentId: AttachmentId('sha256:image'),
      mediaType: 'image/png' as const,
      bytes: 3,
      width: 2,
      height: 1,
      ...name === undefined ? {} : { name },
    })),
    readImage: vi.fn(() => Promise.reject(new Error('unused'))),
  }
}

async function harness(
  config: ToolBrowser.Config = {},
  selected = provider(),
  attachments = attachmentStore(),
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(BrowserRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('attachments', attachments as never)
  ctx.browser.registerProvider(selected)
  const fiber = await ctx.plugin(ToolBrowser, config)
  return { ctx, fiber, selected, attachments }
}

function agent(header?: { provider?: string; model?: string }, options: { provider?: string; model?: string } = {}): Agent {
  return {
    options,
    session: { requestHeader: () => header === undefined ? undefined : { config: header } },
  } as unknown as Agent
}

async function execute(ctx: Context, name: string, args: unknown, selectedAgent?: Agent): Promise<ToolExecutionResult> {
  call += 1
  return ctx.tools.execute({
    callId: ToolCallId(`browser-${call}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...selectedAgent === undefined ? {} : { agent: selectedAgent },
  })
}

function expectSuccess(result: ToolExecutionResult): asserts result is Extract<ToolExecutionResult, { isError: false }> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful tool result')
}

describe('browser tool configuration and registration', () => {
  it('defaults and validates timeout and screenshot encoding', () => {
    expect(resolveBrowserToolConfig()).toEqual({ timeoutMs: 60_000, screenshotFormat: 'png', historyLimit: 20, networkLimit: 50, maxFileBytes: 4 * 1024 * 1024 })
    expect(resolveBrowserToolConfig({ timeoutMs: 25, screenshotFormat: 'jpeg' })).toEqual({
      timeoutMs: 25, screenshotFormat: 'jpeg', historyLimit: 20, networkLimit: 50, maxFileBytes: 4 * 1024 * 1024,
    })
    expect(() => resolveBrowserToolConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    for (const timeoutMs of [0, 1.5, Number.MAX_SAFE_INTEGER + 1, 2_147_483_648]) {
      expect(() => resolveBrowserToolConfig({ timeoutMs })).toThrow(/positive safe integer/)
    }
    expect(() => resolveBrowserToolConfig({ screenshotFormat: 'webp' as never })).toThrow(/png.*jpeg/)
  })

  it('registers stable schemas, prompt guidance, timeout metadata, and HMR cleanup', async () => {
    const { ctx, fiber } = await harness({ timeoutMs: 321 })
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'browser_list',
      'browser_open',
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_screenshot',
      'browser_home',
      'browser_search',
      'browser_history',
      'browser_back',
      'browser_forward',
      'browser_network',
      'browser_upload',
      'browser_downloads',
      'browser_save_download',
      'browser_close',
    ])
    expect(ctx.tools.get('browser_list')?.timeoutMs).toBe(321)
    expect(ctx.tools.get('browser_list')?.isConcurrencySafe?.({})).toBe(true)
    expect((await ctx.systemPrompt.assemble()).sections).toContainEqual({
      name: 'tool:browser', text: BROWSER_SYSTEM_PROMPT,
    })
    expect(BROWSER_SYSTEM_PROMPT).toContain('do not control OS windows or desktop applications')

    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:browser')).toBe(false)
  })
})

describe('browser tool model-visible behavior', () => {
  it('executes list, open, navigate, snapshot, click, and close through ctx.browser', async () => {
    const { ctx, selected } = await harness()
    const list = await execute(ctx, 'browser_list', {})
    expectSuccess(list)
    expect(list.value).toMatchObject({ pages: [{ page_id: 'page-1' }, { page_id: 'page-2' }] })
    expect(list.content).toEqual([{ type: 'text', text: [
      '* page-1 Example https://example.com',
      '- page-2 (untitled) about:blank',
    ].join('\n') }])

    const open = await execute(ctx, 'browser_open', { url: 'https://example.com' })
    expectSuccess(open)
    expect(open.content).toEqual([{ type: 'text', text: 'Opened persistent browser page page-1. Run browser_snapshot before interacting.' }])

    const navigate = await execute(ctx, 'browser_navigate', { page_id: 'page-1', url: 'https://example.com/next' })
    expectSuccess(navigate)
    expect(navigate.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Navigated page page-1') })

    const snapshot = await execute(ctx, 'browser_snapshot', { page_id: 'page-1' })
    expectSuccess(snapshot)
    expect(snapshot.value).toMatchObject({ observation_id: 'observation-1', elements: [{ element_id: 'e1' }] })
    expect(snapshot.content).toEqual([{ type: 'text', text: [
      'Observation: observation-1',
      'Page: page-1',
      'Title: Example',
      'URL: https://example.com',
      'button "Continue" [ref=e1]',
    ].join('\n') }])

    const click = await execute(ctx, 'browser_click', {
      page_id: 'page-1', observation_id: 'observation-1', element_id: 'e1',
    })
    expectSuccess(click)
    expect(click.content).toEqual([{ type: 'text', text: 'Clicked e1 on page page-1. Run browser_snapshot before another element action.' }])

    const close = await execute(ctx, 'browser_close', { page_id: 'page-1' })
    expectSuccess(close)
    expect(close.content).toEqual([{ type: 'text', text: 'Closed persistent browser page page-1.' }])

    expect(selected.openPage).toHaveBeenCalledWith({ url: 'https://example.com' }, expect.any(AbortSignal))
    expect(selected.navigate).toHaveBeenCalledWith({ pageId: 'page-1', url: 'https://example.com/next' }, expect.any(AbortSignal))
    expect(selected.snapshot).toHaveBeenCalledWith({ pageId: 'page-1' }, expect.any(AbortSignal))
    expect(selected.click).toHaveBeenCalledWith({ pageId: 'page-1', observationId: 'observation-1', elementId: 'e1' }, expect.any(AbortSignal))
    expect(selected.closePage).toHaveBeenCalledWith({ pageId: 'page-1' }, expect.any(AbortSignal))
  })

  it('renders empty page and accessibility observations explicitly', async () => {
    const selected = provider()
    vi.mocked(selected.listPages).mockResolvedValueOnce([])
    vi.mocked(selected.snapshot).mockResolvedValueOnce({
      observationId: BrowserObservationId('empty-observation'),
      pageId: BrowserPageId('page-1'),
      url: '',
      title: '',
      tree: '',
      elements: [],
    })
    const { ctx } = await harness({}, selected)
    const list = await execute(ctx, 'browser_list', {})
    expectSuccess(list)
    expect(list.content).toEqual([{ type: 'text', text: 'No persistent browser pages are open.' }])
    const snapshot = await execute(ctx, 'browser_snapshot', { page_id: 'page-1' })
    expectSuccess(snapshot)
    expect(snapshot.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('(empty accessibility tree)') })
  })

  it.each([
    ['browser_open', { url: '' }],
    ['browser_open', { url: ' padded ' }],
    ['browser_open', { url: 'not-a-url' }],
    ['browser_open', { url: 'file:///tmp/page.html' }],
    ['browser_navigate', { page_id: '', url: 'https://example.com' }],
    ['browser_snapshot', { page_id: ' page ' }],
    ['browser_click', { page_id: 'page', observation_id: '', element_id: 'e1' }],
    ['browser_click', { page_id: 'page', observation_id: 'observation', element_id: ' e1 ' }],
    ['browser_screenshot', { page_id: '' }],
    ['browser_close', { page_id: ' page ' }],
  ])('rejects invalid model input for %s before provider I/O', async (name, args) => {
    const { ctx, selected } = await harness()
    const result = await execute(ctx, name, args)
    expect(result.isError).toBe(true)
    expect(selected.openPage).not.toHaveBeenCalled()
    expect(selected.navigate).not.toHaveBeenCalled()
    expect(selected.snapshot).not.toHaveBeenCalled()
    expect(selected.click).not.toHaveBeenCalled()
    expect(selected.screenshot).not.toHaveBeenCalled()
    expect(selected.closePage).not.toHaveBeenCalled()
  })
})

describe('browser screenshot attachment path', () => {
  it('persists a screenshot and emits a durable image block for an image-capable routed model', async () => {
    const { ctx, selected, attachments } = await harness()
    const resolveModelInfo = vi.fn(() => Promise.resolve({
      provider: 'vision-provider', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'],
    }))
    ctx.provide('llm', { resolveModelInfo } as never)
    const selectedAgent = agent({ provider: 'vision-provider', model: 'vision-model' })
    const result = await execute(ctx, 'browser_screenshot', { page_id: 'page-1' }, selectedAgent)
    expectSuccess(result)
    expect(result.value).toMatchObject({
      page_id: 'page-1',
      image: { attachmentId: 'sha256:image', mediaType: 'image/png', bytes: 3, width: 2, height: 1 },
    })
    expect(result.content).toEqual([
      { type: 'text', text: 'Viewport screenshot for page page-1: image/png, 2x1 px, 3 bytes.' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'sha256:image', mediaType: 'image/png', bytes: 3, width: 2, height: 1,
          name: 'browser-screenshot.png',
        },
      },
    ])
    expect(resolveModelInfo).toHaveBeenCalledWith('vision-provider', 'vision-model', expect.any(AbortSignal))
    expect(selected.screenshot).toHaveBeenCalledWith({ pageId: 'page-1', format: 'png' }, expect.any(AbortSignal))
    expect(attachments.saveImage).toHaveBeenCalledWith({
      data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', name: 'browser-screenshot.png',
    })
  })

  it('supports JPEG and nested dispatch context without requiring a stored display name', async () => {
    const selected = provider()
    const attachments = attachmentStore(undefined)
    vi.mocked(attachments.saveImage).mockResolvedValueOnce({
      attachmentId: AttachmentId('sha256:jpeg'), mediaType: 'image/jpeg', bytes: 3, width: 3, height: 1,
    })
    const { ctx } = await harness({ screenshotFormat: 'jpeg' }, selected, attachments)
    ctx.provide('llm', { resolveModelInfo: () => Promise.resolve({
      provider: 'vision-provider', id: 'vision-model', name: 'Vision', inputModalities: ['image'],
    }) } as never)
    const deferred: unknown[] = []
    const definition = ctx.tools.get('browser_screenshot')!
    const value = await definition.execute({ page_id: 'page-1' }, {
      callId: ToolCallId('nested-screenshot'),
      name: 'browser_screenshot',
      arguments: { page_id: 'page-1' },
      signal: new AbortController().signal,
      agent: agent(undefined, { provider: 'vision-provider', model: 'vision-model' }),
      parent: {} as ToolRunContext,
      deferContext: (message: UserMessage) => { deferred.push(message) },
    } as unknown as ToolRunContext)
    expect(value).toMatchObject({ page_id: 'page-1', image: { mediaType: 'image/jpeg' } })
    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toMatchObject({
      role: 'user',
      source: { kind: 'plugin', plugin: 'tool-browser' },
      content: [{ type: 'text' }, { type: 'image', attachment: { attachmentId: 'sha256:jpeg' } }],
    })
    expect(selected.screenshot).toHaveBeenCalledWith({ pageId: 'page-1', format: 'jpeg' }, expect.any(AbortSignal))
    expect(attachments.saveImage).toHaveBeenCalledWith(expect.objectContaining({
      mediaType: 'image/jpeg', name: 'browser-screenshot.jpg',
    }))
  })

  it('fails before browser I/O when attachment or model route cannot carry the image', async () => {
    const unsupported = attachmentStore()
    unsupported.imageLimits.mediaTypes = []
    const first = await harness({}, provider(), unsupported)
    const unsupportedResult = await execute(first.ctx, 'browser_screenshot', { page_id: 'page-1' })
    expect(unsupportedResult.isError).toBe(true)
    expect(first.selected.screenshot).not.toHaveBeenCalled()

    const missingRoute = await harness()
    const missingResult = await execute(missingRoute.ctx, 'browser_screenshot', { page_id: 'page-1' })
    expect(missingResult.isError).toBe(true)
    expect(missingRoute.selected.screenshot).not.toHaveBeenCalled()

    const missingLlm = await harness()
    const noLlmResult = await execute(
      missingLlm.ctx,
      'browser_screenshot',
      { page_id: 'page-1' },
      agent(undefined, { provider: 'provider', model: 'model' }),
    )
    expect(noLlmResult.isError).toBe(true)

    for (const inputModalities of [undefined, ['text']] as const) {
      const route = await harness()
      route.ctx.provide('llm', { resolveModelInfo: () => Promise.resolve({
        provider: 'provider', id: 'model', name: 'Model',
        ...inputModalities === undefined ? {} : { inputModalities },
      }) } as never)
      const result = await execute(
        route.ctx,
        'browser_screenshot',
        { page_id: 'page-1' },
        agent(undefined, { provider: 'provider', model: 'model' }),
      )
      expect(result.isError).toBe(true)
      expect(route.selected.screenshot).not.toHaveBeenCalled()
    }
  })
})

describe('browser tool render intent', () => {
  it('declares a generic intent for every command and falls back for replay-invalid args', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.get('browser_list')?.presentCall?.({})).toEqual({ card: 'generic', title: 'List browser pages', kind: 'read' })
    expect(ctx.tools.get('browser_open')?.presentCall?.({ url: 'https://example.com' })).toEqual({
      card: 'generic', title: 'Open https://example.com', kind: 'fetch', rawInput: 'https://example.com',
    })
    expect(ctx.tools.get('browser_navigate')?.presentCall?.({ page_id: 'page', url: 'https://example.com' })).toEqual({
      card: 'generic', title: 'Navigate page', kind: 'fetch', rawInput: 'https://example.com',
    })
    expect(ctx.tools.get('browser_snapshot')?.presentCall?.({ page_id: 'page' })).toEqual({ card: 'generic', title: 'Snapshot page', kind: 'read' })
    expect(ctx.tools.get('browser_click')?.presentCall?.({ page_id: 'page', observation_id: 'o', element_id: 'e' })).toEqual({
      card: 'generic', title: 'Click e', kind: 'execute',
    })
    expect(ctx.tools.get('browser_screenshot')?.presentCall?.({ page_id: 'page' })).toEqual({ card: 'generic', title: 'Screenshot page', kind: 'read' })
    expect(ctx.tools.get('browser_close')?.presentCall?.({ page_id: 'page' })).toEqual({ card: 'generic', title: 'Close page', kind: 'delete' })
    expect(ctx.tools.get('browser_open')?.presentCall?.({})).toBeUndefined()
  })
})
