import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DeviceCapabilitiesController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })

function bench(authenticated: boolean) {
  const ctx = new Context()
  roots.push(ctx)
  const operator = { id: 'operator' }
  if (authenticated) {
    ctx.provide('connection', { browserPeer: operator } as never)
    ctx.provide('invocation', { peer: operator, signal: new AbortController().signal } as never)
  }
  const computerUse = {
    permissionStatus: vi.fn(async () => ({ kind: 'macos', accessibility: false, screenRecording: true })),
    requestPermissions: vi.fn(async () => ({ kind: 'macos', accessibility: true, screenRecording: true })),
    openScreenRecordingSettings: vi.fn(async () => true),
  }
  ctx.provide('computerUse', computerUse as never)
  return { ctx, controller: new DeviceCapabilitiesController(ctx), computerUse }
}

describe('Computer Use OS permission Remotes', () => {
  it('requires the authenticated local operator before invoking any OS operation', async () => {
    const { controller, computerUse } = bench(false)
    const signal = new AbortController().signal
    await expect(controller.computerPermissionStatus(signal)).rejects.toThrow('authenticated local')
    await expect(controller.requestComputerPermissions(signal)).rejects.toThrow('authenticated local')
    await expect(controller.openComputerScreenRecordingSettings(signal)).rejects.toThrow('authenticated local')
    expect(computerUse.permissionStatus).not.toHaveBeenCalled()
    expect(computerUse.requestPermissions).not.toHaveBeenCalled()
    expect(computerUse.openScreenRecordingSettings).not.toHaveBeenCalled()
  })

  it('forwards authenticated requests and cancellation to the selected provider', async () => {
    const { controller, computerUse } = bench(true)
    const signal = new AbortController().signal
    await expect(controller.computerPermissionStatus(signal)).resolves.toEqual({
      kind: 'macos', accessibility: false, screenRecording: true,
    })
    await expect(controller.requestComputerPermissions(signal)).resolves.toEqual({
      kind: 'macos', accessibility: true, screenRecording: true,
    })
    await expect(controller.openComputerScreenRecordingSettings(signal)).resolves.toBe(true)
    expect(computerUse.permissionStatus).toHaveBeenCalledWith(signal)
    expect(computerUse.requestPermissions).toHaveBeenCalledWith(signal)
    expect(computerUse.openScreenRecordingSettings).toHaveBeenCalledWith(signal)
  })
})
