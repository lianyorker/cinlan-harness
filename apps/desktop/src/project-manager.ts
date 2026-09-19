/** Transactional owner of the reserved desktop profile and its private pnpm state. */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  promises as filesystem,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import {
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  desktopDshPackageSpec,
  readDesktopCorePackageSet,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import { parseDesktopRelease, type DesktopRelease } from './release.ts'
import { extractPnpmStoreArchives, mergePnpmStore } from './seed-store.ts'

/** Files the package transaction copies between active and staging projects. */
const DESKTOP_PROJECT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'desktop-release.json',
  DESKTOP_PACKAGE_SET_FILE,
] as const

/** Desktop plugin record derived from the installed profile. */
export interface DesktopPluginRecord {
  readonly name: string
  readonly version: string
}

/** Installed desktop project manifest slice. */
interface DesktopProjectManifest {
  readonly name: string
  readonly private: true
  readonly version: string
  readonly dependencies: Record<string, string>
  readonly dsh: {
    readonly profile: {
      readonly bundles: string[]
    }
  }
}

/** Journaled activation step used for crash recovery. */
interface DesktopPendingTransaction {
  readonly schemaVersion: 1
  readonly id: string
  readonly stagingProfile: string
  readonly step: 'prepared' | 'active-moved' | 'staging-activated' | 'committed'
}

/** Exact executables the desktop shell bundles. */
export interface DesktopRuntimeExecutables {
  readonly node: string
  readonly pnpm: string
}

/** Hooks that bind project replacement to backend lifecycle and health. */
export interface DesktopProjectHooks {
  /** Prove the staged dependency graph while the active backend is stopped. */
  healthCheck(projectDir: string): Promise<void>
  /** Stop the active backend and await process exit before directory moves. */
  beforeActivate(): Promise<void>
  /** Start the selected active project after commit or rollback. */
  afterActivate(): Promise<void>
}

/** Safe cancellation checkpoints occur outside activation's journaled directory replacement. */
export interface DesktopReleasePreparation {
  /** Report the next operation; throwing cancels before it begins and still releases the transaction lock. */
  checkpoint(stage: 'recovering' | 'verifying' | 'extracting' | 'installing' | 'checking' | 'activating'): void
}

/** Supported dependency mutation. */
export type DesktopProjectMutation =
  | { readonly type: 'plugin-add'; readonly spec: string }
  | { readonly type: 'plugin-remove'; readonly name: string }
  | { readonly type: 'plugin-update'; readonly name: string; readonly version: string }

