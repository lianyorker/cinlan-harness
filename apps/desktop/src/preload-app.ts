/** App carrier marker and origin-restricted bridges for native Plugins and startup recovery. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DesktopAppApi, type DesktopStartupApi } from './ipc.ts'
import type { DesktopStartupState } from './startup.ts'

const desktop: DesktopAppApi | Pick<DesktopAppApi, 'protocolVersion'> = location.protocol === 'dsh-app:' && location.host === 'app'
  ? { protocolVersion: 1, openPlugins: () => ipcRenderer.invoke(DESKTOP_IPC.openPluginsWindow) as Promise<void> }
  : { protocolVersion: 1 }
contextBridge.exposeInMainWorld('dshDesktop', desktop)

if (location.protocol === 'dsh-app:' && location.hostname === 'shell' && location.pathname === '/startup.html') {
  const startup: DesktopStartupApi = {
    read: () => ipcRenderer.invoke(DESKTOP_IPC.startupGet) as ReturnType<DesktopStartupApi['read']>,
    quit: () => ipcRenderer.invoke(DESKTOP_IPC.startupQuit) as Promise<void>,
    restart: () => ipcRenderer.invoke(DESKTOP_IPC.startupRestart) as Promise<void>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopStartupState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.startupState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.startupState, handle) }
    },
  }
  contextBridge.exposeInMainWorld('dshStartup', startup)
}
