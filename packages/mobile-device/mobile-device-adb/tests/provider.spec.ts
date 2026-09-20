/** Provider semantics with only external ADB responses controlled. */
import { Context } from '@deepseek-ai/cordis'
import { MobileDeviceId } from '@deepseek-ai/dsh-mobile-device'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { AdbMobileDeviceProvider } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { AdbRunner } from '../src/runner.ts'

const providers: AdbMobileDeviceProvider[] = []
afterEach(async () => { await Promise.all(providers.splice(0).map(provider => provider.dispose())); vi.restoreAllMocks() })
const id = MobileDeviceId('android:fixture')
async function harness() {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer()
  const state = { transport: '7', boot: '11111111-2222-4333-8444-555555555555', rotation: 0, size: '1x1', sdk: '' }
  const ctx = new Context()
  ctx.provide('mobileDevice', { getPreferences: () => ({ androidSdkPath: state.sdk }) } as never)
  const run = vi.spyOn(AdbRunner.prototype, 'run').mockImplementation(async (args) => {
    if (args[0] === 'devices') return Buffer.from('List of devices attached\nfixture device model:Fixture transport_id:' + state.transport)
    if (args.includes('/proc/sys/kernel/random/boot_id')) return Buffer.from(state.boot)
    if (args[2] === 'exec-out' && args[3] === 'cat') return Buffer.from('<hierarchy rotation="' + String(state.rotation) + '"><node text="fixture"/></hierarchy>')
    if (args.includes('size')) return Buffer.from('Physical size: ' + state.size)
    if (args.includes('dumpsys')) return Buffer.from('mResumedActivity: ActivityRecord{fixture u0 example.fixture/.Main t1}')
    if (args.includes('screencap')) return png
    return Buffer.alloc(0)
  })
  const provider = new AdbMobileDeviceProvider(ctx, resolveConfig())
  providers.push(provider)
  return { provider, state, run, png }
}
it('publishes a fully decoded screenshot and normalized tap only for its exact observed transport', async () => {
  const h = await harness()
  const observation = await h.provider.observe({ deviceId: id })
  expect(observation.screenshot?.data).toEqual(h.png)
  expect(observation.screenshotStatus).toEqual({ state: 'captured' })
  const result = await h.provider.touch({ deviceId: id, observationId: observation.observationId, kind: 'tap', x: 1, y: 0 })
  expect(result.observationId).toBe(observation.observationId)
  expect(h.run.mock.calls.map(call => call[0])).toContainEqual(['-t', '7', 'shell', 'input', 'tap', '0', '0'])
  await expect(h.provider.pressButton({ deviceId: id, observationId: observation.observationId, button: 'home' })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
})
it('rejects screenshot geometry that differs from the captured display', async () => {
  const h = await harness(); h.state.size = '2x2'
  await expect(h.provider.observe({ deviceId: id })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
})
it.each(['龙', 'secret;echo', '$(command)', 'percent%s'])('rejects unsupported text without forwarding it and consumes the token', async (text) => {
  const h = await harness()
  const observation = await h.provider.observe({ deviceId: id, captureScreenshot: false })
  await expect(h.provider.typeText({ deviceId: id, observationId: observation.observationId, text })).rejects.toMatchObject({ code: 'MOBILE_TEXT_UNSUPPORTED' })
  expect(h.run.mock.calls.some(call => call[0].includes('input'))).toBe(false)
  await expect(h.provider.pressButton({ deviceId: id, observationId: observation.observationId, button: 'home' })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
})
it('refuses geometry and boot changes without sending input', async () => {
  const h = await harness()
  const first = await h.provider.observe({ deviceId: id, captureScreenshot: false })
  h.state.rotation = 1
  await expect(h.provider.touch({ deviceId: id, observationId: first.observationId, kind: 'swipe', fromX: 0, fromY: 0, toX: 1, toY: 1 })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
  const second = await h.provider.observe({ deviceId: id, captureScreenshot: false })
  h.state.boot = '22222222-2222-4333-8444-555555555555'
  await expect(h.provider.pressButton({ deviceId: id, observationId: second.observationId, button: 'home' })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
  expect(h.run.mock.calls.some(call => call[0].includes('input'))).toBe(false)
})
it('releases the device reservation when an invalid saved SDK selection throws synchronously', async () => {
  const h = await harness(); h.state.sdk = 'relative/not-sdk'
  await expect(h.provider.observe({ deviceId: id, captureScreenshot: false })).rejects.toThrow('absolute')
  h.state.sdk = ''
  await expect(h.provider.observe({ deviceId: id, captureScreenshot: false })).resolves.toMatchObject({ device: { id } })
})
it('checks the generation again after geometry inspection immediately before input', async () => {
  const h = await harness()
  const observation = await h.provider.observe({ deviceId: id, captureScreenshot: false })
  const original = h.run.getMockImplementation()
  if (!original) throw new Error('Fixture command missing')
  h.run.mockImplementation(async (...args) => {
    const result = await original(...args)
    if (args[0].includes('size')) h.state.transport = '8'
    return result
  })
  await expect(h.provider.pressButton({ deviceId: id, observationId: observation.observationId, button: 'home' })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
  expect(h.run.mock.calls.some(call => call[0].includes('input'))).toBe(false)
})
