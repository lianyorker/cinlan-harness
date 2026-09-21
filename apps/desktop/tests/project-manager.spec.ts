import { createHash } from 'node:crypto'
import {
  existsSync, lstatSync, mkdtempSync, mkdirSync, promises as filesystem, readFileSync, readdirSync,
  renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import {
  createDevelopmentProjectMetadata,
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
import { checkDesktopStartupHost } from '../src/startup-probe.ts'

const desktopBundles = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-cinlan-browser',
  '@deepseek-ai/dsh-cinlan-computer-use',
  '@deepseek-ai/dsh-web-capability-defaults',
]
const legacyDesktopBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
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

function setProfileBundles(project: string, bundles: readonly string[]): void {
  const path = join(project, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dsh: { profile: { bundles: readonly string[] } } }
  manifest.dsh.profile.bundles = bundles
  writeFileSync(path, `${JSON.stringify(manifest)}\n`)
}

function profileBundles(project: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
    dsh: { profile: { bundles: string[] } }
  }
  return manifest.dsh.profile.bundles
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
  for (const spec of args.slice(args.indexOf('add') + 1)) {
    if (spec.startsWith('--')) break
    manifest.dependencies[packageName(spec)] = packageVersion(spec)
  }
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
  it('writes all five default bundles into seed and development metadata', () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const development = join(root, 'development')
    createTestSeedMetadata(seed, release())
    createDevelopmentProjectMetadata(development, release())
    expect(profileBundles(seed)).toEqual(desktopBundles)
    expect(profileBundles(development)).toEqual(desktopBundles)
  })

  it('carries explicit denials for optional native seed scripts', () => {
    const seed = join(temporaryRoot(), 'seed')
    createTestSeedMetadata(seed, release())
    const workspace = readFileSync(join(seed, 'pnpm-workspace.yaml'), 'utf8')
    for (const packageName of ['electron-winstaller', 'msgpackr-extract', 'cpu-features', 'ssh2']) {
      expect(workspace).toContain('  ' + packageName + ': false')
    }
  })

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
  it.each([
    { targetVersion: '1.0.0', withPlugins: false },
    { targetVersion: '1.0.0', withPlugins: true },
    { targetVersion: '1.1.0', withPlugins: false },
    { targetVersion: '1.1.0', withPlugins: true },
  ])('migrates legacy defaults to $targetVersion with plugins=$withPlugins through staging', async ({ targetVersion, withPlugins }) => {
    const root = temporaryRoot()
    const firstSeed = join(root, 'first-seed')
    const nextSeed = join(root, 'next-seed')
    for (const [seed, version] of [[firstSeed, '1.0.0'], [nextSeed, targetVersion]] as const) {
      createTestSeedMetadata(seed, release(version))
      writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      writeFileSync(join(seed, 'cordis.patch.yml'), '[]\n')
      archiveStore(seed)
      writeIntegrity(seed)
    }
    const paths = resolveDesktopPaths(root)
    const pnpm = writeFakePnpm(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm })
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    const plugins = withPlugins
      ? [{ name: '@scope/plugin', version: '2.3.4' }, { name: 'another-plugin', version: '7.8.9' }]
      : []
    for (const plugin of plugins) {
      await manager.mutate({ type: 'plugin-add', spec: `${plugin.name}@${plugin.version}` }, hooks())
    }
    const legacyBundles = [...legacyDesktopBundles, ...plugins.map(plugin => plugin.name)]
    setProfileBundles(paths.profile, legacyBundles)
    const patch = Buffer.from('# Keep custom web selection\r\n- id: web-search\r\n  disabled: false\r\n')
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), patch)
    const original = readFileSync(join(paths.profile, 'package.json'))
    expect(manager.listPlugins()).toEqual(plugins)
    const healthCheck = vi.fn(async (staged: string) => {
      expect(staged).not.toBe(paths.profile)
      expect(readFileSync(join(paths.profile, 'package.json'))).toEqual(original)
      expect(profileBundles(staged)).toEqual([...desktopBundles, ...plugins.map(plugin => plugin.name)])
      expect(readFileSync(join(staged, 'cordis.patch.yml'))).toEqual(patch)
    })
    await expect(manager.applyRelease(nextSeed, targetVersion, hooks({ healthCheck }))).resolves.toBe(true)
    expect(healthCheck).toHaveBeenCalledOnce()
    expect(manager.releaseVersion()).toBe(targetVersion)
    expect(manager.listPlugins()).toEqual(plugins)
    expect(profileBundles(paths.profile)).toEqual([...desktopBundles, ...plugins.map(plugin => plugin.name)])
    expect(readFileSync(join(paths.rollback, 'package.json'))).toEqual(original)
    expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
    expect(readFileSync(join(paths.rollback, 'cordis.patch.yml'))).toEqual(patch)
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.lock)).toBe(false)

    writeFileSync(pnpm, 'process.exit(73)\n')
    const unexpected = async (): Promise<void> => { throw new Error('current defaults entered activation') }
    await expect(manager.applyRelease(nextSeed, targetVersion, {
      healthCheck: unexpected, beforeActivate: unexpected, afterActivate: unexpected,
    })).resolves.toBe(false)
    expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
  })

  it.each(['health', 'activation'] as const)('preserves the legacy profile when same-version migration fails during %s', async (failure) => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    setProfileBundles(paths.profile, [...legacyDesktopBundles, '@scope/plugin'])
    const patch = Buffer.from('# Saved patch\r\n- id: saved-row\r\n  disabled: true\r\n')
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), patch)
    const original = readFileSync(join(paths.profile, 'package.json'))
    const afterActivate = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('migration activation failed'))
      .mockResolvedValueOnce(undefined)
    await expect(manager.applyRelease(seed, '1.0.0', hooks(failure === 'health' ? {
      healthCheck: async (staged) => {
        expect(profileBundles(staged)).toEqual([...desktopBundles, '@scope/plugin'])
        throw new Error('migration health failed')
      },
    } : { afterActivate }))).rejects.toThrow(`migration ${failure} failed`)
    if (failure === 'activation') expect(afterActivate).toHaveBeenCalledTimes(2)
    expect(readFileSync(join(paths.profile, 'package.json'))).toEqual(original)
    expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it.each([
    { name: 'missing base', bundles: desktopBundles.slice(1) },
    { name: 'reordered legacy prefix', bundles: [...legacyDesktopBundles].reverse() },
    { name: 'incomplete current prefix', bundles: desktopBundles.slice(0, 4) },
    { name: 'interleaved plugin', bundles: [...legacyDesktopBundles, '@scope/plugin', ...desktopBundles.slice(2)] },
    { name: 'duplicate legacy default', bundles: [...legacyDesktopBundles, '@deepseek-ai/dsh-base'] },
    { name: 'duplicate current default', bundles: [...desktopBundles, '@deepseek-ai/dsh-web-capability-defaults'] },
    { name: 'duplicate plugin', bundles: [...legacyDesktopBundles, '@scope/plugin', '@scope/plugin'] },
  ])('rejects $name instead of reusing or migrating the profile', async ({ bundles }) => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const pnpm = writeFakePnpm(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm })
    await manager.applyRelease(seed, '1.0.0', hooks())
    setProfileBundles(paths.profile, bundles)
    const original = readFileSync(join(paths.profile, 'package.json'))
    writeFileSync(pnpm, 'process.exit(73)\n')
    expect(() => manager.listPlugins()).toThrow(/profile.*(?:bundle|duplicate)/u)
    await expect(manager.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/profile.*(?:bundle|duplicate)/u)
    expect(readFileSync(join(paths.profile, 'package.json'))).toEqual(original)
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it.each(['missing package', 'non-bundle package'] as const)('rejects a legacy plugin tail with a %s', async (invalid) => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    setProfileBundles(paths.profile, [...legacyDesktopBundles, '@scope/plugin'])
    if (invalid === 'non-bundle package') {
      const plugin = join(paths.profile, 'node_modules', '@scope', 'plugin')
      mkdirSync(plugin, { recursive: true })
      writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: '@scope/plugin', version: '2.0.0' }))
    }
    await expect(manager.applyRelease(seed, '1.0.0', hooks()))
      .rejects.toThrow(/has no manifest|does not declare dsh.bundle.patch/u)
    expect(profileBundles(paths.profile)).toEqual([...legacyDesktopBundles, '@scope/plugin'])
    expect(existsSync(paths.pending)).toBe(false)
  })

  it('preserves saved row patches through plugin install, update, and removal', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const patch = Buffer.from('# Saved row overrides\r\n- id: saved-row\r\n  disabled: true\r\n')
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), patch)
    const healthCheck = vi.fn(async (staged: string) => {
      expect(readFileSync(join(staged, 'cordis.patch.yml'))).toEqual(patch)
    })
    for (const mutation of [
      { type: 'plugin-add', spec: '@scope/plugin@2.0.0' },
      { type: 'plugin-update', name: '@scope/plugin', version: '3.0.0' },
      { type: 'plugin-remove', name: '@scope/plugin' },
    ] as const) {
      await manager.mutate(mutation, hooks({ healthCheck }))
      expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
      expect(readFileSync(join(paths.rollback, 'cordis.patch.yml'))).toEqual(patch)
    }
    expect(healthCheck).toHaveBeenCalledTimes(3)
    expect(manager.listPlugins()).toEqual([])
  })

  it('reports performed startup stages and skips install stages for an identical verified release', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const manager = new DesktopProjectManager(resolveDesktopPaths(root), { node: process.execPath, pnpm: writeFakePnpm(root) })
    const stages: string[] = []
    await manager.applyRelease(seed, '1.0.0', hooks(), { checkpoint: (stage) => { stages.push(stage) } })
    expect(stages).toEqual(['recovering', 'verifying', 'extracting', 'installing', 'checking', 'activating'])
    stages.length = 0
    await expect(manager.applyRelease(seed, '1.0.0', hooks(), { checkpoint: (stage) => { stages.push(stage) } })).resolves.toBe(false)
    expect(stages).toEqual(['recovering', 'verifying'])
  })

  it('reuses verified packages without reading the unused installer archives', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const pnpm = writeFakePnpm(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm })
    await manager.applyRelease(seed, '1.0.0', hooks())
    rmSync(join(seed, 'store-archives'), { recursive: true })
    writeFileSync(pnpm, 'process.exit(73)\n')
    const unexpected = async (): Promise<void> => { throw new Error('reused profile entered activation') }
    await expect(manager.applyRelease(seed, '1.0.0', {
      healthCheck: unexpected, beforeActivate: unexpected, afterActivate: unexpected,
    })).resolves.toBe(false)
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.lock)).toBe(false)

    // A version difference requires the installer kit, including its complete inventory.
    writeFileSync(join(paths.profile, 'desktop-release.json'), `${JSON.stringify(release('0.9.0'))}\n`)
    await expect(manager.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/integrity verification failed/u)
    expect(manager.releaseVersion()).toBe('0.9.0')
  })

  it.each(['seed', 'active'] as const)('rejects corrupted %s core tarballs before reusing a matching version', async (location) => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    writeFileSync(join(location === 'seed' ? seed : paths.profile, DESKTOP_PACKAGES_DIR, 'deepseek-ai-dsh-1.0.0.tgz'), 'corrupted')
    await expect(manager.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/integrity/u)
    expect(existsSync(paths.pending)).toBe(false)
  })

  it('lets an in-flight installer exit before canceled startup releases its lock and staging', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const ready = join(root, 'installer-ready')
    const finish = join(root, 'installer-finish')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeBlockingFakePnpm(root, ready, finish) })
    const cancellation = new AbortController()
    const health = vi.fn(async () => {})
    const installing = manager.applyRelease(seed, '1.0.0', hooks({ healthCheck: health }), {
      checkpoint: () => { cancellation.signal.throwIfAborted() },
    })
    const outcome = installing.catch((error: unknown) => error)
    releaseWorkers.push(async () => { writeFileSync(finish, 'finish'); await outcome })
    await expect.poll(() => existsSync(ready)).toBe(true)
    const pid = Number(readFileSync(ready, 'utf8'))
    cancellation.abort(new Error('startup closed'))
    expect(readFileSync(paths.lock, 'utf8').trim()).toBe(String(pid))
    expect(() => process.kill(pid, 0)).not.toThrow()
    writeFileSync(finish, 'finish')
    expect(await outcome).toMatchObject({ message: 'startup closed' })
    expect(health).not.toHaveBeenCalled()
    expect(() => process.kill(pid, 0)).toThrow()
    expect(existsSync(paths.lock)).toBe(false)
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.profile)).toBe(false)
    expect(readdirSync(paths.staging).length).toBeGreaterThan(0)
    await manager.cleanupOrphanedStaging()
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('holds the lock and staged profile while a failed health-check stop is retried', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const cancellation = new AbortController()
    let retrying!: () => void
    let closeHost!: () => void
    const retry = new Promise<void>((done) => { retrying = done })
    const closed = new Promise<void>((done) => { closeHost = done })
    let staged = ''
    const stop = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Host did not exit'))
      .mockImplementation(() => closed)
    const applying = manager.applyRelease(seed, '1.0.0', hooks({
      healthCheck: async (projectDir) => {
        staged = projectDir
        await checkDesktopStartupHost({
          start: async () => ({ protocolVersion: 4, dshVersion: 'fixture' }), stop,
        }, cancellation.signal, () => { retrying() })
      },
    }))
    const outcome = applying.catch((error: unknown) => error)
    releaseWorkers.push(async () => { closeHost(); await outcome })
    await retry
    cancellation.abort(new Error('startup closed during cleanup'))
    expect(readFileSync(paths.lock, 'utf8').trim()).toBe(String(process.pid))
    expect(existsSync(join(staged, 'node_modules'))).toBe(true)
    expect(existsSync(paths.profile)).toBe(false)
    expect(stop).toHaveBeenCalledOnce()
    closeHost()
    expect(await outcome).toMatchObject({ message: 'startup closed during cleanup' })
    expect(stop).toHaveBeenCalledTimes(2)
    expect(existsSync(paths.lock)).toBe(false)
    expect(existsSync(staged)).toBe(true)
    await manager.cleanupOrphanedStaging()
    expect(existsSync(staged)).toBe(false)
    expect(readdirSync(paths.staging)).toEqual([])
  })

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
    const patch = Buffer.from('# Saved row overrides\n- id: saved-row\n  disabled: true\n')
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), patch)
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
        expect(readFileSync(join(staged, 'cordis.patch.yml'))).toEqual(patch)
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
    expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
    expect(readFileSync(join(paths.rollback, 'cordis.patch.yml'))).toEqual(patch)
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
    expect(readdirSync(paths.staging).length).toBeGreaterThan(0)
    await manager.cleanupOrphanedStaging()
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
    let stops = 0
    await expect(manager.applyRelease(nextSeed, '1.0.0', hooks({
      beforeActivate: async () => {
        stops += 1
        if (stops === 2) throw new Error('replacement still running')
      },
      afterActivate: async () => { mkdirSync(`${paths.pending}.next`) },
    }))).rejects.toThrow(/cleanup was incomplete/u)

    expect(JSON.parse(readFileSync(paths.pending, 'utf8'))).toMatchObject({ step: 'staging-activated' })
    expect(readFileSync(join(paths.rollback, DESKTOP_PACKAGE_SET_FILE))).toEqual(original)
    expect(readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE)))
      .toEqual(readFileSync(join(nextSeed, DESKTOP_PACKAGE_SET_FILE)))
    rmSync(`${paths.pending}.next`, { recursive: true, force: true })
    await expect(manager.applyRelease(firstSeed, '1.0.0', hooks())).resolves.toBe(false)
    expect(readFileSync(join(paths.profile, DESKTOP_PACKAGE_SET_FILE))).toEqual(original)
    expect(existsSync(paths.pending)).toBe(false)
  })

  it('defers orphan staging validation and deletion until explicit maintenance', async () => {
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
    await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)
    expect(existsSync(empty)).toBe(true)
    expect(readFileSync(join(withStore, 'residue'), 'utf8')).toBe('orphan')
    await expect(manager.cleanupOrphanedStaging()).rejects.toThrow(/unexpected staging entry/u)
    expect(existsSync(unknown)).toBe(true)
    expect(existsSync(paths.lock)).toBe(false)
    rmSync(unknown, { recursive: true, force: true })
    await manager.cleanupOrphanedStaging()
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('clears the journal when its staging root cannot be removed', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const transactionId = '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be'
    const blocked = join(paths.staging, transactionId)
    mkdirSync(paths.staging, { recursive: true })
    writeFileSync(blocked, 'staging root is not a directory')
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      stagingProfile: join(blocked, 'profile'),
      step: 'prepared',
    })}\n`)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)
      expect(warning).not.toHaveBeenCalled()
      expect(existsSync(paths.pending)).toBe(false)
      await manager.cleanupOrphanedStaging()
      expect(warning).toHaveBeenCalledWith('desktop project: deferred orphan staging cleanup', expect.any(Error))
    } finally {
      warning.mockRestore()
    }
    expect(readFileSync(blocked, 'utf8')).toBe('staging root is not a directory')
  })

  it('defers an orphan staging root that cannot be removed', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const orphan = join(paths.staging, '2a6d8f4c-3b1e-47a9-b5c0-8e2f6a4d1b73')
    writeFileSync(orphan, 'orphan is not a directory')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)
      expect(warning).not.toHaveBeenCalled()
      await manager.cleanupOrphanedStaging()
      expect(warning).toHaveBeenCalledWith('desktop project: deferred orphan staging cleanup', expect.any(Error))
    } finally {
      warning.mockRestore()
    }
    expect(readFileSync(orphan, 'utf8')).toBe('orphan is not a directory')
  })

  it('leaves a locked orphan for later maintenance and removes the other roots', async () => {
    const paths = resolveDesktopPaths(temporaryRoot())
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: 'unused' })
    const locked = join(paths.staging, '2a6d8f4c-3b1e-47a9-b5c0-8e2f6a4d1b73')
    const removable = join(paths.staging, '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be')
    mkdirSync(locked, { recursive: true })
    mkdirSync(removable, { recursive: true })
    writeFileSync(join(locked, 'retained'), 'locked file')
    const denied = Object.assign(new Error('staging file is locked'), { code: 'EPERM' })
    const remove = filesystem.rm
    const removal = vi.spyOn(filesystem, 'rm').mockImplementation(async (path, options) => {
      expect(readFileSync(paths.lock, 'utf8').trim()).toBe(String(process.pid))
      if (path === locked) throw denied
      await remove(path, options)
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(manager.cleanupOrphanedStaging()).resolves.toBeUndefined()
      expect(readFileSync(join(locked, 'retained'), 'utf8')).toBe('locked file')
      expect(existsSync(removable)).toBe(false)
      expect(existsSync(paths.lock)).toBe(false)
      expect(warning).toHaveBeenCalledExactlyOnceWith('desktop project: deferred orphan staging cleanup', denied)
    } finally {
      removal.mockRestore()
      warning.mockRestore()
    }
    await manager.cleanupOrphanedStaging()
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('joins an in-flight removal before canceled maintenance releases its lock', async () => {
    const paths = resolveDesktopPaths(temporaryRoot())
    const runtime = { node: process.execPath, pnpm: 'unused' }
    const manager = new DesktopProjectManager(paths, runtime)
    for (const id of ['2a6d8f4c-3b1e-47a9-b5c0-8e2f6a4d1b73', '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be']) {
      mkdirSync(join(paths.staging, id), { recursive: true })
    }
    let beginRemoval!: () => void
    let finishRemoval!: () => void
    const removing = new Promise<void>((done) => { beginRemoval = done })
    const released = new Promise<void>((done) => { finishRemoval = done })
    const remove = filesystem.rm
    const removal = vi.spyOn(filesystem, 'rm').mockImplementation(async (path, options) => {
      beginRemoval()
      await released
      await remove(path, options)
    })
    const cancellation = new AbortController()
    const reason = new Error('desktop is quitting')
    const cleanup = manager.cleanupOrphanedStaging(cancellation.signal)
    const outcome = cleanup.catch((error: unknown) => error)
    releaseWorkers.push(async () => { finishRemoval(); await outcome })
    try {
      await removing
      cancellation.abort(reason)
      expect(readFileSync(paths.lock, 'utf8').trim()).toBe(String(process.pid))
      expect(readdirSync(paths.staging)).toHaveLength(2)
      const competing = new DesktopProjectManager(paths, runtime)
      await expect(competing.cleanupOrphanedStaging()).rejects.toThrow(/another package transaction is active/u)
      await expect(competing.mutate({ type: 'plugin-remove', name: 'unused' }, hooks()))
        .rejects.toThrow(/another package transaction is active/u)
      finishRemoval()
      expect(await outcome).toBe(reason)
      expect(removal).toHaveBeenCalledOnce()
      expect(readdirSync(paths.staging)).toHaveLength(1)
      expect(existsSync(paths.lock)).toBe(false)
    } finally {
      finishRemoval()
      await outcome
      removal.mockRestore()
    }
  })

  it('unlinks orphan junctions without deleting their targets', async () => {
    const root = temporaryRoot()
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: 'unused' })
    const target = join(root, 'retained')
    const nested = join(paths.staging, '2a6d8f4c-3b1e-47a9-b5c0-8e2f6a4d1b73')
    const linked = join(paths.staging, '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be')
    const dangling = join(paths.staging, '7d4e5c6b-1a2b-4c3d-8e9f-0123456789ab')
    mkdirSync(target)
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(target, 'marker'), 'retain target bytes')
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    symlinkSync(target, linked, linkType)
    symlinkSync(target, join(nested, 'link'), linkType)
    symlinkSync(join(root, 'missing-target'), dangling, linkType)
    expect(lstatSync(dangling).isSymbolicLink()).toBe(true)
    await manager.cleanupOrphanedStaging()
    expect(readdirSync(paths.staging)).toEqual([])
    expect(readFileSync(join(target, 'marker'), 'utf8')).toBe('retain target bytes')
  })

  it('refuses to traverse a replaced staging root', async () => {
    const root = temporaryRoot()
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: 'unused' })
    const target = join(root, 'retained')
    const retained = join(target, '2a6d8f4c-3b1e-47a9-b5c0-8e2f6a4d1b73')
    mkdirSync(retained, { recursive: true })
    mkdirSync(paths.root, { recursive: true })
    writeFileSync(join(retained, 'marker'), 'retain target bytes')
    symlinkSync(target, paths.staging, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(manager.cleanupOrphanedStaging()).rejects.toThrow(/staging root is not a real directory/u)
    expect(readFileSync(join(retained, 'marker'), 'utf8')).toBe('retain target bytes')
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('leaves unresolved journals and their profiles untouched during maintenance', async () => {
    const paths = resolveDesktopPaths(temporaryRoot())
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: 'unused' })
    const staged = join(paths.staging, '2a6d8f4c-3b1e-47a9-b5c0-8e2f6a4d1b73', 'profile')
    for (const path of [paths.profile, paths.rollback, staged]) {
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'marker'), path)
    }
    writeFileSync(paths.pending, 'unresolved journal bytes')
    await manager.cleanupOrphanedStaging()
    for (const path of [paths.profile, paths.rollback, staged]) {
      expect(readFileSync(join(path, 'marker'), 'utf8')).toBe(path)
    }
    expect(readFileSync(paths.pending, 'utf8')).toBe('unresolved journal bytes')
    expect(existsSync(paths.lock)).toBe(false)
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
    const patch = Buffer.from('# Saved before mutation\n- id: saved-row\n  disabled: true\n')
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), patch)
    let starts = 0
    const order: string[] = []
    await expect(manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks({
      beforeActivate: async () => {
        order.push(starts === 0 ? 'stop-original' : 'stop-replacement')
        if (starts === 1) {
          expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
          expect(existsSync(paths.rollback)).toBe(true)
        }
      },
      afterActivate: async () => {
        starts += 1
        order.push(starts === 1 ? 'start-replacement' : 'start-original')
        expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
        if (starts === 1) throw new Error('backend rejected staged graph')
        expect(manager.listPlugins()).toEqual([])
      },
    }))).rejects.toThrow(/backend rejected staged graph/u)
    expect(manager.listPlugins()).toEqual([])
    expect(manager.dshVersion()).toBe('1.0.0')
    expect(order).toEqual(['stop-original', 'start-replacement', 'stop-replacement', 'start-original'])
    expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
    expect(existsSync(paths.pending)).toBe(false)
    const retired = readdirSync(paths.staging)
      .map(name => join(paths.staging, name, 'profile', 'node_modules', '@scope', 'plugin', 'package.json'))
      .filter(path => existsSync(path))
    expect(retired).toHaveLength(1)
    expect(JSON.parse(readFileSync(retired[0]!, 'utf8'))).toMatchObject({ name: '@scope/plugin', version: '2.0.0' })
    await manager.cleanupOrphanedStaging()
    expect(readdirSync(paths.staging)).toEqual([])
  })

  it('preserves both profiles and the journal when a failed replacement start cannot be stopped', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(root)
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const original = readFileSync(join(paths.profile, 'package.json'))
    const startFailure = new Error('replacement rejected startup')
    const stopFailure = new Error('replacement did not exit')
    const beforeActivate = vi.fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(stopFailure)
    const afterActivate = vi.fn<() => Promise<void>>().mockRejectedValue(startFailure)
    await expect(manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks({
      beforeActivate, afterActivate,
    }))).rejects.toMatchObject({ errors: [startFailure, stopFailure] })
    expect(beforeActivate).toHaveBeenCalledTimes(2)
    expect(afterActivate).toHaveBeenCalledOnce()
    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    expect(readFileSync(join(paths.rollback, 'package.json'))).toEqual(original)
    expect(JSON.parse(readFileSync(paths.pending, 'utf8'))).toMatchObject({ step: 'staging-activated' })
    expect(existsSync(paths.lock)).toBe(false)
    const staged = readdirSync(paths.staging)
    await manager.cleanupOrphanedStaging()
    expect(readdirSync(paths.staging)).toEqual(staged)
    expect(existsSync(paths.pending)).toBe(true)
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
      expect(warning).not.toHaveBeenCalled()
      await manager.cleanupOrphanedStaging()
      expect(warning).toHaveBeenCalledWith('desktop project: deferred orphan staging cleanup', expect.any(Error))
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
    expect(readFileSync(join(stagingProfile, 'marker'), 'utf8')).toBe('staging')
    expect(existsSync(paths.pending)).toBe(false)
    await manager.cleanupOrphanedStaging()
    expect(existsSync(stagingProfile)).toBe(false)
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
    expect(readFileSync(join(stagingProfile, 'staged'), 'utf8')).toBe('new')
    await manager.cleanupOrphanedStaging()
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
    expect(readFileSync(join(stagingProfile, 'staged'), 'utf8')).toBe('new')
    const retired = readdirSync(paths.staging)
      .map(name => join(paths.staging, name, 'profile', 'unexpected-active'))
      .filter(path => existsSync(path))
    expect(retired).toHaveLength(1)
    expect(readFileSync(retired[0]!, 'utf8')).toBe('new')
    await manager.cleanupOrphanedStaging()
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
    expect(existsSync(transactionRoot)).toBe(true)
    await manager.cleanupOrphanedStaging()
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

    const patch = Buffer.from('# Saved row overrides\n- id: saved-row\n  disabled: true\n')
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), patch)
    const nextSeed = join(root, 'seed-2')
    createTestSeedMetadata(nextSeed, release('1.1.0'))
    writeFileSync(join(nextSeed, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(nextSeed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(nextSeed, 'store'), { recursive: true })
    writeFileSync(join(nextSeed, 'store', 'release-2'), 'two')
    archiveStore(nextSeed)
    writeIntegrity(nextSeed)

    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(true)
    expect(manager.releaseVersion()).toBe('1.1.0')
    expect(readFileSync(join(paths.profile, 'cordis.patch.yml'))).toEqual(patch)
    expect(readFileSync(join(paths.rollback, 'cordis.patch.yml'))).toEqual(patch)
    expect(manager.dshVersion()).toBe('1.1.0')
    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    const profile = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(profile.dsh.profile.bundles).toEqual([...desktopBundles, '@scope/plugin'])
    expect(readFileSync(join(paths.pnpm.store, 'release-1'), 'utf8')).toBe('one')
    expect(readFileSync(join(paths.pnpm.store, 'release-2'), 'utf8')).toBe('two')
    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(false)
  })
})

describe('native fatal profile repair', () => {
  it('backs up the profile patch under the activation lock while preserving packages and reload settings', async () => {
    const paths = resolveDesktopPaths(temporaryRoot())
    mkdirSync(paths.profile, { recursive: true })
    const manifest = { private: true, dependencies: { 'broken-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['broken-plugin'], patchReload: 'live' } }, custom: 'retained' }
    writeFileSync(join(paths.profile, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), ': invalid patch')
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: 'unused' })
    const backup = await manager.disableThirdPartyPlugins()
    expect(backup).toBeDefined()
    expect(readFileSync(backup!, 'utf8')).toBe(': invalid patch')
    expect(JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8'))).toEqual({ ...manifest,
      dsh: { profile: { bundles: desktopBundles, patchReload: 'live' } } })
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('refuses repair while activation recovery is unresolved', async () => {
    const paths = resolveDesktopPaths(temporaryRoot())
    mkdirSync(paths.profile, { recursive: true })
    mkdirSync(paths.root, { recursive: true })
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), 'retained')
    writeFileSync(paths.pending, '{}')
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: 'unused' })
    await expect(manager.disableThirdPartyPlugins()).rejects.toThrow('invalid activation journal')
    expect(readFileSync(join(paths.profile, 'cordis.patch.yml'), 'utf8')).toBe('retained')
    expect(existsSync(paths.pending)).toBe(true)
  })
})
