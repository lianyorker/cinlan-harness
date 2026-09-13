import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DeviceCapabilitiesController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })

function bench() {
  const ctx = new Context()
  roots.push(ctx)
  return { ctx, controller: new DeviceCapabilitiesController(ctx), signal: new AbortController().signal }
}

describe('Device Provider readiness', () => {
  it.each(['computer', 'mobile'] as const)('does not mistake absent %s services for installed software', async (capability) => {
    const { controller, signal } = bench()
    await expect(controller.check({ capability }, signal)).resolves.toEqual({ capability, status: 'not-configured', reason: 'not-configured' })
  })

  it('reads Computer capabilities without listing applications or performing actions', async () => {
    const { ctx, controller, signal } = bench()
    const capabilities = vi.fn(async () => ({ provider: 'fixture', protocolVersion: 1 }))
    ctx.provide('computerUse', { capabilities } as never)
    await expect(controller.check({ capability: 'computer' }, signal)).resolves.toEqual({ capability: 'computer', status: 'available', reason: null })
    expect(capabilities).toHaveBeenCalledWith(signal)
  })

  it.each([
    ['COMPUTER_CLI_UNAVAILABLE', 'cli-missing'],
    ['MOBILE_CLI_UNAVAILABLE', 'cli-missing'],
    ['COMPUTER_PROVIDER_CONFIGURED_MISSING', 'provider-unavailable'],
    ['COMPUTER_CINLAN_PROTOCOL', 'protocol-error'],
    ['COMPUTER_CLI_TIMEOUT', 'probe-failed'],
    [undefined, 'probe-failed'],
  ])('redacts the %s failure', async (code, reason) => {
    const { ctx, controller, signal } = bench()
    ctx.provide('computerUse', { capabilities: async () => { throw Object.assign(new Error('private executable path'), { code }) } } as never)
    const result = await controller.check({ capability: 'computer' }, signal)
    expect(result).toEqual({ capability: 'computer', status: 'unavailable', reason })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('distinguishes mobile transport readiness from available devices', async () => {
    const { ctx, controller, signal } = bench()
    const listDevices = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ isAvailable: true, id: 'private-device' }])
    ctx.provide('mobileDevice', { listDevices } as never)
    await expect(controller.check({ capability: 'mobile' }, signal)).resolves.toEqual({ capability: 'mobile', status: 'unavailable', reason: 'no-devices' })
    await expect(controller.check({ capability: 'mobile' }, signal)).resolves.toEqual({ capability: 'mobile', status: 'available', reason: null })
  })

  it('honors cancellation before and after Provider work without publishing a failure state', async () => {
    const { ctx, controller } = bench()
    const abort = new AbortController()
    const reason = new Error('cancelled by caller')
    const capabilities = vi.fn(async () => { abort.abort(reason) })
    ctx.provide('computerUse', { capabilities } as never)
    await expect(controller.check({ capability: 'computer' }, abort.signal)).rejects.toBe(reason)
    await expect(controller.check({ capability: 'computer' }, abort.signal)).rejects.toBe(reason)
    expect(capabilities).toHaveBeenCalledTimes(1)
  })
})
