/* oxlint-disable typescript/no-unsafe-return -- Provider mocks intentionally echo typed request values. */
/* oxlint-disable typescript/unbound-method -- Vitest inspects mock methods without invoking their receiver. */
import { Context } from '@deepseek-ai/cordis'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import BrowserRuntime, {
  BrowserElementId,
  BrowserElementSelectionId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type { BrowserElementCaptureProvider, BrowserElementScreenshot } from '@deepseek-ai/dsh-browser'
import CoordinationLocal from '@deepseek-ai/dsh-coordination-local'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Executor from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

function provider(): BrowserElementCaptureProvider {
  const pageId = BrowserPageId('page-1')
  const observationId = BrowserObservationId('observation-1')
  const elementId = BrowserElementId('e1')
  const capture: BrowserElementScreenshot = {
    pageId,
    format: 'png',
    mediaType: 'image/png',
    data: Uint8Array.of(1, 2, 3),
    target: { kind: 'observation', observationId, elementId },
    rect: { x: 1, y: 2, width: 30, height: 40 },
    viewport: { width: 800, height: 600 },
    verified: true,
    tagName: 'button',
    role: 'button',
    name: 'Continue',
  }
  return {
    id: 'fixture',
    available: () => true,
    listPages: vi.fn(async () => []),
    openPage: vi.fn(async () => ({ pageId })),
    navigate: vi.fn(async () => ({ pageId, url: 'https://example.com', title: 'Example' })),
    snapshot: vi.fn(async () => ({
      observationId, pageId, url: 'https://example.com', title: 'Example', tree: '',
      elements: [{ elementId, role: 'button', name: 'Continue' }],
    })),
    click: vi.fn(async request => request),
    screenshot: vi.fn(async () => ({
      pageId, format: 'png' as const, mediaType: 'image/png' as const, data: Uint8Array.of(1),
    })),
    closePage: vi.fn(async () => {}),
    selectElement: vi.fn(async () => ({
      selectionId: BrowserElementSelectionId('selection-1'), pageId, tagName: 'button', role: 'button',
      name: 'Continue', text: 'Continue', rect: capture.rect,
    })),
    captureElement: vi.fn(async () => capture),
  }
}

class FixtureAttachments extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024,
    maxImagesPerMessage: 2,
    maxMessageImageBytes: 2048,
    maxImagePixels: 100_000,
    maxImageDimension: 8192,
    mediaTypes: ['image/png', 'image/jpeg'],
  }
  readonly validateImage = vi.fn(async (_input: SaveImageAttachment) => {})
  readonly saveImage = vi.fn(async (input: SaveImageAttachment): Promise<ImageAttachmentRef> => ({
    attachmentId: AttachmentId('sha256:element'),
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
    width: 30,
    height: 40,
    ...(input.name === undefined ? {} : { name: input.name }),
  }))
  readonly readImage = vi.fn(async () => { throw new Error('unused') })
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    page_id: 'page-1',
    kind: 'observation',
    observation_id: 'observation-1',
    element_id: 'e1',
    format: 'png',
    ...overrides,
  }
}

async function boot(selected = provider()) {
  ctx = new Context()
  await ctx.plugin(BrowserRuntime)
  await ctx.plugin(CoordinationLocal)
  await ctx.plugin(FixtureAttachments)
  const attachments = ctx.attachments
  ctx.browser.registerProvider(selected)
  const fiber = await ctx.plugin(Executor)
  return { selected, attachments, fiber }
}

function start(taskInput: unknown, id = 'task-capture') {
  if (ctx === undefined) throw new Error('test context is not ready')
  return ctx.coordination.start({ tasks: [{
    id: id as never,
    label: 'Capture browser element',
    executor: Executor.BROWSER_ELEMENT_CAPTURE_EXECUTOR,
    input: taskInput,
  }] })
}

