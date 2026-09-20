/* oxlint-disable typescript/unbound-method -- Mock assertions inspect functions without invoking their receiver. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import ComputerUseRuntime, {
  ComputerAppId,
  ComputerElementId,
  ComputerObservationId,
  ComputerUseError,
  ComputerUseProviderName,
  ComputerUseRegistry,
  ComputerWindowId,
} from '../src/index.ts'
import type {
  ComputerActionResult,
  ComputerCapabilities,
  ComputerObservation,
  ComputerUseProvider,
} from '../src/index.ts'

function observation(): ComputerObservation {
  return {
    observationId: ComputerObservationId('observation'),
    app: {
      appId: ComputerAppId('app'), name: 'App', bundleId: 'app', pid: 1,
      running: true, lastUsedAt: null, useCount: null,
    },
    window: {
      windowId: ComputerWindowId('id:2'), appId: ComputerAppId('app'), title: 'Window',
      x: 0, y: 0, width: 100, height: 80, minimized: false, offscreen: false,
      screenIndex: 0, main: true,
    },
    coordinateSpace: 'window',
    tree: '0 button Continue',
    elements: [{ elementId: ComputerElementId('0'), index: 0 }],
    focusedElementId: null,
    screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' },
  }
}

function provider(id: string, usable = true): ComputerUseProvider {
  const value = observation()
  const action: ComputerActionResult = { observation: value }
  const capabilities: ComputerCapabilities = {
    platform: 'win32', provider: id, providerVersion: '1', protocolVersion: 1,
    supports: {
      apps: { list: true, bundleIds: true, pids: true },
      windows: { list: true, targetById: true, targetByIndex: true, focus: true, moveResize: false },
      observation: { screenshot: true, annotatedScreenshot: false, elementFrames: true, ocr: false },
      actions: {
        click: true, typeText: true, pressKey: true, hotkey: true, pasteText: true,
        scroll: true, drag: true, setValue: true, performAction: true,
      },
      surfaces: { menus: true, dialogs: true, dock: false, menubar: false },
    },
  }
  return {
    id,
    available: vi.fn(() => usable),
    capabilities: vi.fn(() => Promise.resolve(capabilities)),
    listApps: vi.fn(() => Promise.resolve([value.app])),
    listWindows: vi.fn(() => Promise.resolve([value.window])),
    observe: vi.fn(() => Promise.resolve(value)),
    click: vi.fn(() => Promise.resolve(action)),
    performSecondaryAction: vi.fn(() => Promise.resolve(action)),
    scroll: vi.fn(() => Promise.resolve(action)),
    drag: vi.fn(() => Promise.resolve(action)),
    typeText: vi.fn(() => Promise.resolve(action)),
    pressKey: vi.fn(() => Promise.resolve(action)),
    hotkey: vi.fn(() => Promise.resolve(action)),
    pasteText: vi.fn(() => Promise.resolve(action)),
    setValue: vi.fn(() => Promise.resolve(action)),
  }
}

async function mount(config: ConstructorParameters<typeof ComputerUseRuntime>[1] = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(ComputerUseRuntime, config)
  return { ctx, fiber }
}

describe('ComputerUseRuntime', () => {
  it('preserves the runtime class and prevents mixing exclusive tools with facade providers', async () => {
    expect(ComputerUseRegistry).toBe(ComputerUseRuntime)
    const { ctx, fiber } = await mount()
    try {
      const removeOffline = ctx.computerUse.registerProvider(provider('cinlan', false))
      expect(() => ctx.computerUse.register(ComputerUseProviderName('native'))).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_EXCLUSIVE' }))
      removeOffline()
      const release = ctx.computerUse.register(ComputerUseProviderName('native'))
      expect(ctx.computerUse.providerName).toBe('native')
      expect(() => ctx.computerUse.registerProvider(provider('cinlan'))).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_EXCLUSIVE' }))
      await release()
      const local = provider('cinlan')
      ctx.computerUse.registerProvider(local)
      await expect(ctx.computerUse.listApps()).resolves.toEqual([observation().app])
    } finally {
      await fiber.dispose()
    }
  })

  it('brands opaque ids and exposes typed failures', () => {
    expect(ComputerAppId('app')).toBe('app')
    expect(ComputerWindowId('window')).toBe('window')
    expect(ComputerObservationId('observation')).toBe('observation')
    expect(ComputerElementId('element')).toBe('element')
    expect(new ComputerUseError('failed', 'COMPUTER_TEST')).toMatchObject({
      name: 'ComputerUseError', message: 'failed', code: 'COMPUTER_TEST',
    })
  })

  it('validates configuration and provider registrations', async () => {
    expect(() => new ComputerUseRuntime(new Context(), { provider: '' })).toThrow(/provider must be/)
    expect(() => new ComputerUseRuntime(new Context(), { provider: ' cinlan' })).toThrow(/provider must be/)
    expect(() => new ComputerUseRuntime(new Context(), { extra: true } as never)).toThrow(/unsupported config key/)
    const { ctx, fiber } = await mount()
    expect(() => ctx.computerUse.registerProvider(provider(''))).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_ID_INVALID' }))
    expect(() => ctx.computerUse.registerProvider(provider(' spaced '))).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_ID_INVALID' }))
    const unregister = ctx.computerUse.registerProvider(provider('one'))
    expect(() => ctx.computerUse.registerProvider(provider('one'))).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_DUPLICATE' }))
    unregister()
    expect(() => ctx.computerUse.listApps()).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_UNAVAILABLE' }))
    await fiber.dispose()
  })

  it('selects one usable provider and delegates every operation with the signal', async () => {
    const { ctx, fiber } = await mount()
    const selected = provider('cinlan')
    ctx.computerUse.registerProvider(provider('offline', false))
    ctx.computerUse.registerProvider(selected)
    const signal = new AbortController().signal
    const base = {
      appId: ComputerAppId('app'),
      windowId: ComputerWindowId('id:2'),
      observationId: ComputerObservationId('observation'),
    }
    await ctx.computerUse.capabilities(signal)
    await ctx.computerUse.listApps(signal)
    await ctx.computerUse.listWindows({ appId: base.appId }, signal)
    await ctx.computerUse.observe({ appId: base.appId }, signal)
    await ctx.computerUse.click({ ...base, target: { kind: 'element', elementId: ComputerElementId('0') } }, signal)
    await ctx.computerUse.performSecondaryAction({ ...base, elementId: ComputerElementId('0'), action: 'Press' }, signal)
    await ctx.computerUse.scroll({ ...base, target: { kind: 'point', x: 1, y: 2 }, direction: 'down' }, signal)
    await ctx.computerUse.drag({
      ...base,
      target: { kind: 'elements', fromElementId: ComputerElementId('0'), toElementId: ComputerElementId('1') },
    }, signal)
    await ctx.computerUse.typeText({ ...base, text: 'text' }, signal)
    await ctx.computerUse.pressKey({ ...base, key: 'Return' }, signal)
    await ctx.computerUse.hotkey({ ...base, key: 'CmdOrCtrl+A' }, signal)
    await ctx.computerUse.pasteText({ ...base, text: 'paste' }, signal)
    await ctx.computerUse.setValue({ ...base, elementId: ComputerElementId('0'), value: 'value' }, signal)
    for (const method of [
      selected.listWindows, selected.observe, selected.click,
      selected.performSecondaryAction, selected.scroll, selected.drag, selected.typeText,
      selected.pressKey, selected.hotkey, selected.pasteText, selected.setValue,
    ]) expect(method).toHaveBeenCalledWith(expect.anything(), signal)
    expect(selected.capabilities).toHaveBeenCalledWith(signal)
    expect(selected.listApps).toHaveBeenCalledWith(signal)
    await fiber.dispose()
  })

  it('fails deterministically for absent, ambiguous, configured-missing, and configured-offline providers', async () => {
    const empty = await mount()
    expect(() => empty.ctx.computerUse.listApps()).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_UNAVAILABLE' }))
    empty.ctx.computerUse.registerProvider(provider('one'))
    empty.ctx.computerUse.registerProvider(provider('two'))
    expect(() => empty.ctx.computerUse.listApps()).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_AMBIGUOUS' }))
    await empty.fiber.dispose()

    const missing = await mount({ provider: 'missing' })
    expect(() => missing.ctx.computerUse.listApps()).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_CONFIGURED_MISSING' }))
    await missing.fiber.dispose()

    const offline = await mount({ provider: 'offline' })
    offline.ctx.computerUse.registerProvider(provider('offline', false))
    expect(() => offline.ctx.computerUse.listApps()).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    await offline.fiber.dispose()
  })
})
