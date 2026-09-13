/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
/* oxlint-disable typescript/unbound-method -- Mock assertions inspect functions without invoking their receiver. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import BrowserRuntime, {
  BrowserElementId,
  BrowserElementSelectionId,
  BrowserError,
  BrowserObservationId,
  BrowserPageId,
} from '../src/index.ts'
import type {
  BrowserClickRequest,
  BrowserElementCaptureRequest,
  BrowserElementCaptureProvider,
  BrowserElementScreenshot,
  BrowserNavigateRequest,
  BrowserProvider,
  BrowserScreenshot,
  BrowserSnapshotRequest,
} from '../src/index.ts'

function provider(id: string, usable = true): BrowserProvider {
  const pageId = BrowserPageId(`${id}-page`)
  const observationId = BrowserObservationId(`${id}-observation`)
  const elementId = BrowserElementId(`${id}-element`)
  const screenshot: BrowserScreenshot = {
    pageId,
    format: 'png',
    mediaType: 'image/png',
    data: Uint8Array.of(1, 2, 3),
  }
  return {
    id,
    available: vi.fn(() => usable),
    listPages: vi.fn(() => Promise.resolve([{ pageId, index: 0, url: 'https://example.com', title: id, active: true }])),
    openPage: vi.fn(() => Promise.resolve({ pageId })),
    navigate: vi.fn((request: BrowserNavigateRequest) => Promise.resolve({ pageId: request.pageId, url: request.url, title: id })),
    snapshot: vi.fn((request: BrowserSnapshotRequest) => Promise.resolve({
      observationId,
      pageId: request.pageId,
      url: 'https://example.com',
      title: id,
      tree: 'button "Continue" [ref=e1]',
      elements: [{ elementId, role: 'button', name: 'Continue' }],
    })),
    click: vi.fn((request: BrowserClickRequest) => Promise.resolve(request)),
    screenshot: vi.fn(() => Promise.resolve(screenshot)),
    closePage: vi.fn(() => Promise.resolve()),
  }
}

function captureProvider(id: string): BrowserElementCaptureProvider {
  const base = provider(id)
  const pageId = BrowserPageId(`${id}-page`)
  const selectionId = BrowserElementSelectionId(`${id}-selection`)
  return {
    ...base,
    selectElement: vi.fn(() => Promise.resolve({
      selectionId,
      pageId,
      tagName: 'button',
      role: 'button',
      name: 'Continue',
      text: 'Continue',
      rect: { x: 1, y: 2, width: 30, height: 40 },
    })),
    captureElement: vi.fn((request: BrowserElementCaptureRequest): Promise<BrowserElementScreenshot> => Promise.resolve({
      pageId: request.pageId,
      format: request.format,
      mediaType: request.format === 'png' ? 'image/png' : 'image/jpeg',
      data: Uint8Array.of(4, 5, 6),
      target: request.target,
      rect: { x: 1, y: 2, width: 30, height: 40 },
      viewport: { width: 800, height: 600 },
      verified: true as const,
      tagName: 'button',
      role: 'button',
      name: 'Continue',
    })),
  }
}

async function mount(config: ConstructorParameters<typeof BrowserRuntime>[1] = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(BrowserRuntime, config)
  return { ctx, fiber }
}

describe('BrowserRuntime', () => {
  it('brands provider-issued ids without changing their wire values', () => {
    expect(BrowserPageId('page')).toBe('page')
    expect(BrowserObservationId('observation')).toBe('observation')
    expect(BrowserElementId('element')).toBe('element')
    expect(BrowserElementSelectionId('selection')).toBe('selection')
    expect(new BrowserError('failed', 'BROWSER_TEST')).toMatchObject({
      name: 'BrowserError',
      message: 'failed',
      code: 'BROWSER_TEST',
    })
  })

  it('validates direct configuration and provider ids', async () => {
    const invalid = new Context()
    expect(() => new BrowserRuntime(invalid, { provider: '' })).toThrow(/provider must be/)
    expect(() => new BrowserRuntime(new Context(), { provider: ' cinlan' })).toThrow(/provider must be/)
    expect(() => new BrowserRuntime(new Context(), { extra: true } as never)).toThrow(/unsupported config key 'extra'/)

    const { ctx, fiber } = await mount()
    expect(() => ctx.browser.registerProvider(provider('')))
      .toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_ID_INVALID' }))
    expect(() => ctx.browser.registerProvider(provider(' spaced ')))
      .toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_ID_INVALID' }))
    await fiber.dispose()
    await invalid.fiber.dispose()
  })

  it('delegates every operation to the sole usable provider with the caller signal', async () => {
    const { ctx, fiber } = await mount()
    const selected = provider('cinlan')
    const ignored = provider('offline', false)
    ctx.browser.registerProvider(ignored)
    ctx.browser.registerProvider(selected)
    const signal = new AbortController().signal
    const pageId = BrowserPageId('cinlan-page')
    const observationId = BrowserObservationId('cinlan-observation')
    const elementId = BrowserElementId('cinlan-element')

    await expect(ctx.browser.listPages(signal)).resolves.toHaveLength(1)
    await expect(ctx.browser.openPage({ url: 'https://example.com' }, signal)).resolves.toEqual({ pageId })
    await expect(ctx.browser.navigate({ pageId, url: 'https://example.com/next' }, signal))
      .resolves.toMatchObject({ pageId, url: 'https://example.com/next' })
    await expect(ctx.browser.snapshot({ pageId }, signal)).resolves.toMatchObject({ observationId, pageId })
    await expect(ctx.browser.click({ pageId, observationId, elementId }, signal))
      .resolves.toEqual({ pageId, observationId, elementId })
    await expect(ctx.browser.screenshot({ pageId, format: 'png' }, signal))
      .resolves.toMatchObject({ pageId, format: 'png' })
    await expect(ctx.browser.closePage({ pageId }, signal)).resolves.toBeUndefined()

    expect(selected.listPages).toHaveBeenCalledWith(signal)
    expect(selected.openPage).toHaveBeenCalledWith({ url: 'https://example.com' }, signal)
    expect(selected.navigate).toHaveBeenCalledWith({ pageId, url: 'https://example.com/next' }, signal)
    expect(selected.snapshot).toHaveBeenCalledWith({ pageId }, signal)
    expect(selected.click).toHaveBeenCalledWith({ pageId, observationId, elementId }, signal)
    expect(selected.screenshot).toHaveBeenCalledWith({ pageId, format: 'png' }, signal)
    expect(selected.closePage).toHaveBeenCalledWith({ pageId }, signal)
    expect(ignored.listPages).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('delegates element selection and capture only through the complete Provider extension', async () => {
    const { ctx, fiber } = await mount()
    const selected = captureProvider('playwright')
    ctx.browser.registerProvider(selected)
    const signal = new AbortController().signal
    const pageId = BrowserPageId('playwright-page')
    const observationId = BrowserObservationId('playwright-observation')
    const elementId = BrowserElementId('playwright-element')

    await expect(ctx.browser.selectElement({ pageId }, signal)).resolves.toMatchObject({
      pageId,
      selectionId: 'playwright-selection',
    })
    await expect(ctx.browser.captureElement({
      pageId,
      target: { kind: 'observation', observationId, elementId },
      format: 'png',
    }, signal)).resolves.toMatchObject({ pageId, verified: true, data: Uint8Array.of(4, 5, 6) })

    expect(selected.selectElement).toHaveBeenCalledWith({ pageId }, signal)
    expect(selected.captureElement).toHaveBeenCalledWith({
      pageId,
      target: { kind: 'observation', observationId, elementId },
      format: 'png',
    }, signal)
    await fiber.dispose()
  })

  it('rejects element operations when the selected Provider lacks either extension method', async () => {
    const base = await mount()
    const plain = provider('cinlan')
    base.ctx.browser.registerProvider(plain)
    await expect(base.ctx.browser.selectElement({ pageId: BrowserPageId('cinlan-page') }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_FEATURE_UNSUPPORTED' }))
    await expect(base.ctx.browser.captureElement({
      pageId: BrowserPageId('cinlan-page'),
      target: { kind: 'selection', selectionId: BrowserElementSelectionId('selection') },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_FEATURE_UNSUPPORTED' }))
    expect(plain.screenshot).not.toHaveBeenCalled()
    await base.fiber.dispose()

    const partial = await mount()
    partial.ctx.browser.registerProvider({ ...provider('partial'), selectElement: vi.fn() } as never)
    await expect(partial.ctx.browser.selectElement({ pageId: BrowserPageId('partial-page') }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_FEATURE_UNSUPPORTED' }))
    await partial.fiber.dispose()
  })

  it('reports every provider-selection failure deterministically', async () => {
    const empty = await mount()
    await expect(empty.ctx.browser.listPages()).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_PROVIDER_UNAVAILABLE',
    }))
    await empty.fiber.dispose()

    const ambiguous = await mount()
    ambiguous.ctx.browser.registerProvider(provider('alpha'))
    ambiguous.ctx.browser.registerProvider(provider('beta'))
    await expect(ambiguous.ctx.browser.listPages()).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_PROVIDER_AMBIGUOUS',
      message: expect.stringContaining('alpha, beta'),
    }))
    await ambiguous.fiber.dispose()

    const missing = await mount({ provider: 'cinlan' })
    await expect(missing.ctx.browser.listPages()).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_PROVIDER_CONFIGURED_MISSING',
    }))
    await missing.fiber.dispose()

    const unavailable = await mount({ provider: 'cinlan' })
    unavailable.ctx.browser.registerProvider(provider('cinlan', false))
    await expect(unavailable.ctx.browser.listPages()).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE',
    }))
    await unavailable.fiber.dispose()

    const configured = await mount({ provider: 'cinlan' })
    configured.ctx.browser.registerProvider(provider('other'))
    configured.ctx.browser.registerProvider(provider('cinlan'))
    await expect(configured.ctx.browser.listPages()).resolves.toMatchObject([{ title: 'cinlan' }])
    await configured.fiber.dispose()
  })

  it('rejects duplicate ids and releases returned and fiber-owned registrations', async () => {
    const { ctx, fiber } = await mount()
    const first = provider('cinlan')
    const dispose = ctx.browser.registerProvider(first)
    expect(() => ctx.browser.registerProvider(provider('cinlan')))
      .toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_DUPLICATE' }))
    dispose()
    await expect(ctx.browser.listPages()).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_PROVIDER_UNAVAILABLE',
    }))

    const contribution = await ctx.plugin({
      name: 'test-browser-provider',
      inject: ['browser'],
      apply(inner: Context) {
        inner.browser.registerProvider(first)
      },
    })
    await expect(ctx.browser.listPages()).resolves.toHaveLength(1)
    await contribution.dispose()
    await expect(ctx.browser.listPages()).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_PROVIDER_UNAVAILABLE',
    }))
    await fiber.dispose()
  })
})
