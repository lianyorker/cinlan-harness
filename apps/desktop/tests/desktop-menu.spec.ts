import { describe, expect, it } from 'vitest'
import { desktopMenuTemplate } from '../src/desktop-menu.ts'
import { en } from '../src/locale.ts'

describe('Desktop native menus', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('retains the standard platform roles on %s', (platform) => {
    const template = desktopMenuTemplate({
      platform, appName: 'DeepSeek Harness', messages: en, development: false,
      openPlugins: () => {}, checkUpdates: () => {},
    })
    expect(template.slice(1).map(item => item.role)).toEqual(platform === 'darwin'
      ? ['fileMenu', 'editMenu', 'windowMenu'] : ['editMenu'])
    const submenu = template[0]?.submenu
    if (!Array.isArray(submenu)) throw new Error('Application submenu is missing')
    expect(submenu.flatMap(item => item.role === undefined ? [] : [item.role])).toEqual(platform === 'darwin'
      ? ['hide', 'hideOthers', 'unhide', 'quit'] : ['quit'])
    expect(submenu[0]).toMatchObject({ enabled: true, accelerator: 'CmdOrCtrl+,' })
  })
})
