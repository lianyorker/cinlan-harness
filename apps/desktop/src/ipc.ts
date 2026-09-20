/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'
import type { DesktopStartupState } from './startup.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'dsh-desktop:locale-get',
  startupGet: 'dsh-desktop:startup-get',
  startupState: 'dsh-desktop:startup-state',
  startupQuit: 'dsh-desktop:startup-quit',
  startupRestart: 'dsh-desktop:startup-restart',
  openPluginsWindow: 'dsh-desktop:open-plugins-window',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Startup bridge is exposed only to the local recovery document. */
export interface DesktopStartupApi {
  readonly read: () => Promise<{ readonly locale: DesktopLocale; readonly state: DesktopStartupState }>
  readonly quit: () => Promise<void>
  readonly restart: () => Promise<void>
  readonly subscribe: (listener: (state: DesktopStartupState) => void) => () => void
}

/** App renderer bridge exposed only at dsh-app://app, without package operations. */
export interface DesktopAppApi {
  readonly protocolVersion: 1
  /** Open or focus the shell-owned Plugins window.
   * @returns Completion of the window request; does not report package installation.
   */
  openPlugins(): Promise<void>
}

/** Shell management bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}
