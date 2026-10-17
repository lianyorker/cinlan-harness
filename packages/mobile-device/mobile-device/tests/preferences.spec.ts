import { Context } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MobileDeviceRuntime, { MobileDeviceGeneration, MobileDeviceId, MobileObservationId } from '../src/index.ts'
import type { MobileDevice, MobileDeviceProvider, MobileDeviceSettings, MobileObserveSpec } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function device(id: string, isAvailable = true): MobileDevice {
  return { id: MobileDeviceId(id), name: id, backend: 'android', state: 'booted', isAvailable }
}

function provider(id = 'fixture') {
  const listDevices = vi.fn(() => Promise.resolve([device('saved'), device('other')]))
  const observe = vi.fn((spec: MobileObserveSpec) => Promise.resolve({
    device: device(spec.deviceId), deviceGeneration: MobileDeviceGeneration('generation'),
    observationId: MobileObservationId('observation'), coordinateSpace: 'normalized' as const,
    tree: spec.deviceId, screenshotStatus: { state: 'skipped' as const },
  }))
  const unavailable = () => Promise.reject(new Error('mutation fixture is not used'))
  return {
    id, available: () => true, listDevices, observe,
    touch: unavailable, typeText: unavailable, pressButton: unavailable,
  } satisfies MobileDeviceProvider
}

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  const mobile = await ctx.plugin(MobileDeviceRuntime)
  const config = mobile.config as { [K in keyof MobileDeviceSettings]: Volatile<MobileDeviceSettings[K]> }
  const update = (patch: Partial<MobileDeviceSettings>): void => {
    if (patch.enabled !== undefined) updateVolatile(config.enabled, createVolatile(patch.enabled))
    if (patch.defaultDeviceId !== undefined) updateVolatile(config.defaultDeviceId, createVolatile(patch.defaultDeviceId))
    if (patch.androidSdkPath !== undefined) updateVolatile(config.androidSdkPath, createVolatile(patch.androidSdkPath))
  }
  const selected = provider()
  const unregister = ctx.mobileDevice.registerProvider(selected)
  return { ctx, mobile, update, selected, unregister }
}