interface DesktopSeedIntegrityRecord {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

const PROJECT_NAME = '@deepseek-ai/dsh-desktop-runtime'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\nstrictDepBuilds: true\n'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u
const MAX_PNPM_DIAGNOSTIC_BYTES = 64 * 1024
const DESKTOP_REGISTRY = 'https://registry.npmjs.org/'
const WINDOWS_FILESYSTEM_RETRY_ATTEMPTS = 20
const WINDOWS_FILESYSTEM_RETRY_DELAY_MS = 100
const TRANSACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function workspaceFile(overrides: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = entries.length === 0
    ? ''
    : `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  const coreBuildSpec = overrides[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

function releaseFile(projectDir: string): DesktopRelease {
  return parseDesktopRelease(readJson(join(projectDir, 'desktop-release.json')))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertPackageName(name: string): void {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error(`desktop project: invalid npm package name ${JSON.stringify(name)}`)
}

function assertVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) throw new Error(`desktop project: invalid exact version ${JSON.stringify(version)}`)
}

/**
 * Validate one registry package spec and return its requested package name when explicit.
 * @param spec - npm registry name with an optional version or tag.
 * @returns package name, or undefined when the spec's final name is registry-resolved.
 */
export function packageNameFromSpec(spec: string): string | undefined {
  if (spec === '' || spec.startsWith('-') || /[\s\\]/u.test(spec) || spec.includes('://') || spec.startsWith('file:')) {
    throw new Error(`desktop project: unsupported npm package spec ${JSON.stringify(spec)}`)
  }
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    if (slash === -1) throw new Error(`desktop project: invalid scoped package spec ${JSON.stringify(spec)}`)
    const versionAt = spec.indexOf('@', slash)
    const name = versionAt === -1 ? spec : spec.slice(0, versionAt)
    assertPackageName(name)
    if (versionAt !== -1) assertVersion(spec.slice(versionAt + 1))
    return name
  }
  const versionAt = spec.indexOf('@')
  const name = versionAt === -1 ? spec : spec.slice(0, versionAt)
  assertPackageName(name)
  if (versionAt !== -1) assertVersion(spec.slice(versionAt + 1))
  return name
}

function isRetryableFilesystemError(reason: unknown): boolean {
  if (process.platform !== 'win32' || typeof reason !== 'object' || reason === null) return false
  const code = (reason as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EPERM'
}

async function retryFilesystem(operation: () => void | Promise<void>, description: string): Promise<void> {
  const attempts = process.platform === 'win32' ? WINDOWS_FILESYSTEM_RETRY_ATTEMPTS : 1
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await operation()
      return
    } catch (error) {
      lastError = error
      if (!isRetryableFilesystemError(error) || attempt + 1 >= attempts) throw error
      await sleep(WINDOWS_FILESYSTEM_RETRY_DELAY_MS)
    }
  }
  throw errorOf(lastError, `desktop project: failed to ${description}`)
}

async function renameOwnedDirectory(source: string, target: string): Promise<void> {
  await retryFilesystem(() => { renameSync(source, target) }, `move ${source} to ${target}`)
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function atomicJsonTemporary(path: string): string {
  return `${path}.next`
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporary = atomicJsonTemporary(path)
  await retryFilesystem(() => { unlinkIfPresent(temporary) }, `remove ${temporary}`)
  let descriptor: number | undefined
  let operationFailed = false
  let operationError: unknown
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify(value, undefined, 2)}\n`)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    await retryFilesystem(() => { renameSync(temporary, path) }, `replace ${path}`)
  } catch (error) {
    operationFailed = true
    operationError = error
    throw error
  } finally {
    const cleanupErrors: unknown[] = []
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    try {
      await retryFilesystem(() => { unlinkIfPresent(temporary) }, `remove ${temporary}`)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    if (cleanupErrors.length > 0) {
      if (operationFailed) {
        throw new AggregateError([operationError, ...cleanupErrors], `desktop project: failed to replace ${path}`)
      }
      throw new AggregateError(cleanupErrors, `desktop project: replacement cleanup failed for ${path}`)
    }
  }
}

function copyMetadata(source: string, target: string): void {
  mkdirSync(target, { recursive: true, mode: 0o700 })
  for (const filename of DESKTOP_PROJECT_FILES) {
    const from = join(source, filename)
    if (existsSync(from)) copyFileSync(from, join(target, filename), constants.COPYFILE_EXCL)
  }
  cpSync(join(source, DESKTOP_PACKAGES_DIR), join(target, DESKTOP_PACKAGES_DIR), {
    recursive: true,
    force: false,
    errorOnExist: true,
  })
}

function seedFiles(root: string): readonly DesktopSeedIntegrityRecord[] {
  const files: DesktopSeedIntegrityRecord[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = path.slice(root.length + 1).split(sep).join('/')
      if (relativePath === 'integrity.json') continue
      if (entry.isSymbolicLink()) throw new Error(`desktop seed: symbolic link is not allowed: ${relativePath}`)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) throw new Error(`desktop seed: unsupported file type: ${relativePath}`)
      const body = readFileSync(path)
      files.push({
        path: relativePath,
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      })
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/** Verify the packaged offline seed before any content enters writable desktop state. */
export function verifySeedIntegrity(seedDir: string): void {
  const integrityPath = join(seedDir, 'integrity.json')
  const integrity = readJson(integrityPath)
  if (!isRecord(integrity) || integrity.schemaVersion !== 2 || !Array.isArray(integrity.files)) {
    throw new Error(`desktop seed: invalid integrity inventory ${integrityPath}`)
  }
  const expected: DesktopSeedIntegrityRecord[] = integrity.files.map((record) => {
    if (!isRecord(record) || typeof record.path !== 'string' || record.path === '' || record.path.startsWith('/')
      || record.path.split('/').includes('..') || typeof record.bytes !== 'number'
      || !Number.isSafeInteger(record.bytes) || record.bytes < 0
      || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(record.sha256)) {
      throw new Error(`desktop seed: invalid integrity record in ${integrityPath}`)
    }
    return { path: record.path, bytes: record.bytes, sha256: record.sha256 }
  }).sort((left, right) => left.path.localeCompare(right.path))
  const actual = seedFiles(seedDir)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('desktop seed: integrity verification failed')
  }
}

