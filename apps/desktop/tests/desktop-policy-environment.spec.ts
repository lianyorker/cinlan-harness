import { describe, expect, it } from 'vitest'
import { resolveDesktopPolicyEnvironment } from '../scripts/desktop-policy-environment.mjs'
import { createElectronBuilderConfig } from '../electron-builder.config.mjs'

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
    }, 'win32', 'x64')
    expect(config.appId).toBe('com.cinlan.harness.test')
    expect(config.extraMetadata).toMatchObject({
      dshDesktopAppId: config.appId,
      dshMandatoryUpdatePolicy: { origin: 'https://policy.test.example', authentication: 'feishu-test' },
    })
    expect(config.publish).toEqual([{ provider: 'generic', url: 'https://artifacts.test.example/_/harness/desktop/stable/win-x64/', channel: 'nightly' }])
    expect(config.extraResources.map(resource => resource.to)).toEqual(['runtime', 'seed'])
  })

  it('allows an unconfigured local test package without inventing a mandatory service', () => {
    const config = createElectronBuilderConfig({}, 'win32', 'x64')
    expect(config.extraMetadata).toEqual({ dshDesktopAppId: 'com.cinlan.harness' })
    expect(config.publish[0].channel).toBe('nightly')
  })
})
