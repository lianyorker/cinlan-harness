/** Minimal app carrier marker and origin-restricted bridge for the startup document. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DesktopStartupApi } from './ipc.ts'
import type { DesktopStartupState } from './startup.ts'

contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1 })

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