function projectManifest(projectDir: string): DesktopProjectManifest {
  const path = join(projectDir, 'package.json')
  const value = readJson(path)
  const dsh = isRecord(value) && isRecord(value.dsh) ? value.dsh : undefined
  const profile = isRecord(dsh?.profile) ? dsh.profile : undefined
  if (!isRecord(value) || value.name !== PROJECT_NAME || value.private !== true
    || typeof value.version !== 'string' || !isRecord(value.dependencies)
    || !Array.isArray(profile?.bundles) || !profile.bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error(`desktop project: invalid desktop profile manifest ${path}`)
  }
  const manifest = value as unknown as DesktopProjectManifest
  const packageSet = readDesktopCorePackageSet(projectDir, releaseFile(projectDir).version)
  const expectedOverrides = desktopCorePackageOverrides(packageSet)
  if (manifest.dependencies[DSH_PACKAGE] !== desktopDshPackageSpec(packageSet)
    || Object.entries(expectedOverrides).some(([name, spec]) => manifest.dependencies[name] !== spec)
    || readFileSync(join(projectDir, 'pnpm-workspace.yaml'), 'utf8') !== workspaceFile(expectedOverrides)) {
    throw new Error(`desktop project: core package mapping does not match ${DESKTOP_PACKAGE_SET_FILE}`)
  }
  return manifest
}

function profilePluginNames(projectDir: string): readonly string[] {
  const bundles = projectManifest(projectDir).dsh.profile.bundles
  if (!DESKTOP_PROFILE_BUNDLES.every((bundle, index) => bundles[index] === bundle)) {
    throw new Error('desktop project: profile must begin with the built-in desktop bundle list')
  }
  const plugins = bundles.slice(DESKTOP_PROFILE_BUNDLES.length)
  if (new Set(bundles).size !== bundles.length) {
    throw new Error('desktop project: profile bundle list contains a duplicate package')
  }
  for (const plugin of plugins) assertPackageName(plugin)
  return plugins
}

function pluginRecords(projectDir: string): readonly DesktopPluginRecord[] {
  return profilePluginNames(projectDir).map(name => inspectPlugin(projectDir, name))
}

function writeProfilePlugins(projectDir: string, plugins: readonly DesktopPluginRecord[]): void {
  const manifest = projectManifest(projectDir)
  writeJson(join(projectDir, 'package.json'), {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh.profile,
        bundles: [...DESKTOP_PROFILE_BUNDLES, ...plugins.map(plugin => plugin.name)],
      },
    },
  } satisfies DesktopProjectManifest)
}

function inspectPlugin(projectDir: string, requestedName: string): DesktopPluginRecord {
  const manifestPath = join(projectDir, 'node_modules', ...requestedName.split('/'), 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`desktop project: installed package ${JSON.stringify(requestedName)} has no manifest`)
  }
  const manifest = readJson(manifestPath)
  if (!isRecord(manifest) || manifest.name !== requestedName || typeof manifest.version !== 'string') {
    throw new Error(`desktop project: installed package ${JSON.stringify(requestedName)} has inconsistent name or version`)
  }
  const dsh = manifest.dsh
  const bundle = isRecord(dsh) ? dsh.bundle : undefined
  const patch = isRecord(bundle) ? bundle.patch : undefined
  if (typeof patch !== 'string' || patch === '') {
    throw new Error(`desktop project: ${requestedName}@${manifest.version} does not declare dsh.bundle.patch`)
  }
  const packageDir = dirname(manifestPath)
  const patchPath = resolve(packageDir, patch)
  if ((patchPath !== packageDir && !patchPath.startsWith(packageDir + sep)) || !existsSync(patchPath)) {
    throw new Error(`desktop project: ${requestedName}@${manifest.version} declares an invalid bundle patch`)
  }
  return { name: requestedName, version: manifest.version }
}

