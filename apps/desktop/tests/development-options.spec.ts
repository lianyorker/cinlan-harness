import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDevelopmentOptions } from '../scripts/development-options.ts'

const appRoot = resolve('apps/desktop')

describe('desktop development options', () => {
  it('preserves the default project, home, browser data and debugger ports', () => {
    const root = join(appRoot, '.desktop-build', 'development')
    expect(resolveDevelopmentOptions(appRoot, {})).toEqual({
      projectDir: join(root, 'project'),
      home: join(root, 'home'),
      userData: join(root, 'electron-user-data'),
      mainPort: 9229,
      rendererPort: 9222,
      hostPort: 9230,
    })
  })

  it('keeps all development state under an explicit root and permits ephemeral debug ports', () => {
    const root = resolve('isolated-desktop')
    expect(resolveDevelopmentOptions(appRoot, {
      DSH_DESKTOP_DEVELOPMENT_ROOT: root,
      DSH_DESKTOP_MAIN_INSPECT_PORT: '0',
      DSH_DESKTOP_RENDERER_DEBUG_PORT: '0',
      DSH_DESKTOP_HOST_INSPECT_PORT: '0',
    })).toEqual({
      projectDir: join(root, 'project'),
      home: join(root, 'home'),
      userData: join(root, 'electron-user-data'),
      mainPort: 0,
      rendererPort: 0,
      hostPort: undefined,
    })
  })

  it('lets DSH_HOME override only Harness state', () => {
    const options = resolveDevelopmentOptions(appRoot, {
      DSH_DESKTOP_DEVELOPMENT_ROOT: 'isolated-desktop',
      DSH_HOME: 'isolated-home',
      DSH_DESKTOP_HOST_INSPECT_PORT: '49300',
    })
    expect(options.home).toBe(resolve('isolated-home'))
    expect(options.projectDir).toBe(resolve('isolated-desktop/project'))
    expect(options.userData).toBe(resolve('isolated-desktop/electron-user-data'))
    expect(options.hostPort).toBe(49300)
  })

  it.each(['DSH_DESKTOP_MAIN_INSPECT_PORT', 'DSH_DESKTOP_RENDERER_DEBUG_PORT', 'DSH_DESKTOP_HOST_INSPECT_PORT'])(
    'rejects invalid %s values', (key) => {
      for (const value of ['-1', '65536', '1.5', 'invalid']) {
        expect(() => resolveDevelopmentOptions(appRoot, { [key]: value })).toThrow(`${key} must be an integer`)
      }
    },
  )
})
