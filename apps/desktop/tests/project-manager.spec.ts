import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import {
  createSeedMetadata,
  DesktopProjectManager,
  packageNameFromSpec,
  verifySeedIntegrity,
  type DesktopProjectHooks,
} from '../src/project-manager.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { DESKTOP_PACKAGES_DIR, DESKTOP_PACKAGE_SET_FILE } from '../src/core-package-set.ts'
import type { DesktopRelease } from '../src/release.ts'
import { archivePnpmStore } from '../src/seed-store.ts'

const roots: string[] = []
const releaseWorkers: Array<() => Promise<void>> = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-test-'))
  roots.push(root)
  return root
}

function writeIntegrity(seed: string): void {
  const paths: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name !== 'integrity.json') paths.push(path)
    }
  }
  visit(seed)
  const files = paths.sort().map((path) => {
    const body = readFileSync(path)
    return {
      path: relative(seed, path).split(sep).join('/'),
      bytes: statSync(path).size,
      sha256: createHash('sha256').update(body).digest('hex'),
    }
  })
  writeFileSync(join(seed, 'integrity.json'), `${JSON.stringify({ schemaVersion: 2, files })}\n`)
}

function archiveStore(seed: string): void {
  const store = join(seed, 'store')
  mkdirSync(store, { recursive: true })
  if (readdirSync(store).length === 0) writeFileSync(join(store, 'test-entry'), 'content')
  archivePnpmStore(seed, store)
}

