/* oxlint-disable typescript/unbound-method -- Mock assertions inspect functions without invoking their receiver. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import MobileDeviceRuntime, {
  MobileDeviceError,
  MobileDeviceGeneration,
  MobileDeviceId,
  MobileObservationId,
} from '../src/index.ts'
import type {
  MobileDeviceProvider,
  MobileMutationResult,
  MobileObservation,
} from '../src/index.ts'

function observation(): MobileObservation {
  return {
    device: {
      backend: 'ios', id: MobileDeviceId('device-1'), name: 'Phone', state: 'booted', isAvailable: true,
    },
    deviceGeneration: MobileDeviceGeneration('generation-1'),
    observationId: MobileObservationId('observation-1'),
    coordinateSpace: 'normalized',
    tree: 'button Continue',
    screenshotStatus: { state: 'skipped' },
  }
}

function provider(id: string, usable = true): MobileDeviceProvider {
  const value = observation()
  const mutation: MobileMutationResult = {
    device: value.device,
    deviceGeneration: value.deviceGeneration,
    observationId: value.observationId,
  }
  return {
    id,
    available: vi.fn(() => usable),
    listDevices: vi.fn(() => Promise.resolve([value.device])),
    observe: vi.fn(() => Promise.resolve(value)),
    touch: vi.fn(() => Promise.resolve(mutation)),
    typeText: vi.fn(() => Promise.resolve(mutation)),
    pressButton: vi.fn(() => Promise.resolve(mutation)),
  }
}

async function mount(config: ConstructorParameters<typeof MobileDeviceRuntime>[1] = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(MobileDeviceRuntime, config)
  return { ctx, fiber }
}

describe('MobileDeviceRuntime', () => {
  it('brands opaque ids and exposes typed failures', () => {
    expect(MobileDeviceId('device')).toBe('device')
    expect(MobileDeviceGeneration('generation')).toBe('generation')
    expect(MobileObservationId('observation')).toBe('observation')
    expect(new MobileDeviceError('failed', 'MOBILE_TEST')).toMatchObject({
      name: 'MobileDeviceError', message: 'failed', code: 'MOBILE_TEST',
    })
  })

  it('validates configuration and Provider registrations', async () => {
    expect(() => new MobileDeviceRuntime(new Context(), { provider: '' })).toThrow(/provider must be/)
    expect(() => new MobileDeviceRuntime(new Context(), { provider: ' cinlan' })).toThrow(/provider must be/)
    expect(() => new MobileDeviceRuntime(new Context(), { extra: true } as never)).toThrow(/unsupported config key/)
    const { ctx, fiber } = await mount()
    expect(() => ctx.mobileDevice.registerProvider(provider(''))).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_ID_INVALID' }))
    expect(() => ctx.mobileDevice.registerProvider(provider(' spaced '))).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_ID_INVALID' }))
    const unregister = ctx.mobileDevice.registerProvider(provider('one'))
    expect(() => ctx.mobileDevice.registerProvider(provider('one'))).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_DUPLICATE' }))
    unregister()
    expect(() => ctx.mobileDevice.listDevices()).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_UNAVAILABLE' }))
    await fiber.dispose()
  })

  it('selects one usable Provider and delegates every operation with the signal', async () => {
    const { ctx, fiber } = await mount()
    const selected = provider('cinlan')
    ctx.mobileDevice.registerProvider(provider('offline', false))
    ctx.mobileDevice.registerProvider(selected)
    const signal = new AbortController().signal
    const base = { deviceId: MobileDeviceId('device-1'), observationId: MobileObservationId('observation-1') }
    await ctx.mobileDevice.listDevices(signal)
    await ctx.mobileDevice.observe({ deviceId: base.deviceId }, signal)
    await ctx.mobileDevice.touch({ ...base, kind: 'tap', x: 0.5, y: 0.25 }, signal)
    await ctx.mobileDevice.typeText({ ...base, text: 'hello' }, signal)
    await ctx.mobileDevice.pressButton({ ...base, button: 'home' }, signal)
    expect(selected.listDevices).toHaveBeenCalledWith(signal)
    for (const method of [selected.observe, selected.touch, selected.typeText, selected.pressButton]) {
      expect(method).toHaveBeenCalledWith(expect.anything(), signal)
    }
    await fiber.dispose()
  })

  it('fails deterministically for absent, ambiguous, configured-missing, and configured-offline Providers', async () => {
    const empty = await mount()
    expect(() => empty.ctx.mobileDevice.listDevices()).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_UNAVAILABLE' }))
    empty.ctx.mobileDevice.registerProvider(provider('one'))
    empty.ctx.mobileDevice.registerProvider(provider('two'))
    expect(() => empty.ctx.mobileDevice.listDevices()).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_AMBIGUOUS' }))
    await empty.fiber.dispose()

    const missing = await mount({ provider: 'missing' })
    expect(() => missing.ctx.mobileDevice.listDevices()).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_CONFIGURED_MISSING' }))
    await missing.fiber.dispose()

    const offline = await mount({ provider: 'offline' })
    offline.ctx.mobileDevice.registerProvider(provider('offline', false))
    expect(() => offline.ctx.mobileDevice.listDevices()).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    await offline.fiber.dispose()
  })
})
