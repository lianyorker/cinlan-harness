import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  desktopElectronBuilderArguments,
  desktopElectronBuilderEnvironment,
  parseDesktopPackageInvocation,
  resolveDesktopPackageTarget,
  withoutDesktopUploadCredentials,
  withoutWindowsSigningEnvironment,
} from '../scripts/package-target.ts'
import { assertDesktopDependencySelection } from '../scripts/validate-electron-builder-dependencies.mjs'

function desktopDependencyRoot() {
  const appPath = resolve(import.meta.dirname, '..')
  return {
    name: '@deepseek-ai/dsh-desktop',
    path: appPath,
    dependencies: {
      '@deepseek-ai/cordis': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/cordis') },
      '@deepseek-ai/cordis-plugin-group': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/cordis-plugin-group') },
      '@deepseek-ai/cordis-plugin-include': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/cordis-plugin-include') },
      '@deepseek-ai/cordis-plugin-loader': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/cordis-plugin-loader') },
      '@deepseek-ai/dsh-app-boot': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/dsh-app-boot') },
      '@deepseek-ai/dsh-home-paths': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/dsh-home-paths') },
      '@deepseek-ai/dsh-launch-environment': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/dsh-launch-environment') },
      '@deepseek-ai/dsh-system-prompt': { version: 'workspace', path: resolve(appPath, 'node_modules/@deepseek-ai/dsh-system-prompt') },
      'electron-updater': {
        version: '6.8.9', path: resolve(appPath, 'node_modules/electron-updater'),
        dependencies: { semver: { version: '7.7.4', path: resolve(appPath, 'node_modules/electron-updater/node_modules/semver') } },
      },
      semver: { version: '7.8.5', path: resolve(appPath, 'node_modules/semver') },
    },
  }
}

