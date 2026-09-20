import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DesktopAppApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(async () => {}), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  vi.resetModules()
})

async function preload(url: string) {
  vi.stubGlobal('location', new URL(url))
  await import('../src/preload-app.ts')
  return new Map<string, unknown>(electron.contextBridge.exposeInMainWorld.mock.calls.map(([name, value]) => [name as string, value]))
}

describe('app preload Plugins bridge', () => {
  it.each(['dsh-app://app/index.html', 'dsh-app://app/?floating=1'])('exposes only the native window opener at %s', async (url) => {
    const exposed = await preload(url)
    const api = exposed.get('dshDesktop') as DesktopAppApi
    expect([...exposed.keys()]).toEqual(['dshDesktop'])
    expect(Object.keys(api).sort()).toEqual(['openPlugins', 'protocolVersion', 'updates'])
    expect(api.protocolVersion).toBe(1)
    await api.openPlugins()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.openPluginsWindow)
    electron.ipcRenderer.invoke.mockRejectedValueOnce(new Error('window unavailable'))
    await expect(api.openPlugins()).rejects.toThrow('window unavailable')
  })

  it('exposes semantic update status and releases presentation subscriptions', async () => {
    const api = (await preload('dsh-app://app/index.html')).get('dshDesktop') as DesktopAppApi
    await api.updates.status()
    await api.updates.open()
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([[DESKTOP_IPC.updatesStatus], [DESKTOP_IPC.updatesOpen]])
    const listener = vi.fn()
    const unsubscribe = api.updates.subscribe(listener)
    const [channel, handler] = electron.ipcRenderer.on.mock.calls[0]!
    handler({}, { phase: 'ready', version: '2.0.0' })
    expect(listener).toHaveBeenCalledWith({ phase: 'ready', version: '2.0.0' })
    unsubscribe()
    expect(electron.ipcRenderer.off).toHaveBeenCalledWith(channel, handler)
    expect(api.updates).not.toHaveProperty('install')
  })

  it.each([
    'https://app/index.html',
    'dsh-app://app:42/index.html',
    'dsh-app://app.example/index.html',
    'dsh-app://shell/plugin-manager.html',
    'dsh-app://shell/startup.html',
    'file:///index.html',
    'about:blank',
  ])('exposes no plugin or package operations at %s', async (url) => {
    const exposed = await preload(url)
    expect(exposed.get('dshDesktop')).toEqual({ protocolVersion: 1 })
    expect(exposed.has('dshStartup')).toBe(url === 'dsh-app://shell/startup.html')
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled()
  })
})
