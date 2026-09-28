import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPolicyEnvironment } from '../scripts/desktop-policy-environment.mjs'

vi.stubEnv('DSH_DESKTOP_UNSIGNED', '1')
const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
afterAll(() => { vi.unstubAllEnvs() })

describe('Desktop policy release identity', () => {
  it('selects only the active deployment and keeps test authentication explicit', () => {
    expect(resolveDesktopPolicyEnvironment({
      DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.test.example',
    })).toEqual({ origin: 'https://policy.test.example', allowedPageOrigins: ['https://policy.test.example'], authentication: 'feishu-test' })
    expect(resolveDesktopPolicyEnvironment({
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
      DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://policy.prod.example',
    })).toEqual({ origin: 'https://policy.prod.example', allowedPageOrigins: ['https://policy.prod.example'], authentication: 'anonymous' })
  })

  it('rejects absent production policy, unsafe origins, and forged auth or origin fields', () => {
    expect(() => createElectronBuilderConfig({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' }, 'win32', 'x64')).toThrow('PROD_ORIGIN')
    for (const origin of ['http://policy.example', 'https://user@policy.example', 'https://policy.example/path']) {
      expect(() => resolveDesktopPolicyEnvironment({ DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: origin })).toThrow('HTTPS origin')
    }
    for (const options of ['{', '[]', '{"authentication":"anonymous"}', '{"origin":"https://other.example"}', '{"allowedPageOrigins":[]}']) {
      expect(() => resolveDesktopPolicyEnvironment({
        DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.test.example',
        DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: options,
      })).toThrow()
    }
  })

  it('binds policy and nightly artifacts to the retained native application identity and feed', () => {
    const config = createElectronBuilderConfig({
      DSH_DESKTOP_APP_ID: 'com.cinlan.harness.test',
      DOWNLOAD_TEST_ORIGIN: 'https://artifacts.test.example',
      DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.test.example',
      DSH_DESKTOP_UNSIGNED: '1',
    }, 'win32', 'x64')
    expect(config.appId).toBe('com.cinlan.harness.test')
    expect(config.extraMetadata).toMatchObject({
      dshDesktopAppId: config.appId,
      dshMandatoryUpdatePolicy: { origin: 'https://policy.test.example', authentication: 'feishu-test' },
    })
    expect(config.publish).toEqual([{ provider: 'generic', url: 'https://artifacts.test.example/_/harness/desktop/stable/win-x64/', channel: 'nightly' }])
    expect(config.extraResources.map(resource => resource.to)).toEqual(['runtime', 'seed'])
    expect(config.npmRebuild).toBe(false)
    expect(config.artifactName).toContain('-unsigned.')
    expect(config.win).toMatchObject({ forceCodeSigning: false, target: ['nsis'] })
    expect(config.nsis.include).toMatch(/[\\/]scripts[\\/]installer\.nsh$/u)
  })

  it('rejects an unconfigured signed Windows package', () => {
    expect(() => createElectronBuilderConfig({}, 'win32', 'x64'))
      .toThrow(/DSH_DESKTOP_WINDOWS_CER_FILE/u)
  })

  it('rejects invalid unsigned mode instead of silently changing artifact identity', () => {
    expect(() => createElectronBuilderConfig({ DSH_DESKTOP_UNSIGNED: 'yes' }, 'win32', 'x64'))
      .toThrow(/DSH_DESKTOP_UNSIGNED must be 1/u)
  })

  it('hooks the running-app rejection before NSIS extraction', () => {
    const installer = readFileSync(resolve(import.meta.dirname, '../scripts/installer.nsh'), 'utf8')
    expect(installer).toContain('!macro customCheckAppRunning')
    expect(installer).toContain('nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}"')
    expect(installer).toContain('SetErrorLevel 2')
    expect(installer.indexOf('nsProcess::FindProcess')).toBeLessThan(installer.indexOf('SetErrorLevel 2'))
  })
})
