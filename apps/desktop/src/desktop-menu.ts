/** Native menu roles preserve platform editing, window, and application shortcuts. */

import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopMessages } from './locale.ts'

/**
 * Compose the desktop commands with Electron's localized standard roles.
 * @param options - Platform, application copy, and owned command callbacks.
 * @returns The complete application menu template.
 */
export function desktopMenuTemplate(options: {
  readonly platform: NodeJS.Platform
  readonly appName: string
  readonly messages: DesktopMessages
  readonly development: boolean
  readonly openPlugins: () => void
  readonly checkUpdates: () => void
}): MenuItemConstructorOptions[] {
  const { platform, appName, messages, development, openPlugins, checkUpdates } = options
  const darwin = platform === 'darwin'
  const hideCommands: MenuItemConstructorOptions[] = darwin
    ? [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }]
    : []
  const platformMenus: MenuItemConstructorOptions[] = darwin
    ? [{ role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]
    : [{ role: 'editMenu' }]
  return [{
    label: darwin ? appName : messages.application,
    submenu: [
      {
        label: development ? messages.pluginsMenuPackagedOnly : messages.pluginsMenu,
        accelerator: 'CmdOrCtrl+,',
        enabled: !development,
        click: openPlugins,
      },
      { label: messages.checkUpdatesMenu, click: checkUpdates },
      { type: 'separator' },
      ...hideCommands,
      { role: 'quit' },
    ],
  }, ...platformMenus]
}