describe('coordination browser element capture executor', () => {
  it('validates input, persists the verified image, and returns only attachment metadata', async () => {
    const { selected, attachments } = await boot()
    const run = start(input())
    await run.result
    if (ctx === undefined) throw new Error('test context is not ready')
    const task = ctx.coordination.getTask('task-capture' as never)
    expect(task.status).toBe('succeeded')
    expect(task.output).toEqual({
      attachmentId: 'sha256:element',
      mediaType: 'image/png',
      bytes: 3,
      width: 30,
      height: 40,
      name: 'browser-element.png',
    })
    expect(Object.keys(task.output as object)).toEqual([
      'attachmentId', 'mediaType', 'bytes', 'width', 'height', 'name',
    ])
    expect(selected.captureElement).toHaveBeenCalledWith({
      pageId: 'page-1',
      target: { kind: 'observation', observationId: 'observation-1', elementId: 'e1' },
      format: 'png',
    }, expect.any(AbortSignal))
    expect(attachments.saveImage).toHaveBeenCalledWith({
      data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', name: 'browser-element.png',
    })
  })

  it('accepts a selection target and preserves its requested format', async () => {
    const { selected, attachments } = await boot()
    const run = start({
      page_id: 'page-1', kind: 'selection', selection_id: 'selection-1', format: 'jpeg',
    }, 'task-selection')
    await run.result
    if (ctx === undefined) throw new Error('test context is not ready')
    expect(ctx.coordination.getTask('task-selection' as never)).toMatchObject({ status: 'succeeded' })
    expect(selected.captureElement).toHaveBeenCalledWith({
      pageId: 'page-1', target: { kind: 'selection', selectionId: 'selection-1' }, format: 'jpeg',
    }, expect.any(AbortSignal))
    expect(attachments.saveImage).toHaveBeenCalledWith(expect.objectContaining({
      mediaType: 'image/png', name: 'browser-element.png',
    }))
  })

  it.each([
    ['not-an-object', null],
    ['unsafe JSON', { ...input(), extra: 1n }],
    ['extra field', { ...input(), unexpected: true }],
    ['missing observation id', input({ observation_id: undefined })],
    ['invalid kind', input({ kind: 'other' })],
    ['invalid format', input({ format: 'webp' })],
    ['empty page id', input({ page_id: '' })],
  ])('fails %s before Browser I/O', async (_label, taskInput) => {
    const { selected, attachments } = await boot()
    const run = start(taskInput, `invalid-${String(_label).replaceAll(' ', '-')}`)
    await run.result
    if (ctx === undefined) throw new Error('test context is not ready')
    const task = ctx.coordination.getTask(run.snapshot.taskIds[0]!)
    expect(task.status).toBe('failed')
    expect(selected.captureElement).not.toHaveBeenCalled()
    expect(attachments.saveImage).not.toHaveBeenCalled()
  })

  it('returns cancelled when the Browser operation observes task cancellation', async () => {
    const selected = provider()
    let rejectCapture!: (reason?: unknown) => void
    const capturePending = new Promise<BrowserElementScreenshot>((_resolve, reject) => { rejectCapture = reject })
    vi.mocked(selected.captureElement).mockReturnValueOnce(capturePending)
    await boot(selected)
    const run = start(input(), 'task-cancelled')
    await vi.waitFor(() => { expect(selected.captureElement).toHaveBeenCalledOnce() })
    run.cancel('operator cancelled')
    rejectCapture(new Error('operator cancelled'))
    await expect(run.result).resolves.toMatchObject({ status: 'cancelled' })
    if (ctx === undefined) throw new Error('test context is not ready')
    expect(ctx.coordination.getTask('task-cancelled' as never)).toMatchObject({ status: 'cancelled' })
  })

  it('removes the executor on plugin disposal so later runs fail closed', async () => {
    const { fiber } = await boot()
    await fiber.dispose()
    expect(() => start(input(), 'task-after-dispose')).toThrow(/unavailable/)
  })


})