function writeCorePackageSet(seed: string, version: string, build = 'first'): void {
  const packages = [
    { name: '@deepseek-ai/dsh', file: `deepseek-ai-dsh-${version}.tgz`, body: Buffer.from(`dsh-${version}`) },
    {
      name: '@deepseek-ai/dsh-desktop-host',
      file: `deepseek-ai-dsh-desktop-host-${version}.tgz`,
      body: Buffer.from(`desktop-host-${version}-${build}`),
    },
  ]
  mkdirSync(join(seed, DESKTOP_PACKAGES_DIR), { recursive: true })
  for (const entry of packages) writeFileSync(join(seed, DESKTOP_PACKAGES_DIR, entry.file), entry.body)
  writeFileSync(join(seed, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify({
    schemaVersion: 1,
    packages: packages.map(({ name, file, body }) => ({
      name,
      version,
      file,
      bytes: body.byteLength,
      integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
    })),
  })}\n`)
}

function createTestSeedMetadata(seed: string, desktopRelease: DesktopRelease, build = 'first'): void {
  writeCorePackageSet(seed, desktopRelease.version, build)
  createSeedMetadata(seed, desktopRelease)
}

function writeFakePnpm(root: string): string {
  const path = join(root, 'pnpm.mjs')
  writeFileSync(path, String.raw`
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = process.argv.slice(2)
const project = process.cwd()
const command = args.find(value => value === 'install' || value === 'add' || value === 'remove')
const manifestPath = join(project, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const packageName = spec => spec.startsWith('@')
  ? spec.slice(0, spec.indexOf('@', spec.indexOf('/') + 1) === -1 ? undefined : spec.indexOf('@', spec.indexOf('/') + 1))
  : spec.split('@')[0]
const packageVersion = spec => {
  const index = spec.startsWith('@') ? spec.indexOf('@', spec.indexOf('/') + 1) : spec.indexOf('@')
  return index === -1 ? '1.0.0' : spec.slice(index + 1)
}

if (command === 'add') {
  const spec = args[args.indexOf('add') + 1]
  manifest.dependencies[packageName(spec)] = packageVersion(spec)
}
if (command === 'remove') delete manifest.dependencies[args[args.indexOf('remove') + 1]]
writeFileSync(manifestPath, JSON.stringify(manifest))
rmSync(join(project, 'node_modules'), { recursive: true, force: true })
for (const [name, version] of Object.entries(manifest.dependencies)) {
  const packageRoot = join(project, 'node_modules', ...name.split('/'))
  mkdirSync(packageRoot, { recursive: true })
  const core = name === '@deepseek-ai/dsh' || name === '@deepseek-ai/dsh-desktop-host'
  const plugin = !core
  const installedVersion = plugin
    ? version
    : JSON.parse(readFileSync(join(project, 'desktop-release.json'), 'utf8')).version
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name, version: installedVersion,
    ...(plugin ? { dsh: { bundle: { patch: './bundle.yml' } } } : {}),
  }))
  if (plugin) writeFileSync(join(packageRoot, 'bundle.yml'), '[]\n')
  else if (name === '@deepseek-ai/dsh-desktop-host') {
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'lib', 'index.js'), '')
  }
}
writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
if (process.env.TEST_PNPM_LOG) writeFileSync(process.env.TEST_PNPM_LOG, JSON.stringify({ args, env: process.env }))
`)
  return path
}

function writeBlockingFakePnpm(root: string, ready: string, release: string): string {
  const path = join(root, 'blocking-pnpm.mjs')
  const delegate = writeFakePnpm(root)
  writeFileSync(path, `
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
while (!existsSync(${JSON.stringify(release)})) await sleep(10)
await import(${JSON.stringify(pathToFileURL(delegate).href)})
`)
  return path
}

function hooks(overrides: Partial<DesktopProjectHooks> = {}): DesktopProjectHooks {
  return {
    healthCheck: async () => {},
    beforeActivate: async () => {},
    afterActivate: async () => {},
    ...overrides,
  }
}

function release(version = '1.0.0'): DesktopRelease {
  return {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: '24.17.0',
    pnpmVersion: '11.7.0',
  }
}

afterEach(async () => {
  const cleanups = releaseWorkers.splice(0)
  const directories = roots.splice(0)
  const results = await Promise.allSettled(cleanups.map(cleanup => cleanup()))
  for (const root of directories) rmSync(root, { recursive: true, force: true })
  const failures: unknown[] = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length > 0) throw new AggregateError(failures, 'desktop worker cleanup failed')
})

describe('desktop package policy', () => {
  it('accepts registry package specs but rejects alternate sources and flags', () => {
    expect(packageNameFromSpec('@scope/plugin@1.2.3')).toBe('@scope/plugin')
    expect(packageNameFromSpec('plugin@next')).toBe('plugin')
    expect(() => packageNameFromSpec('file:../plugin')).toThrow(/unsupported npm package spec/u)
    expect(() => packageNameFromSpec('--registry=evil')).toThrow(/unsupported npm package spec/u)
    expect(() => packageNameFromSpec('https://example.test/plugin.tgz')).toThrow(/unsupported npm package spec/u)
  })

  it('rejects any seed content changed after release inventory generation', () => {
    const seed = join(temporaryRoot(), 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeIntegrity(seed)
    expect(() => { verifySeedIntegrity(seed) }).not.toThrow()
    writeFileSync(join(seed, 'package.json'), '{}\n')
    expect(() => { verifySeedIntegrity(seed) }).toThrow(/integrity verification failed/u)
  })
})

describe('desktop project transactions', () => {
  it('installs the offline seed and reconciles a mismatched private Host', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const log = join(root, 'pnpm-log.json')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(seed, 'store'), { recursive: true })
    writeFileSync(join(seed, 'store', 'seed-entry'), 'content')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const previousLog = process.env.TEST_PNPM_LOG
    const previousRegistry = process.env.npm_config_registry
    process.env.TEST_PNPM_LOG = log
    process.env.npm_config_registry = 'https://user-registry.invalid'
    try {
      await expect(manager.applyRelease(seed, '2.0.0', hooks())).rejects.toThrow(/does not match Electron/u)
      await manager.applyRelease(seed, '1.0.0', hooks())
      writeFileSync(
        join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'),
        '{"name":"@deepseek-ai/dsh-desktop-host","version":"0.9.0"}\n',
      )
      await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(true)
    } finally {
      if (previousLog === undefined) delete process.env.TEST_PNPM_LOG
      else process.env.TEST_PNPM_LOG = previousLog
      if (previousRegistry === undefined) delete process.env.npm_config_registry
      else process.env.npm_config_registry = previousRegistry
    }
    expect(manager.dshVersion()).toBe('1.0.0')
    expect(manager.releaseVersion()).toBe('1.0.0')
    expect(paths.profile).toBe(join(root, '.dsh', 'profiles', 'desktop'))
    expect(existsSync(join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh'))).toBe(true)
    const installedHost = JSON.parse(readFileSync(
      join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'),
      'utf8',
    )) as { version: string }
    expect(installedHost.version).toBe('1.0.0')
    expect(existsSync(join(paths.profile, 'desktop-plugins.json'))).toBe(false)
    expect(readFileSync(join(paths.pnpm.store, 'seed-entry'), 'utf8')).toBe('content')
    const invocation = JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; env: Record<string, string> }
    expect(invocation.args).toContain('--offline')
    expect(invocation.args).toContain('--trust-lockfile')
    expect(invocation.args).toContain(`--config.store-dir=${paths.pnpm.store}`)
    expect(invocation.args).toContain('--config.enable-global-virtual-store=false')
    expect(invocation.args).toContain('--config.registry=https://registry.npmjs.org/')
    expect(invocation.env.NPM_CONFIG_REGISTRY).toBe('https://registry.npmjs.org/')
    expect(invocation.env.NPM_CONFIG_STORE_DIR).toBe(paths.pnpm.store)
    expect(invocation.env.NPM_CONFIG_USERCONFIG).toBe(join(paths.pnpm.config, 'npmrc'))
    expect(invocation.env.npm_config_registry).toBeUndefined()
  })

  it.each([
    { change: 'core tarball contents', build: 'other', target: release() },
    { change: 'bundled Node version', build: 'first', target: { ...release(), nodeVersion: '24.18.0' } },
    { change: 'bundled pnpm version', build: 'first', target: { ...release(), pnpmVersion: '11.8.0' } },
  ])('reconciles same-version $change and preserves plugins and shared data', async ({ build, target }) => {
    const root = temporaryRoot()
    const firstSeed = join(root, 'first-seed')
    const nextSeed = join(root, 'next-seed')
    for (const [seed, facts, content] of [[firstSeed, release(), 'first'], [nextSeed, target, build]] as const) {
      createTestSeedMetadata(seed, facts, content)
      writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      archiveStore(seed)
      writeIntegrity(seed)
    }
    const home = join(root, '.dsh')
    const paths = resolveDesktopPaths(home)
    const pnpm = writeFakePnpm(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm })
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    const previousDescriptor = readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))
    const previousRelease = readFileSync(join(paths.profile, 'desktop-release.json'))
    const previousManifest = readFileSync(join(paths.profile, 'package.json'))
    const settingsPath = join(home, 'settings.yaml')
    const sessionPath = join(home, 'sessions', 'retained.jsonl')
    mkdirSync(dirname(sessionPath), { recursive: true })
    writeFileSync(settingsPath, 'language: zh-CN\n')
    writeFileSync(sessionPath, 'retained Session bytes\n')
    const settingsBefore = readFileSync(settingsPath)
    const sessionBefore = readFileSync(sessionPath)
    const order: string[] = []
    await expect(manager.applyRelease(nextSeed, '1.0.0', hooks({
      healthCheck: async (staged) => {
        order.push('health')
        expect(readFileSync(join(paths.profile, 'package.json'))).toEqual(previousManifest)
        expect(readFileSync(join(staged, DESKTOP_PACKAGE_SET_FILE)))
          .toEqual(readFileSync(join(nextSeed, DESKTOP_PACKAGE_SET_FILE)))
      },
      beforeActivate: async () => { order.push('before') },
      afterActivate: async () => { order.push('after') },
    }))).resolves.toBe(true)
    expect(order).toEqual(['health', 'before', 'after'])
    expect(readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE)))
      .toEqual(readFileSync(join(nextSeed, DESKTOP_PACKAGE_SET_FILE)))
    expect(readFileSync(join(paths.profile, 'desktop-release.json')))
      .toEqual(readFileSync(join(nextSeed, 'desktop-release.json')))
    expect(readFileSync(join(paths.rollback, DESKTOP_PACKAGE_SET_FILE))).toEqual(previousDescriptor)
    expect(readFileSync(join(paths.rollback, 'desktop-release.json'))).toEqual(previousRelease)
    expect(manager.releaseVersion()).toBe('1.0.0')
    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    expect(readFileSync(settingsPath)).toEqual(settingsBefore)
    expect(readFileSync(sessionPath)).toEqual(sessionBefore)
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.lock)).toBe(false)

    // Identical reapplication must not start the package manager or activation hooks.
    writeFileSync(pnpm, 'process.exit(73)\n')
    const unexpected = async (): Promise<void> => { throw new Error('identical release entered activation') }
    await expect(manager.applyRelease(nextSeed, '1.0.0', {
      healthCheck: unexpected, beforeActivate: unexpected, afterActivate: unexpected,
    })).resolves.toBe(false)
  })

  it('retains the same-version active profile when rebuilt content fails its health check', async () => {
    const root = temporaryRoot()
    const firstSeed = join(root, 'first-seed')
    const nextSeed = join(root, 'next-seed')
    for (const [seed, build] of [[firstSeed, 'first'], [nextSeed, 'other']] as const) {
      createTestSeedMetadata(seed, release(), build)
      writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      archiveStore(seed)
      writeIntegrity(seed)
    }
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    const original = readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))
    const failHealth = async (): Promise<void> => { throw new Error('rebuilt backend unhealthy') }
    await expect(manager.applyRelease(nextSeed, '1.0.0', hooks({ healthCheck: failHealth })))
      .rejects.toThrow('rebuilt backend unhealthy')
    expect(readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))).toEqual(original)
    expect(manager.dshVersion()).toBe('1.0.0')
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('preserves the active profile when activation fails before moving it', async () => {
    const root = temporaryRoot()
    const firstSeed = join(root, 'first-seed')
    const nextSeed = join(root, 'next-seed')
    for (const [seed, build] of [[firstSeed, 'first'], [nextSeed, 'other']] as const) {
      createTestSeedMetadata(seed, release(), build)
      writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      archiveStore(seed)
      writeIntegrity(seed)
    }
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    const original = readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))
    mkdirSync(dirname(paths.rollback), { recursive: true })
    writeFileSync(paths.rollback, 'occupied rollback path')
    await expect(manager.applyRelease(nextSeed, '1.0.0', hooks())).rejects.toThrow(/owned directory path is not a directory/u)
    expect(readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))).toEqual(original)
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.rollback)).toBe(true)
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('keeps the previous journal parseable when an atomic step replacement fails', async () => {
    const root = temporaryRoot()
    const firstSeed = join(root, 'first-seed')
    const nextSeed = join(root, 'next-seed')
    for (const [seed, build] of [[firstSeed, 'first'], [nextSeed, 'other']] as const) {
      createTestSeedMetadata(seed, release(), build)
      writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      archiveStore(seed)
      writeIntegrity(seed)
    }
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    const original = readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))
    let transactionRoot: string | undefined
    await expect(manager.applyRelease(nextSeed, '1.0.0', hooks({
      beforeActivate: async () => {
        const pending = JSON.parse(readFileSync(paths.pending, 'utf8')) as { stagingProfile: string }
        transactionRoot = dirname(pending.stagingProfile)
        rmSync(transactionRoot, { recursive: true, force: true })
        writeFileSync(transactionRoot, 'block transaction cleanup')
        mkdirSync(`${paths.pending}.next`)
      },
    }))).rejects.toThrow(/cleanup was incomplete/u)

    expect(JSON.parse(readFileSync(paths.pending, 'utf8'))).toMatchObject({ step: 'prepared' })
    expect(readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))).toEqual(original)
    expect(transactionRoot).not.toBeUndefined()
    rmSync(`${paths.pending}.next`, { recursive: true, force: true })
    if (transactionRoot !== undefined) rmSync(transactionRoot, { force: true })
    await expect(manager.applyRelease(nextSeed, '1.0.0', hooks())).resolves.toBe(true)
    expect(existsSync(paths.pending)).toBe(false)
  })

  it('cleans owned orphan staging roots under the transaction lock', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const empty = join(paths.staging, '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be')
    const withStore = join(paths.staging, '7d4e5c6b-1a2b-4c3d-8e9f-0123456789ab', 'store')
    mkdirSync(empty, { recursive: true })
    mkdirSync(withStore, { recursive: true })
    writeFileSync(join(withStore, 'residue'), 'orphan')
    const unknown = join(paths.staging, 'do-not-delete')
    mkdirSync(unknown, { recursive: true })
    await expect(manager.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/unexpected staging entry/u)
    expect(existsSync(unknown)).toBe(true)
    rmSync(unknown, { recursive: true, force: true })
    await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('rejects a journal whose UUID does not own its exact staging profile', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const journalId = '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be'
    const otherRoot = join(paths.staging, '7d4e5c6b-1a2b-4c3d-8e9f-0123456789ab')
    const stagingProfile = join(otherRoot, 'profile')
    mkdirSync(stagingProfile, { recursive: true })
    writeFileSync(join(stagingProfile, 'retain'), 'journal mismatch')
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: journalId,
      stagingProfile,
      step: 'prepared',
    })}\n`)

    await expect(manager.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/invalid activation journal/u)

    expect(readFileSync(join(stagingProfile, 'retain'), 'utf8')).toBe('journal mismatch')
    expect(manager.dshVersion()).toBe('1.0.0')
    expect(existsSync(paths.pending)).toBe(true)
  })

  it('rejects a journal path alias even when it resolves to the expected profile', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const journalId = '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be'
    const alias = `${join(paths.staging, journalId, 'link')}${sep}..${sep}profile`
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: journalId,
      stagingProfile: alias,
      step: 'prepared',
    })}\n`)

    await expect(manager.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/invalid activation journal/u)

    expect(manager.dshVersion()).toBe('1.0.0')
    expect(existsSync(paths.pending)).toBe(true)
  })

  it('restores the active project when the replacement backend cannot start', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    let starts = 0
    await expect(manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks({
      afterActivate: async () => {
        starts += 1
        if (starts === 1) throw new Error('backend rejected staged graph')
      },
    }))).rejects.toThrow(/backend rejected staged graph/u)
    expect(manager.listPlugins()).toEqual([])
    expect(manager.dshVersion()).toBe('1.0.0')
    expect(starts).toBe(2)
  })

  it('keeps the committed profile when transaction-root cleanup is deferred', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let transactionRoot: string | undefined
    try {
      await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks({
        afterActivate: async () => {
          const pending = JSON.parse(readFileSync(paths.pending, 'utf8')) as { stagingProfile: string }
          transactionRoot = dirname(pending.stagingProfile)
          rmSync(transactionRoot, { recursive: true, force: true })
          writeFileSync(transactionRoot, 'defer this cleanup')
        },
      }))
      expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
      expect(existsSync(paths.pending)).toBe(false)
      expect(existsSync(paths.rollback)).toBe(true)
      expect(warning).toHaveBeenCalledWith(
        'desktop project: activation committed with deferred transaction cleanup',
        expect.any(AggregateError),
      )
    } finally {
      warning.mockRestore()
      if (transactionRoot !== undefined) rmSync(transactionRoot, { force: true })
    }
  })

  it('restores rollback when the active move completed before its journal update', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    const stagingProfile = join(paths.staging, '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be', 'profile')
    mkdirSync(stagingProfile, { recursive: true })
    writeFileSync(join(stagingProfile, 'marker'), 'staging')
    rmSync(paths.rollback, { recursive: true, force: true })
    mkdirSync(dirname(paths.rollback), { recursive: true })
    renameSync(paths.profile, paths.rollback)
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be',
      stagingProfile,
      step: 'prepared',
    })}\n`)

    await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)

    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    expect(existsSync(stagingProfile)).toBe(false)
    expect(existsSync(paths.pending)).toBe(false)
  })

  it('recovers an active-moved journal by restoring rollback', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    const transactionId = '8c2f6a4d-1b7e-45f9-a3d0-6e8b2c4f1a75'
    const stagingProfile = join(paths.staging, transactionId, 'profile')
    mkdirSync(stagingProfile, { recursive: true })
    writeFileSync(join(stagingProfile, 'staged'), 'new')
    rmSync(paths.rollback, { recursive: true, force: true })
    mkdirSync(dirname(paths.rollback), { recursive: true })
    renameSync(paths.profile, paths.rollback)
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      stagingProfile,
      step: 'active-moved',
    })}\n`)

    await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)

    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    expect(existsSync(paths.rollback)).toBe(false)
    expect(existsSync(paths.pending)).toBe(false)
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('recovers a staging-activated journal by restoring rollback', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const original = readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))
    const transactionRoot = join(paths.staging, '9c4d7e2a-6f1b-4a8c-b3d5-0e2f7a9c1b6d')
    const stagingProfile = join(transactionRoot, 'profile')
    renameSync(paths.profile, paths.rollback)
    mkdirSync(paths.profile, { recursive: true })
    writeFileSync(join(paths.profile, 'unexpected-active'), 'new')
    mkdirSync(stagingProfile, { recursive: true })
    writeFileSync(join(stagingProfile, 'staged'), 'new')
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: '9c4d7e2a-6f1b-4a8c-b3d5-0e2f7a9c1b6d',
      stagingProfile,
      step: 'staging-activated',
    })}\n`)

    await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)

    expect(readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))).toEqual(original)
    expect(existsSync(paths.rollback)).toBe(false)
    expect(existsSync(paths.pending)).toBe(false)
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('retains the active profile when recovering a committed journal', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    const transactionId = '3e7b16f5-4c2a-49d8-a1e6-8f0b5c7d2a94'
    const transactionRoot = join(paths.staging, transactionId)
    const stagingProfile = join(transactionRoot, 'profile')
    mkdirSync(transactionRoot, { recursive: true })
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      stagingProfile,
      step: 'committed',
    })}\n`)

    await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)

    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    expect(existsSync(paths.rollback)).toBe(true)
    expect(existsSync(paths.pending)).toBe(false)
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('records the live pnpm worker as transaction owner until it exits', async ({ task, signal }) => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const ready = join(root, 'pnpm-ready')
    const releaseWorker = join(root, 'pnpm-release')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const runtime = { node: process.execPath, pnpm: writeBlockingFakePnpm(root, ready, releaseWorker) }
    const manager = new DesktopProjectManager(paths, runtime)
    const installing = manager.applyRelease(seed, '1.0.0', hooks())
    // Teardown observes failures even if the runner has abandoned the test body.
    const completed = installing.then(value => ({ value }), (error: unknown) => ({ error }))
    releaseWorkers.push(async () => {
      writeFileSync(releaseWorker, 'continue')
      const outcome = await completed
      if ('error' in outcome) throw outcome.error
    })
    // Child startup shares the test budget; an aborted poll must not resume ownership assertions.
    await expect.poll(() => {
      signal.throwIfAborted()
      return existsSync(ready)
    }, { timeout: task.timeout }).toBe(true)
    signal.throwIfAborted()
    const workerPid = Number.parseInt(readFileSync(ready, 'utf8'), 10)
    expect(readFileSync(paths.lock, 'utf8')).toBe(`${String(workerPid)}\n`)
    const orphan = join(paths.staging, '2a6d8f4c-3b1e-47a9-b5c0-8e2f6a4d1b73')
    mkdirSync(orphan, { recursive: true })
    const competing = new DesktopProjectManager(paths, runtime)
    await expect(competing.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/another package transaction is active/u)
    expect(existsSync(orphan)).toBe(true)
    writeFileSync(releaseWorker, 'continue')
    await expect(installing).resolves.toBe(true)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('keeps core packages local while installing plugins from the desktop registry', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const log = join(root, 'pnpm-log.json')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const previousLog = process.env.TEST_PNPM_LOG
    process.env.TEST_PNPM_LOG = log
    try {
      await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    } finally {
      if (previousLog === undefined) delete process.env.TEST_PNPM_LOG
      else process.env.TEST_PNPM_LOG = previousLog
    }

    const manifest = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const coreSpec = manifest.dependencies['@deepseek-ai/dsh']
    expect(coreSpec).toMatch(/^file:\.\/desktop-packages\//u)
    expect(readFileSync(join(paths.profile, 'pnpm-workspace.yaml'), 'utf8'))
      .toContain(`${JSON.stringify('@deepseek-ai/dsh')}: ${JSON.stringify(coreSpec)}`)
    expect(manifest.dependencies['@scope/plugin']).toBe('2.0.0')
    const invocation = JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; env: Record<string, string> }
    expect(invocation.args).toContain('add')
    expect(invocation.args).toContain('@scope/plugin@2.0.0')
    expect(invocation.args).toContain('--config.registry=https://registry.npmjs.org/')
    expect(invocation.env.NPM_CONFIG_REGISTRY).toBe('https://registry.npmjs.org/')
  })

  it('reconciles dsh to the packaged release without removing desktop plugins', async () => {
    const root = temporaryRoot()
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const firstSeed = join(root, 'seed-1')
    createTestSeedMetadata(firstSeed, release('1.0.0'))
    writeFileSync(join(firstSeed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(firstSeed, 'store'), { recursive: true })
    writeFileSync(join(firstSeed, 'store', 'release-1'), 'one')
    archiveStore(firstSeed)
    writeIntegrity(firstSeed)
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())

    const nextSeed = join(root, 'seed-2')
    createTestSeedMetadata(nextSeed, release('1.1.0'))
    writeFileSync(join(nextSeed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(nextSeed, 'store'), { recursive: true })
    writeFileSync(join(nextSeed, 'store', 'release-2'), 'two')
    archiveStore(nextSeed)
    writeIntegrity(nextSeed)

    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(true)
    expect(manager.releaseVersion()).toBe('1.1.0')
    expect(manager.dshVersion()).toBe('1.1.0')
    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    const profile = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(profile.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@scope/plugin',
    ])
    expect(readFileSync(join(paths.pnpm.store, 'release-1'), 'utf8')).toBe('one')
    expect(readFileSync(join(paths.pnpm.store, 'release-2'), 'utf8')).toBe('two')
    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(false)
  })
})