describe('desktop package target', () => {
  it('selects matching runtime and electron-builder architectures', () => {
    expect(resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')).toMatchObject({
      platform: 'darwin', arch: 'arm64', builderPlatform: '--mac', builderArch: '--arm64',
    })
    expect(resolveDesktopPackageTarget('mac-x64', 'darwin', 'x64')).toMatchObject({
      platform: 'darwin', arch: 'x64', builderPlatform: '--mac', builderArch: '--x64',
    })
    expect(resolveDesktopPackageTarget('win-x64', 'win32', 'x64')).toMatchObject({
      platform: 'win32', arch: 'x64', builderPlatform: '--win', builderArch: '--x64',
    })
  })

  it('allows an Apple Silicon host to build the Intel target through Rosetta', () => {
    expect(resolveDesktopPackageTarget('mac-x64', 'darwin', 'arm64').arch).toBe('x64')
  })

  it('rejects unsupported targets and hosts before building', () => {
    expect(() => resolveDesktopPackageTarget('linux-x64', 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopPackageTarget('win-x64', 'darwin', 'arm64')).toThrow(/Windows x64/u)
    expect(() => resolveDesktopPackageTarget('mac-arm64', 'darwin', 'x64')).toThrow(/Apple Silicon/u)
    expect(() => resolveDesktopPackageTarget('mac-arm64', 'linux', 'arm64')).toThrow(/macOS/u)
    expect(() => resolveDesktopPackageTarget('mac-x64', 'darwin', 'ppc64')).toThrow(/Rosetta/u)
  })

  it('parses installer and unpacked-directory invocations', () => {
    expect(parseDesktopPackageInvocation(['mac-arm64'], 'darwin', 'arm64').directory).toBe(false)
    expect(parseDesktopPackageInvocation(['mac-arm64', '--dir'], 'darwin', 'arm64').directory).toBe(true)
    expect(parseDesktopPackageInvocation([], 'darwin', 'arm64').target.name).toBe('mac-arm64')
    expect(parseDesktopPackageInvocation(['--prepare-only'], 'darwin', 'arm64').prepareOnly).toBe(true)
    expect(() => parseDesktopPackageInvocation(['mac-arm64', 'mac-x64'], 'darwin', 'arm64'))
      .toThrow(/at most one target/u)
  })

  it('keeps electron-builder publishing disabled for the separate validated upload', () => {
    const target = resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')
    expect(desktopElectronBuilderArguments(target, false)).toEqual([
      'node',
      createRequire(import.meta.url).resolve('electron-builder/out/cli/cli.js'),
      '--config',
      'electron-builder.config.mjs',
      '--mac',
      '--arm64',
      '--publish',
      'never',
    ])
    expect(desktopElectronBuilderArguments(target, true)).toContain('--dir')
  })

  it('keeps Windows signing fields out of build and seed preparation subprocesses', () => {
    expect(withoutWindowsSigningEnvironment({
      DSH_DESKTOP_WINDOWS_CER_FILE: 'C:\\release\\server.cer',
      DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'token-secret',
      DSH_DESKTOP_WINDOWS_KEY_CONTAINER: 'container',
      DSH_DESKTOP_WINDOWS_SIGNTOOL: 'C:\\tools\\signtool.exe',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })).toEqual({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' })
  })

  it('accepts the Desktop production tree without removing transitive dependencies', () => {
    const root = desktopDependencyRoot()
    const before = structuredClone(root)
    expect(() => { assertDesktopDependencySelection([root]) }).not.toThrow()
    expect(root).toEqual(before)
  })

  it('rejects empty listings, other projects, and selection of the whole workspace', () => {
    const root = desktopDependencyRoot()
    for (const tree of [
      [],
      [root, { name: '@deepseek-ai/dsh', path: resolve(import.meta.dirname, '../../..') }],
      [{ ...root, name: '@deepseek-ai/other-app' }],
      [{ ...root, path: resolve(import.meta.dirname, '../../web') }],
    ]) {
      expect(() => { assertDesktopDependencySelection(tree) }).toThrow(/must select only/u)
    }
  })

  it.each([
    '@deepseek-ai/cordis',
    '@deepseek-ai/cordis-plugin-group',
    '@deepseek-ai/cordis-plugin-include',
    '@deepseek-ai/cordis-plugin-loader',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-system-prompt',
    'electron-updater',
    'semver',
  ])('rejects a listing missing %s', (dependency) => {
    const root = desktopDependencyRoot()
    const dependencies = Object.fromEntries(Object.entries(root.dependencies).filter(([name]) => name !== dependency))
    expect(() => { assertDesktopDependencySelection([{ ...root, dependencies }]) }).toThrow(`missing ${dependency}`)
  })

  it('overrides inherited collector filters without changing the preparation environment', () => {
    const environment = Object.freeze({
      pnpm_config_filter: 'website',
      PNPM_CONFIG_FILTER: '*',
      pnpm_config_filter_prod: '.../website',
      PNPM_CONFIG_FILTER_PROD: '*',
      npm_config_filter: '*',
      npm_config_filter_prod: '.../benchmarks',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
    })
    expect(desktopElectronBuilderEnvironment(environment)).toEqual({
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
      pnpm_config_filter: '@deepseek-ai/dsh-desktop',
    })
    expect(environment.pnpm_config_filter).toBe('website')
    expect(environment.PNPM_CONFIG_FILTER_PROD).toBe('*')
  })

  it('keeps COS credentials out of every packaging subprocess', () => {
    expect(withoutDesktopUploadCredentials({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
      DOWNLOAD_TEST_COS_BUCKET: 'test-download-bucket',
      DOWNLOAD_TEST_COS_SECRET_ID: 'test-id',
      DOWNLOAD_TEST_COS_SECRET_KEY: 'test-key',
      DOWNLOAD_PROD_COS_BUCKET: 'production-download-bucket',
      DOWNLOAD_PROD_COS_SECRET_ID: 'production-id',
      DOWNLOAD_PROD_COS_SECRET_KEY: 'production-key',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })).toEqual({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
      DOWNLOAD_TEST_COS_BUCKET: 'test-download-bucket',
      DOWNLOAD_PROD_COS_BUCKET: 'production-download-bucket',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })
  })
})