/** Transactional desktop npm project manager. */
export class DesktopProjectManager {
  private lockDescriptor: number | undefined

  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - absolute bundled Node.js and pnpm entry paths.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: DesktopRuntimeExecutables,
  ) {}

  /** Recover an interrupted directory replacement while the package transaction lock is held. */
  private async recover(): Promise<void> {
    await retryFilesystem(
      () => { unlinkIfPresent(atomicJsonTemporary(this.paths.pending)) },
      `remove ${atomicJsonTemporary(this.paths.pending)}`,
    )
    if (existsSync(this.paths.pending)) {
      const value = readJson(this.paths.pending)
      const expectedStagingProfile = isRecord(value) && typeof value.id === 'string'
        ? join(this.paths.staging, value.id, 'profile')
        : undefined
      if (!isRecord(value) || value.schemaVersion !== 1
        || typeof value.id !== 'string' || !TRANSACTION_ID_PATTERN.test(value.id)
        || typeof value.stagingProfile !== 'string' || value.stagingProfile !== expectedStagingProfile
        || (value.step !== 'prepared' && value.step !== 'active-moved'
          && value.step !== 'staging-activated' && value.step !== 'committed')) {
        throw new Error(`desktop project: invalid activation journal ${this.paths.pending}`)
      }
      const pending: DesktopPendingTransaction = {
        schemaVersion: 1,
        id: value.id,
        stagingProfile: join(this.paths.staging, value.id, 'profile'),
        step: value.step,
      }
      if (pending.step === 'prepared' || pending.step === 'committed') {
        if (!existsSync(this.paths.profile) && existsSync(this.paths.rollback)) {
          mkdirSync(dirname(this.paths.profile), { recursive: true, mode: 0o700 })
          await renameOwnedDirectory(this.paths.rollback, this.paths.profile)
        }
      } else if (existsSync(this.paths.rollback)) {
        await this.retireOwnedDirectory(this.paths.profile)
        mkdirSync(dirname(this.paths.profile), { recursive: true, mode: 0o700 })
        await renameOwnedDirectory(this.paths.rollback, this.paths.profile)
      }
      await retryFilesystem(() => { unlinkIfPresent(this.paths.pending) }, `remove ${this.paths.pending}`)
    }
  }

  /**
   * Remove orphan UUID staging roots asynchronously after the desktop UI is ready.
   * Holds the transaction lock until started filesystem work settles and skips deletion while a journal exists.
   * Rejects an unavailable lock, an unsafe staging root, or an unknown entry; logs individual removal failures.
   * @param signal - Optional cancellation between roots; an in-flight removal finishes before rejection.
   * @returns Completion after releasing the lock; rollback profiles remain untouched.
   */
  async cleanupOrphanedStaging(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await this.withLock(async () => {
      signal?.throwIfAborted()
      if (lstatSync(this.paths.pending, { throwIfNoEntry: false }) !== undefined) return
      let staging
      try {
        staging = await filesystem.lstat(this.paths.staging)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      if (staging.isSymbolicLink() || !staging.isDirectory()) {
        throw new Error(`desktop project: staging root is not a real directory: ${this.paths.staging}`)
      }
      for (const entry of await filesystem.readdir(this.paths.staging, { withFileTypes: true })) {
        signal?.throwIfAborted()
        if (!TRANSACTION_ID_PATTERN.test(entry.name)) {
          throw new Error(`desktop project: unexpected staging entry ${JSON.stringify(entry.name)}`)
        }
        const path = join(this.paths.staging, entry.name)
        try {
          await retryFilesystem(async () => {
            let stat
            try {
              stat = await filesystem.lstat(path)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
              throw error
            }
            if (stat.isSymbolicLink()) await filesystem.unlink(path)
            else if (stat.isDirectory()) await filesystem.rm(path, { recursive: true, force: true })
            else throw new Error(`desktop project: owned directory path is not a directory: ${path}`)
          }, `remove ${path}`)
        } catch (cleanupError) {
          console.warn('desktop project: deferred orphan staging cleanup', cleanupError)
        }
      }
      signal?.throwIfAborted()
    })
  }

  /** Read the active desktop plugin inventory. */
  listPlugins(): readonly DesktopPluginRecord[] {
    if (!existsSync(this.paths.profile)) return []
    return pluginRecords(this.paths.profile)
  }

  /** Read the exact dsh version installed in the active desktop project. */
  dshVersion(): string {
    if (!existsSync(this.paths.profile)) throw new Error('desktop project: active profile is not installed')
    return this.installedPackageVersion(DSH_PACKAGE)
  }

  private installedPackageVersion(packageName: string): string {
    const manifestPath = join(this.paths.profile, 'node_modules', ...packageName.split('/'), 'package.json')
    const manifest = readJson(manifestPath)
    if (!isRecord(manifest) || typeof manifest.version !== 'string') {
      throw new Error(`desktop project: installed ${packageName} package has no version`)
    }
    assertVersion(manifest.version)
    return manifest.version
  }

  /** Read the release version applied to the active desktop project. */
  releaseVersion(): string {
    if (!existsSync(this.paths.profile)) throw new Error('desktop project: active profile is not installed')
    return releaseFile(this.paths.profile).version
  }

  /**
   * Reconcile release metadata and verified core packages; read the full seed inventory only before installation.
   * Unused staging roots remain for explicit maintenance after startup or failure.
   * @param seedDir - Packaged offline seed containing release metadata, tarballs, and store archives.
   * @param electronVersion - Exact application version that the seed must match.
   * @param hooks - Backend health and lifecycle operations for staged activation.
   * @param preparation - Optional operation reporting and cooperative cancellation outside activation.
   * @returns Whether a staged profile was activated; equal versions with different content still reconcile.
   */
  async applyRelease(
    seedDir: string,
    electronVersion: string,
    hooks: DesktopProjectHooks,
    preparation?: DesktopReleasePreparation,
  ): Promise<boolean> {
    return this.withLock(async () => {
      preparation?.checkpoint('recovering')
      await this.recover()
      preparation?.checkpoint('verifying')
      const target = releaseFile(seedDir)
      const targetPackages = verifyDesktopCorePackageSet(seedDir, target.version)
      if (target.version !== electronVersion) {
        throw new Error(`desktop project: seed ${target.version} does not match Electron ${electronVersion}`)
      }
      const activeRelease = existsSync(this.paths.profile) ? releaseFile(this.paths.profile) : undefined
      if (activeRelease?.version === target.version
        && this.dshVersion() === target.version
        && this.installedPackageVersion(DESKTOP_HOST_PACKAGE) === target.version) {
        const activePackages = verifyDesktopCorePackageSet(this.paths.profile, target.version)
        if (isDeepStrictEqual(activeRelease, target)
          && isDeepStrictEqual(activePackages, targetPackages)) return false
      }
      // Store archives are installer inputs; profile reuse still verifies both core package sets.
      verifySeedIntegrity(seedDir)
      preparation?.checkpoint('extracting')
      this.mergeSeedPnpmState(seedDir)
      preparation?.checkpoint('installing')
      const stagingProfile = this.newStagingProfile()
      const plugins = existsSync(this.paths.profile) ? pluginRecords(this.paths.profile) : []
      copyMetadata(seedDir, stagingProfile)
      await this.runPnpm(stagingProfile, ['install', '--offline', '--frozen-lockfile', '--trust-lockfile'])
      if (plugins.length > 0) {
        preparation?.checkpoint('installing')
        await this.runPnpm(stagingProfile, [
          'add',
          ...plugins.map(plugin => `${plugin.name}@${plugin.version}`),
          '--save-exact',
          '--offline',
        ])
        writeProfilePlugins(stagingProfile, plugins)
      }
      preparation?.checkpoint('checking')
      await hooks.healthCheck(stagingProfile)
      preparation?.checkpoint('activating')
      await this.activate(stagingProfile, hooks)
      return true
    })
  }

  /**
   * Apply one exact dependency mutation through a staging project.
   * Unused transaction roots remain for explicit maintenance after completion or failure.
   */
  async mutate(mutation: DesktopProjectMutation, hooks: DesktopProjectHooks): Promise<void> {
    await this.withLock(async () => {
      await this.recover()
      if (!existsSync(this.paths.profile)) throw new Error('desktop project: active profile is not installed')
      verifyDesktopCorePackageSet(this.paths.profile, this.releaseVersion())
      const stagingProfile = this.newStagingProfile()
      copyMetadata(this.paths.profile, stagingProfile)
      await this.applyMutation(stagingProfile, mutation)
      await hooks.healthCheck(stagingProfile)
      await this.activate(stagingProfile, hooks)
    })
  }

  private newStagingRoot(): string {
    mkdirSync(this.paths.staging, { recursive: true, mode: 0o700 })
    const staging = lstatSync(this.paths.staging)
    if (staging.isSymbolicLink() || !staging.isDirectory()) {
      throw new Error(`desktop project: staging root is not a real directory: ${this.paths.staging}`)
    }
    const path = join(this.paths.staging, randomUUID())
    mkdirSync(path, { mode: 0o700 })
    return path
  }

  private newStagingProfile(): string {
    const path = join(this.newStagingRoot(), 'profile')
    mkdirSync(path, { mode: 0o700 })
    return path
  }

  /** Vacate an owned profile path without recursively deleting it during activation or recovery. */
  private async retireOwnedDirectory(path: string): Promise<void> {
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat === undefined) return
    if (stat.isSymbolicLink()) {
      await retryFilesystem(() => { unlinkIfPresent(path) }, `remove ${path}`)
      return
    }
    if (!stat.isDirectory()) throw new Error(`desktop project: owned directory path is not a directory: ${path}`)
    await renameOwnedDirectory(path, join(this.newStagingRoot(), 'profile'))
  }

  private async applyMutation(projectDir: string, mutation: DesktopProjectMutation): Promise<void> {
    switch (mutation.type) {
      case 'plugin-add': {
        const requestedName = packageNameFromSpec(mutation.spec)
        if (requestedName === undefined) throw new Error('desktop project: plugin package name is required')
        await this.runPnpm(projectDir, ['add', mutation.spec, '--save-exact'])
        const installed = inspectPlugin(projectDir, requestedName)
        const current = pluginRecords(projectDir).filter(plugin => plugin.name !== installed.name)
        writeProfilePlugins(
          projectDir,
          [...current, installed].sort((left, right) => left.name.localeCompare(right.name)),
        )
        return
      }
      case 'plugin-remove': {
        assertPackageName(mutation.name)
        if (!profilePluginNames(projectDir).includes(mutation.name)) {
          throw new Error(`desktop project: plugin ${JSON.stringify(mutation.name)} is not installed`)
        }
        const remaining = pluginRecords(projectDir).filter(plugin => plugin.name !== mutation.name)
        await this.runPnpm(projectDir, ['remove', mutation.name])
        writeProfilePlugins(projectDir, remaining)
        return
      }
      case 'plugin-update':
        assertPackageName(mutation.name)
        assertVersion(mutation.version)
        if (!profilePluginNames(projectDir).includes(mutation.name)) {
          throw new Error(`desktop project: plugin ${JSON.stringify(mutation.name)} is not installed`)
        }
        await this.runPnpm(projectDir, ['add', `${mutation.name}@${mutation.version}`, '--save-exact'])
        {
          const installed = inspectPlugin(projectDir, mutation.name)
          writeProfilePlugins(
            projectDir,
            pluginRecords(projectDir).map(plugin => plugin.name === installed.name ? installed : plugin),
          )
        }
        return
      default:
        mutation satisfies never
    }
  }

  private mergeSeedPnpmState(seedDir: string): void {
    const extractedStore = join(this.newStagingRoot(), 'store')
    extractPnpmStoreArchives(seedDir, extractedStore)
    mergePnpmStore(extractedStore, this.paths.pnpm.store)
  }

  private async activate(stagingProfile: string, hooks: DesktopProjectHooks): Promise<void> {
    const pending: DesktopPendingTransaction = {
      schemaVersion: 1,
      id: basename(dirname(stagingProfile)),
      stagingProfile,
      step: 'prepared',
    }
    await writeJsonAtomically(this.paths.pending, pending)
    let beforeActivateCompleted = false
    let activeMoved = false
    let stagingActivated = false
    let afterActivateStarted = false
    const hadActiveProfile = existsSync(this.paths.profile)
    try {
      await hooks.beforeActivate()
      beforeActivateCompleted = true
      await this.retireOwnedDirectory(this.paths.rollback)
      mkdirSync(dirname(this.paths.rollback), { recursive: true, mode: 0o700 })
      await writeJsonAtomically(
        this.paths.pending,
        { ...pending, step: 'active-moved' } satisfies DesktopPendingTransaction,
      )
      if (existsSync(this.paths.profile)) {
        await renameOwnedDirectory(this.paths.profile, this.paths.rollback)
        activeMoved = true
      }
      mkdirSync(dirname(this.paths.profile), { recursive: true, mode: 0o700 })
      await writeJsonAtomically(
        this.paths.pending,
        { ...pending, step: 'staging-activated' } satisfies DesktopPendingTransaction,
      )
      await renameOwnedDirectory(stagingProfile, this.paths.profile)
      stagingActivated = true
      afterActivateStarted = true
      await hooks.afterActivate()
      await writeJsonAtomically(
        this.paths.pending,
        { ...pending, step: 'committed' } satisfies DesktopPendingTransaction,
      )
      try {
        await retryFilesystem(() => { unlinkIfPresent(this.paths.pending) }, `remove ${this.paths.pending}`)
      } catch (cleanupError) {
        console.warn('desktop project: activation committed with deferred journal cleanup', cleanupError)
      }
    } catch (error) {
      const cleanupErrors: unknown[] = []
      let backendStopped = !afterActivateStarted
      if (afterActivateStarted) {
        try {
          await hooks.beforeActivate()
          backendStopped = true
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (backendStopped && stagingActivated) {
        try {
          await this.retireOwnedDirectory(this.paths.profile)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (backendStopped && activeMoved && existsSync(this.paths.rollback)) {
        try {
          await renameOwnedDirectory(this.paths.rollback, this.paths.profile)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      const restored = backendStopped && (
        !hadActiveProfile
        || (!activeMoved && existsSync(this.paths.profile))
        || (activeMoved && existsSync(this.paths.profile) && !existsSync(this.paths.rollback))
      )
      if (restored && cleanupErrors.length === 0 && existsSync(this.paths.pending)) {
        try {
          await retryFilesystem(() => { unlinkIfPresent(this.paths.pending) }, `remove ${this.paths.pending}`)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (restored && beforeActivateCompleted && hadActiveProfile) {
        try {
          await hooks.afterActivate()
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError([error, ...cleanupErrors], 'desktop project: activation failed and cleanup was incomplete')
      }
      throw error
    }
  }

  private async runPnpm(projectDir: string, args: readonly string[]): Promise<void> {
    const [command, ...commandArgs] = args
    if (command === undefined) throw new Error('desktop project: pnpm command is required')
    for (const path of [this.paths.root, this.paths.pnpm.store, this.paths.pnpm.cache,
      this.paths.pnpm.state, this.paths.pnpm.config, this.paths.pnpm.home]) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    const npmrc = join(this.paths.pnpm.config, 'npmrc')
    if (!existsSync(npmrc)) writeFileSync(npmrc, '', { mode: 0o600 })
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
      !/^DSH_DESKTOP_/u.test(name) && !/^(?:npm|pnpm|corepack)_/iu.test(name)
    )))
    await new Promise<void>((settle, reject) => {
      const child = spawn(this.runtime.node, [
        this.runtime.pnpm,
        `--config.registry=${DESKTOP_REGISTRY}`,
        `--config.store-dir=${this.paths.pnpm.store}`,
        '--config.enable-global-virtual-store=false',
        `--config.userconfig=${npmrc}`,
        command,
        ...commandArgs,
      ], {
        cwd: projectDir,
        env: {
          ...inherited,
          COREPACK_HOME: this.paths.pnpm.home,
          NPM_CONFIG_REGISTRY: DESKTOP_REGISTRY,
          NPM_CONFIG_STORE_DIR: this.paths.pnpm.store,
          NPM_CONFIG_USERCONFIG: npmrc,
          PATH: `${dirname(this.runtime.node)}${delimiter}${process.env.PATH ?? ''}`,
          PNPM_HOME: this.paths.pnpm.home,
          XDG_CACHE_HOME: this.paths.pnpm.cache,
          XDG_CONFIG_HOME: this.paths.pnpm.config,
          XDG_STATE_HOME: this.paths.pnpm.state,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let failure: Error | undefined
      let diagnostics = ''
      const appendDiagnostics = (chunk: string): void => {
        diagnostics = (diagnostics + chunk).slice(-MAX_PNPM_DIAGNOSTIC_BYTES)
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', appendDiagnostics)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', appendDiagnostics)
      child.once('error', (error) => { failure = error })
      child.once('close', (code, signal) => {
        // Keep the transaction lock and staging tree until even a failed spawn has closed its pipes.
        try {
          this.writeLockOwner(process.pid)
        } catch (error) {
          reject(errorOf(error, 'desktop project: failed to return the package transaction lock to Electron'))
          return
        }
        if (failure !== undefined) reject(failure)
        else if (code === 0) settle()
        else reject(new Error(
          `desktop project: pnpm exited with ${String(code ?? signal)}${diagnostics.trim() === '' ? '' : `: ${diagnostics.trim()}`}`,
        ))
      })
      const childPid = child.pid
      if (childPid === undefined) {
        failure = new Error('desktop project: pnpm did not report a process id')
      } else {
        try {
          this.writeLockOwner(childPid)
        } catch (error) {
          // Do not kill an installer between writes; wait for its close before releasing ownership.
          failure = errorOf(error, 'desktop project: failed to assign the package transaction lock to pnpm')
        }
      }
    })
  }

  private writeLockOwner(pid: number): void {
    const descriptor = this.lockDescriptor
    if (descriptor === undefined) throw new Error('desktop project: package transaction lost its lock')
    const content = Buffer.from(`${String(pid)}\n`)
    ftruncateSync(descriptor, 0)
    writeSync(descriptor, content, 0, content.byteLength, 0)
    fsyncSync(descriptor)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    mkdirSync(this.paths.root, { recursive: true, mode: 0o700 })
    let descriptor: number
    try {
      descriptor = openSync(this.paths.lock, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(this.paths.lock)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: package transaction lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(this.paths.lock, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another package transaction is active')
        await retryFilesystem(() => { unlinkIfPresent(this.paths.lock) }, `remove ${this.paths.lock}`)
        descriptor = openSync(this.paths.lock, 'wx', 0o600)
      } else {
        throw error
      }
    }
    let operationFailed = false
    let operationError: unknown
    try {
      this.lockDescriptor = descriptor
      this.writeLockOwner(process.pid)
      return await operation()
    } catch (error) {
      operationFailed = true
      operationError = error
      throw error
    } finally {
      this.lockDescriptor = undefined
      const cleanupErrors: unknown[] = []
      try {
        closeSync(descriptor)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      try {
        await retryFilesystem(() => { unlinkIfPresent(this.paths.lock) }, `remove ${this.paths.lock}`)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length > 0) {
        if (operationFailed) {
          throw new AggregateError([operationError, ...cleanupErrors], 'desktop project: transaction failed and lock cleanup was incomplete')
        }
        throw new AggregateError(cleanupErrors, 'desktop project: lock cleanup was incomplete')
      }
    }
  }
}

/** Create seed metadata for one exact Electron and dsh release. */
export function createSeedMetadata(seedDir: string, release: DesktopRelease): void {
  mkdirSync(seedDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(seedDir, release.version)
  const manifest: DesktopProjectManifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(seedDir, 'package.json'), manifest)
  writeFileSync(
    join(seedDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
  writeJson(join(seedDir, 'desktop-release.json'), release)
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [DSH_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
  writeJson(join(projectDir, 'desktop-release.json'), release)
}