describe('mobile-device preferences', () => {
  it('reads live Config fields, returns detached preferences, and accepts saved Config after reload', async () => {
    const { ctx, mobile, update } = await harness()
    const defaults = { enabled: false, defaultDeviceId: '', androidSdkPath: '' }
    expect(ctx.mobileDevice.getPreferences()).toEqual(defaults)
    update({ enabled: true, defaultDeviceId: 'saved', androidSdkPath: 'sdk' })
    expect(ctx.mobileDevice.getPreferences()).toEqual({ enabled: true, defaultDeviceId: 'saved', androidSdkPath: 'sdk' })
    const detached = ctx.mobileDevice.getPreferences()
    detached.defaultDeviceId = 'other'
    expect(ctx.mobileDevice.getPreferences().defaultDeviceId).toBe('saved')
    const saved = ctx.mobileDevice.getPreferences()
    await mobile.dispose()
    await ctx.plugin(MobileDeviceRuntime, saved)
    expect(ctx.mobileDevice.getPreferences().defaultDeviceId).toBe('saved')
    expect(ctx.mobileDevice.getPreferences()).toEqual(saved)
  })

  it('supplies defaults without settings and does not guess a device', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(MobileDeviceRuntime)
    const selected = provider()
    ctx.mobileDevice.registerProvider(selected)
    expect(ctx.mobileDevice.getPreferences()).toEqual({ enabled: false, defaultDeviceId: '', androidSdkPath: '' })
    await expect(ctx.mobileDevice.observe({})).rejects.toMatchObject({ code: 'MOBILE_DEFAULT_DEVICE_MISSING' })
    expect(selected.listDevices).not.toHaveBeenCalled()
    expect(selected.observe).not.toHaveBeenCalled()
  })

  it('passes an explicit exact id without consulting the saved target or inventory', async () => {
    const { ctx, selected, update } = await harness()
    update({ defaultDeviceId: ' saved ' })
    const signal = new AbortController().signal
    const request = { deviceId: MobileDeviceId('explicit'), captureScreenshot: true }
    await expect(ctx.mobileDevice.observe(request, signal)).resolves.toMatchObject({ device: { id: 'explicit' } })
    expect(selected.observe).toHaveBeenCalledWith(request, signal)
    expect(selected.listDevices).not.toHaveBeenCalled()
  })

  it.each(['', ' saved ', ' '])('rejects explicit %j rather than using the saved default', async (id) => {
    const { ctx, selected, update } = await harness()
    update({ defaultDeviceId: 'saved' })
    await expect(ctx.mobileDevice.observe({ deviceId: MobileDeviceId(id) })).rejects.toMatchObject({ code: 'MOBILE_DEVICE_ID_INVALID' })
    expect(selected.listDevices).not.toHaveBeenCalled()
    expect(selected.observe).not.toHaveBeenCalled()
  })

  it('resolves the saved available exact id and forwards screenshot preference and cancellation', async () => {
    const { ctx, selected, update } = await harness()
    update({ defaultDeviceId: 'saved' })
    const signal = new AbortController().signal
    await expect(ctx.mobileDevice.observe({ captureScreenshot: true }, signal)).resolves.toMatchObject({ device: { id: 'saved' } })
    expect(selected.listDevices).toHaveBeenCalledExactlyOnceWith(signal)
    expect(selected.observe).toHaveBeenCalledExactlyOnceWith({ deviceId: 'saved', captureScreenshot: true }, signal)
  })

  it.each([
    ['', 'MOBILE_DEFAULT_DEVICE_MISSING'], [' saved ', 'MOBILE_DEFAULT_DEVICE_INVALID'],
  ])('rejects unusable saved id %j before inventory', async (defaultDeviceId, code) => {
    const { ctx, selected, update } = await harness()
    update({ defaultDeviceId })
    await expect(ctx.mobileDevice.observe({})).rejects.toMatchObject({ code })
    expect(selected.listDevices).not.toHaveBeenCalled()
    expect(selected.observe).not.toHaveBeenCalled()
  })

  it.each([
    [[device('other')], 'MOBILE_DEVICE_NOT_FOUND'],
    [[device('saved', false), device('other')], 'MOBILE_DEVICE_UNAVAILABLE'],
    [[device('saved'), device('saved'), device('other')], 'MOBILE_DEFAULT_DEVICE_AMBIGUOUS'],
  ] as const)('never substitutes another available device for a failing saved target (%s)', async (devices, code) => {
    const { ctx, selected, update } = await harness()
    update({ defaultDeviceId: 'saved' })
    selected.listDevices.mockResolvedValue([...devices])
    await expect(ctx.mobileDevice.observe({})).rejects.toMatchObject({ code })
    expect(selected.listDevices).toHaveBeenCalledOnce()
    expect(selected.observe).not.toHaveBeenCalled()
  })

  it('captures provider and target before enumeration when preferences and registration change', async () => {
    const { ctx, selected, unregister, update } = await harness()
    update({ defaultDeviceId: 'saved' })
    const inventory = Promise.withResolvers<MobileDevice[]>()
    selected.listDevices.mockReturnValue(inventory.promise)
    const pending = ctx.mobileDevice.observe({})
    expect(selected.listDevices).toHaveBeenCalledOnce()
    update({ defaultDeviceId: 'other' })
    unregister()
    const replacement = provider('replacement')
    ctx.mobileDevice.registerProvider(replacement)
    inventory.resolve([device('saved'), device('other')])
    await expect(pending).resolves.toMatchObject({ device: { id: 'saved' } })
    expect(selected.observe).toHaveBeenCalledExactlyOnceWith({ deviceId: 'saved' }, undefined)
    expect(replacement.listDevices).not.toHaveBeenCalled()
    expect(replacement.observe).not.toHaveBeenCalled()
  })

  it('propagates inventory and observation failures without retry or substitution', async () => {
    const { ctx, selected, update } = await harness()
    update({ defaultDeviceId: 'saved' })
    const failure = new Error('provider failed')
    selected.listDevices.mockRejectedValueOnce(failure)
    await expect(ctx.mobileDevice.observe({})).rejects.toBe(failure)
    expect(selected.observe).not.toHaveBeenCalled()
    selected.observe.mockRejectedValueOnce(failure)
    await expect(ctx.mobileDevice.observe({})).rejects.toBe(failure)
    expect(selected.listDevices).toHaveBeenCalledTimes(2)
    expect(selected.observe).toHaveBeenCalledExactlyOnceWith({ deviceId: 'saved' }, undefined)
  })

  it('stops before dispatch when cancelled before or during default enumeration', async () => {
    const { ctx, selected, update } = await harness()
    update({ defaultDeviceId: 'saved' })
    const reason = new Error('cancelled')
    await expect(ctx.mobileDevice.observe({}, AbortSignal.abort(reason))).rejects.toBe(reason)
    expect(selected.listDevices).not.toHaveBeenCalled()
    const inventory = Promise.withResolvers<MobileDevice[]>()
    selected.listDevices.mockReturnValue(inventory.promise)
    const controller = new AbortController()
    const pending = expect(ctx.mobileDevice.observe({}, controller.signal)).rejects.toBe(reason)
    controller.abort(reason)
    inventory.resolve([device('saved')])
    await pending
    expect(selected.observe).not.toHaveBeenCalled()
  })
})
