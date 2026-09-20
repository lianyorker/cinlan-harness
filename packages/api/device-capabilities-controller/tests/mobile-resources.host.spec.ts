/** Resource and mirror management requires authenticated local Gateway authority. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import DeviceCapabilitiesController from '../src/index.ts'
import type { MobileResourceRevision, MobileResourceTaskId, MobileMirrorId } from '@deepseek-ai/dsh-mobile-device-runtime'
const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })
it.each([undefined, 'delegated'])('denies %s authority before any resource or device operation', async (kind) => {
  const ctx = new Context(); roots.push(ctx)
  const signal = new AbortController().signal
  ctx.provide('typertGateway', { currentAccess: () => kind ? { kind, signal } : undefined } as never)
  const status = vi.fn(); const start = vi.fn(); const cancel = vi.fn(); const startMirror = vi.fn(); const closeMirror = vi.fn()
  ctx.provide('mobileRuntime', { status, start, cancel, startMirror, closeMirror } as never)
  const controller = new DeviceCapabilitiesController(ctx)
  await expect(controller.mobileRuntimeStatus(signal)).rejects.toThrow('authenticated local')
  await expect(controller.startMobileResource({ resourceId: 'scrcpy', operation: 'install', expectedRevision: 'missing' as MobileResourceRevision, acceptLicense: true }, signal)).rejects.toThrow('authenticated local')
  await expect(controller.cancelMobileResource({ taskId: 'task' as MobileResourceTaskId }, signal)).rejects.toThrow('authenticated local')
  await expect(controller.startMobileMirror({ deviceId: 'android:phone' }, signal)).rejects.toThrow('authenticated local')
  await expect(controller.closeMobileMirror({ mirrorId: 'mirror' as MobileMirrorId }, signal)).rejects.toThrow('authenticated local')
  expect([status, start, cancel, startMirror, closeMirror].every(call => call.mock.calls.length === 0)).toBe(true)
})
it('passes exact local request identity without turning observer cancellation into task cancellation', async () => {
  const ctx = new Context(); roots.push(ctx)
  const signal = new AbortController().signal
  ctx.provide('typertGateway', { currentAccess: () => ({ kind: 'trusted-local', signal }) } as never)
  const receipt = { id: 'exact-task' }; const start = vi.fn(() => receipt)
  ctx.provide('mobileRuntime', { start } as never)
  const controller = new DeviceCapabilitiesController(ctx)
  const request = { resourceId: 'scrcpy', operation: 'install', expectedRevision: 'missing' as MobileResourceRevision, acceptLicense: true } as const
  expect(await controller.startMobileResource(request, signal)).toBe(receipt)
  expect(start).toHaveBeenCalledWith(request, signal)
})
