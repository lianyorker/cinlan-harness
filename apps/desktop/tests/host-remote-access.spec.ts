import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { installDesktopRemoteAccessHost } from '../../desktop-host/src/remote-access.ts'
import { installDesktopUpdateTaskControl } from '../../desktop-host/src/update-tasks.ts'

function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('agents', { list: () => [] } as never)
  ctx.provide('jobs', { list: () => [] } as never)
  const control = installDesktopUpdateTaskControl(ctx)
  const assets = vi.fn((request: Request) => new Response(new URL(request.url).pathname))
  installDesktopRemoteAccessHost(ctx, control, assets)
  return { ctx, control, assets, host: ctx.get('remoteAccessHost')! }
}

describe('Desktop paired-carrier adapter', () => {
  it('drains delegated and local requests together before update admission closes', async () => {
    const { host, control } = fixture()
    const remoteResult = Promise.withResolvers<string>()
    const localResult = Promise.withResolvers<Response>()
    const remote = host.dispatch(() => remoteResult.promise)
    const local = control.dispatch(() => localResult.promise)
    let drained = false
    const lock = control.run('lock').then((value) => { drained = true; return value })
    const denied = vi.fn(() => 'must not execute')
    try {
      await expect(host.dispatch(denied)).rejects.toThrow('admission is closed')
      expect(denied).not.toHaveBeenCalled()
      remoteResult.resolve('paired result')
      await expect(remote).resolves.toBe('paired result')
      expect(drained).toBe(false)
      localResult.resolve(new Response(null, { status: 204 }))
      await expect(local).resolves.toHaveProperty('status', 204)
      await expect(lock).resolves.toBe(false)
      await control.run('unlock')
      await expect(host.dispatch(() => 17)).resolves.toBe(17)
    } finally {
      remoteResult.resolve('cleanup')
      localResult.resolve(new Response())
      await Promise.allSettled([remote, local, lock])
    }
  })

  it('uses only the provided paired asset reader and releases failed admissions', async () => {
    const { ctx, host, control, assets } = fixture()
    const injection = vi.fn()
    ctx.on('webserver/index-inject', injection)
    const request = new Request('https://paired.example/phone.js')
    expect(await (await host.fetchAssets(request)).text()).toBe('/phone.js')
    expect(assets).toHaveBeenCalledWith(request)
    expect(injection).not.toHaveBeenCalled()
    await expect(host.dispatch(() => { throw new Error('operation failed') })).rejects.toThrow('operation failed')
    await expect(control.run('lock')).resolves.toBe(false)
  })

  it('removes its capability on Host disposal and closes captured admission', async () => {
    const { ctx, host } = fixture()
    expect(ctx.get('remoteAccessHost')).toBe(host)
    await ctx.fiber.dispose()
    expect(ctx.get('remoteAccessHost')).toBeUndefined()
    const operation = vi.fn()
    await expect(host.dispatch(operation)).rejects.toThrow('admission is closed')
    expect(operation).not.toHaveBeenCalled()
  })
})
