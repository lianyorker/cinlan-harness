/** Build one release target with matching Electron, Node.js, and seed architecture. */

import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import {
  desktopBuildRecordFilename,
  resolveDesktopAutoUpdateConfig,
} from './desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

const require = createRequire(import.meta.url)
const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const WINDOWS_SIGNING_ENV_PREFIX = 'DSH_DESKTOP_WINDOWS_'
const WINDOWS_SIGNING_ENV_NAMES = [
  'DSH_DESKTOP_WINDOWS_CER_FILE',
  'DSH_DESKTOP_WINDOWS_KEY_CONTAINER',
  'DSH_DESKTOP_WINDOWS_SIGNTOOL',
  'DSH_DESKTOP_WINDOWS_TOKEN_PIN',
] as const
const DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES = new Set([
  'DOWNLOAD_TEST_COS_SECRET_ID',
  'DOWNLOAD_TEST_COS_SECRET_KEY',
  'DOWNLOAD_PROD_COS_SECRET_ID',
  'DOWNLOAD_PROD_COS_SECRET_KEY',
])
const PNPM_DEPENDENCY_FILTER_ENV_NAMES = new Set([
  'pnpm_config_filter',
  'pnpm_config_filter_prod',
  'npm_config_filter',
  'npm_config_filter_prod',
])
const DESKTOP_PACKAGE_NAME = '@deepseek-ai/dsh-desktop'
const DESKTOP_RELEASE_RECORD_SCHEMA_VERSION = 2
type DesktopSigningMode = 'signed' | 'unsigned'

interface ArtifactPublicationOperations {
  readonly remove: (path: string, options?: { readonly recursive?: boolean; readonly force?: boolean }) => void
  readonly mkdir: (path: string, options?: { readonly recursive?: boolean }) => void
  readonly rename: (source: string, destination: string) => void
  readonly copy: (source: string, destination: string, options?: { readonly recursive?: boolean; readonly force?: boolean }) => void
  readonly readDirectory: (path: string) => readonly string[]
}

const defaultArtifactPublicationOperations: ArtifactPublicationOperations = {
  remove: (path, options) => rmSync(path, options),
  mkdir: (path, options) => mkdirSync(path, options),
  rename: renameSync,
  copy: (source, destination, options) => cpSync(source, destination, options),
  readDirectory: path => readdirSync(path, { encoding: 'utf8' }),
}

function isEmptyArtifactDirectory(path: string, operations: ArtifactPublicationOperations): boolean {
  try {
    return operations.readDirectory(path).length === 0
  }
  catch {
    return false
  }
}

function copyArtifactDirectoryContents(
  source: string,
  destination: string,
  operations: ArtifactPublicationOperations,
): void {
  for (const entry of operations.readDirectory(source)) {
    operations.copy(join(source, entry), join(destination, entry), { recursive: true, force: false })
  }
}

/**
 * Publish a completed electron-builder directory while preserving locked empty output roots.
 * @param completedOutput - Temporary directory produced by electron-builder.
 * @param artifactsDirectory - Stable target directory exposed to later packaging stages.
 * @param overrides - Optional filesystem operations used by focused publication tests.
 * @returns Nothing; the completed output is removed after a successful publication.
 * @throws When stale output cannot be removed or a copy/rename fails.
 */
export function publishCompletedArtifactDirectory(
  completedOutput: string,
  artifactsDirectory: string,
  overrides: Partial<ArtifactPublicationOperations> = {},
): void {
  const operations: ArtifactPublicationOperations = { ...defaultArtifactPublicationOperations, ...overrides }
  operations.mkdir(dirname(artifactsDirectory), { recursive: true })

  try {
    operations.remove(artifactsDirectory, { recursive: true, force: true })
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')
      || !isEmptyArtifactDirectory(artifactsDirectory, operations)) throw error
    copyArtifactDirectoryContents(completedOutput, artifactsDirectory, operations)
    operations.remove(completedOutput, { recursive: true, force: true })
    return
  }

  try {
    operations.rename(completedOutput, artifactsDirectory)
    return
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EXDEV') {
      operations.copy(completedOutput, artifactsDirectory, { recursive: true })
      operations.remove(completedOutput, { recursive: true, force: true })
      return
    }
    if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')
      || !isEmptyArtifactDirectory(artifactsDirectory, operations)) throw error
    copyArtifactDirectoryContents(completedOutput, artifactsDirectory, operations)
    operations.remove(completedOutput, { recursive: true, force: true })
  }
}

/** Fixed platform and architecture identifiers exposed by package scripts. */
export type DesktopPackageTargetName = 'mac-arm64' | 'mac-x64' | 'win-x64'

/** One supported release target and its electron-builder selectors. */
export interface DesktopPackageTarget {
  readonly name: DesktopPackageTargetName
  readonly platform: 'darwin' | 'win32'
  readonly arch: 'arm64' | 'x64'
  readonly builderPlatform: '--mac' | '--win'
  readonly builderArch: '--arm64' | '--x64'
}

const TARGETS: Record<DesktopPackageTargetName, DesktopPackageTarget> = {
  'mac-arm64': {
    name: 'mac-arm64',
    platform: 'darwin',
    arch: 'arm64',
    builderPlatform: '--mac',
    builderArch: '--arm64',
  },
  'mac-x64': {
    name: 'mac-x64',
    platform: 'darwin',
    arch: 'x64',
    builderPlatform: '--mac',
    builderArch: '--x64',
  },
  'win-x64': {
    name: 'win-x64',
    platform: 'win32',
    arch: 'x64',
    builderPlatform: '--win',
    builderArch: '--x64',
  },
}

/**
 * Remove Windows signing configuration from package preparation subprocesses.
 * @param environment - Packaging command environment.
 * @returns A copy without Windows signing fields.
 */
export function withoutWindowsSigningEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !name.startsWith(WINDOWS_SIGNING_ENV_PREFIX)))
}

/**
 * Remove upload-only COS credentials from every packaging subprocess.
 * @param environment - Packaging command environment.
 * @returns A copy without Desktop upload credentials.
 */
export function withoutDesktopUploadCredentials(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES.has(name)))
}

/**
 * Prevent pnpm script execution from repairing or reinstalling the validated workspace.
 * @param environment - Packaging command environment.
 * @returns A copy that disables pnpm's optional pre-run dependency mutation.
 */
export function stablePnpmRunEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(environment)
      .filter(([name]) => name.toLowerCase() !== 'pnpm_config_verify_deps_before_run')),
    pnpm_config_verify_deps_before_run: 'false',
  }
}

/**
 * Limit electron-builder's pnpm dependency listing to the desktop shell.
 * @param environment - Target environment before restoring Windows signing fields.
 * @returns A copy with one Desktop selector and no inherited dependency selectors.
 */
export function desktopElectronBuilderEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(environment)
      .filter(([name]) => !PNPM_DEPENDENCY_FILTER_ENV_NAMES.has(name.toLowerCase()))),
    pnpm_config_filter: DESKTOP_PACKAGE_NAME,
  }
}

function isTargetName(value: string): value is DesktopPackageTargetName {
  return Object.hasOwn(TARGETS, value)
}

function packageVersion(path: string, label: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`desktop package: ${label} has no version`)
  }
  return manifest.version
}

function writeReleaseRecord(
  target: DesktopPackageTarget,
  environment: NodeJS.ProcessEnv,
  artifactsRoot: string,
  signingMode: DesktopSigningMode,
): void {
  const desktopVersion = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const dshVersion = packageVersion(join(REPOSITORY_ROOT, 'package.json'), 'dsh package')
  if (desktopVersion !== dshVersion) {
    throw new Error(`desktop package: desktop version ${desktopVersion} does not match dsh version ${dshVersion}`)
  }
  const update = resolveDesktopAutoUpdateConfig(
    { ...environment, DOWNLOAD_TEST_ORIGIN: environment.DOWNLOAD_TEST_ORIGIN || 'https://desktop-updates.example.com' },
    target.platform,
    target.arch,
  )
  const recordPath = join(artifactsRoot, desktopBuildRecordFilename(target.name))
  const temporaryPath = `${recordPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify({
    schemaVersion: DESKTOP_RELEASE_RECORD_SCHEMA_VERSION,
    signingMode,
    target: target.name,
    version: dshVersion,
    environment: update.environment,
    publicUrl: update.publicUrl,
  }, null, 2)}\n`)
  renameSync(temporaryPath, recordPath)
}

/**
 * Resolve a named release target and reject hosts that cannot execute its packaged runtime.
 * @param name - One of the fixed Desktop release target names.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The target selectors shared by runtime preparation and electron-builder.
 */
export function resolveDesktopPackageTarget(
  name: string,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageTarget {
  if (!isTargetName(name)) {
    throw new Error(`desktop package: unsupported target ${JSON.stringify(name)}; expected ${Object.keys(TARGETS).join(', ')}`)
  }
  const target = TARGETS[name]
  if (target.platform === 'win32' && (hostPlatform !== 'win32' || hostArch !== 'x64')) {
    throw new Error('desktop package: win-x64 requires a Windows x64 build host')
  }
  if (target.platform === 'darwin' && hostPlatform !== 'darwin') {
    throw new Error(`desktop package: ${name} requires a macOS build host`)
  }
  if (name === 'mac-arm64' && hostArch !== 'arm64') {
    throw new Error('desktop package: mac-arm64 requires an Apple Silicon build host')
  }
  if (name === 'mac-x64' && hostArch !== 'arm64' && hostArch !== 'x64') {
    throw new Error('desktop package: mac-x64 requires an Intel Mac or Apple Silicon with Rosetta')
  }
  return target
}

interface DesktopPackageInvocation {
  readonly target: DesktopPackageTarget
  readonly directory: boolean
  readonly prepareOnly: boolean
  readonly unsigned: boolean
  readonly msi?: boolean
}

function hostTargetName(platform: NodeJS.Platform, arch: string): DesktopPackageTargetName {
  const name = `${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}-${arch}`
  if (!isTargetName(name)) throw new Error(`desktop package: unsupported build host ${platform}-${arch}`)
  return name
}

/**
 * Parse the fixed-target packaging command line.
 * @param argv - Arguments after the script entry point.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The validated target and whether to emit an unpacked directory.
 */
export function parseDesktopPackageInvocation(
  argv: readonly string[],
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageInvocation {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      dir: { type: 'boolean', default: false },
      'prepare-only': { type: 'boolean', default: false },
      unsigned: { type: 'boolean', default: false },
      msi: { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 1) throw new Error('desktop package: expected at most one target')
  const name = positionals[0] ?? hostTargetName(hostPlatform, hostArch)
  const target = resolveDesktopPackageTarget(name, hostPlatform, hostArch)
  if (values.unsigned && target.platform !== 'win32') {
    throw new Error('desktop package: --unsigned is supported only for win-x64')
  }
  if (values.msi && target.platform !== 'win32') {
    throw new Error('desktop package: --msi is supported only for win-x64')
  }
  if (values.msi && !values.unsigned) {
    throw new Error('desktop package: --msi requires --unsigned for local-only MSI output')
  }
  if (values.msi && (values.dir || values['prepare-only'])) {
    throw new Error('desktop package: --msi cannot be combined with --dir or --prepare-only')
  }
  return {
    target,
    directory: values.dir,
    prepareOnly: values['prepare-only'],
    unsigned: values.unsigned,
    msi: values.msi,
  }
}

/**
 * Reject signed Windows packaging without a complete credential declaration.
 * @param target - Validated Desktop target.
 * @param environment - Packaging environment.
 * @param unsigned - Whether the caller explicitly selected unsigned output.
 * @param prepareOnly - Whether only preparation stages will run.
 * @returns Nothing.
 * @throws When a Windows artifact would otherwise silently skip signing.
 */
export function assertWindowsSigningEnvironment(
  target: DesktopPackageTarget,
  environment: NodeJS.ProcessEnv,
  unsigned: boolean,
  prepareOnly: boolean,
): void {
  if (target.platform !== 'win32' || unsigned || prepareOnly) return
  const missing = WINDOWS_SIGNING_ENV_NAMES.filter((name) => {
    const value = environment[name]
    return value === undefined || value.trim() === ''
  })
  if (missing.length > 0) {
    throw new Error(`desktop package: signed Windows packaging requires ${missing.join(', ')}; use package:win:x64:unsigned for deliberate unsigned output`)
  }
}

/**
 * Build the electron-builder command arguments for one validated target.
 * @param target - Supported release target.
 * @param directory - Whether to stop at an unpacked application directory.
 * @returns Arguments that keep publishing under the separate validated upload command.
 */
export function desktopElectronBuilderArguments(
  target: DesktopPackageTarget,
  directory: boolean,
): readonly string[] {
  return [
    'node',
    require.resolve('electron-builder/out/cli/cli.js'),
    '--config',
    'electron-builder.config.mjs',
    target.builderPlatform,
    target.builderArch,
    '--publish',
    'never',
    ...(directory ? ['--dir'] : []),
  ]
}

function runPackageCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = APP_ROOT,
): Promise<void> {
  const nodeArgs = args[0] === 'node'
    ? args.slice(1)
    : [env.npm_execpath ?? join(dirname(require.resolve('pnpm')), 'bin/pnpm.mjs'), ...args]
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd,
      env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop package: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

/**
 * Assemble the existing runtime, package set and seed before creating a release artifact.
 * @param invocation - Validated target and packaging mode.
 * @param environment - Release environment, with credentials limited to signing stages.
 * @param execute - Package command runner; failures stop all later stages.
 * @returns Resolves after preparation or packaging completes.
 */
export async function packageTarget(
  invocation: DesktopPackageInvocation,
  environment: NodeJS.ProcessEnv = process.env,
  execute: typeof runPackageCommand = runPackageCommand,
): Promise<void> {
  const { target } = invocation
  const unsignedBuilder = invocation.unsigned || invocation.directory
  assertWindowsSigningEnvironment(target, environment, unsignedBuilder, invocation.prepareOnly)
  const buildPaths = desktopTargetBuildPaths(target.name)
  const releaseRecordPath = join(buildPaths.artifacts, desktopBuildRecordFilename(target.name))
  if (!invocation.prepareOnly) {
    rmSync(releaseRecordPath, { force: true })
    rmSync(`${releaseRecordPath}.tmp`, { force: true })
  }
  const buildEnv = {
    ...stablePnpmRunEnvironment(
      withoutWindowsSigningEnvironment(withoutDesktopUploadCredentials(environment)),
    ),
    npm_execpath: environment.npm_execpath ?? join(dirname(require.resolve('pnpm')), 'bin/pnpm.mjs'),
  }
  const targetEnv: NodeJS.ProcessEnv = {
    ...buildEnv,
    DSH_DESKTOP_TARGET_PLATFORM: target.platform,
    DSH_DESKTOP_TARGET_ARCH: target.arch,
    DSH_DESKTOP_INSTALLER_TARGET: invocation.msi ? 'msi' : 'nsis',
  }
  if (unsignedBuilder && !invocation.prepareOnly) targetEnv.DSH_DESKTOP_UNSIGNED = '1'
  else delete targetEnv.DSH_DESKTOP_UNSIGNED
  const electronBuilderEnv = desktopElectronBuilderEnvironment(targetEnv)
  if (!unsignedBuilder) {
    for (const name of WINDOWS_SIGNING_ENV_NAMES) {
      if (environment[name] !== undefined) electronBuilderEnv[name] = environment[name]
    }
  }
  if (!invocation.prepareOnly) {
    await execute(['node', 'scripts/validate-electron-builder-config.mjs'], electronBuilderEnv)
    // Dependency validation emits no artifact; its config-only child must not require token credentials.
    await execute(['node', 'scripts/validate-electron-builder-dependencies.mjs'], {
      ...withoutWindowsSigningEnvironment(electronBuilderEnv),
      DSH_DESKTOP_UNSIGNED: '1',
    })
  }
  await execute(['run', 'build:official'], buildEnv, REPOSITORY_ROOT)
  await execute(['run', 'build'], buildEnv)
  await execute(['run', 'release:pack', '--family', 'dsh', '--out', buildPaths.packedDsh], buildEnv, REPOSITORY_ROOT)
  await execute([
    '--dir',
    'apps/desktop-host',
    'pack',
    '--pack-destination',
    buildPaths.packedDsh,
  ], buildEnv, REPOSITORY_ROOT)
  await execute(['run', 'release:pack', '--family', 'vendor', '--out', buildPaths.packedVendor], buildEnv, REPOSITORY_ROOT)
  rmSync(buildPaths.packedLandlock, { recursive: true, force: true })
  mkdirSync(buildPaths.packedLandlock, { recursive: true })
  await execute(['--dir', 'native/system', 'run', 'build:ts'], buildEnv, REPOSITORY_ROOT)
  await execute([
    '--dir',
    'native/system/packages/entry',
    'pack',
    '--pack-destination',
    buildPaths.packedLandlock,
  ], buildEnv, REPOSITORY_ROOT)
  const signPrimaryRuntime = target.platform === 'win32' && !invocation.prepareOnly
    && !unsignedBuilder
    && Boolean(environment.DSH_DESKTOP_WINDOWS_CER_FILE)
  await execute(['run', 'prepare:runtime', ...(signPrimaryRuntime ? ['--defer-primary-runtime-smoke'] : [])], targetEnv)
  if (signPrimaryRuntime) await execute(['run', 'sign:primary-runtime'], electronBuilderEnv)
  await execute(['run', 'prepare:packages'], targetEnv)
  await execute(['run', 'prepare:seed'], targetEnv)
  if (invocation.prepareOnly) return
  let builderOutput: string | undefined
  try {
    if (target.platform === 'win32') {
      // Keep electron-builder's NSIS staging root short for Windows path-length-sensitive tools.
      builderOutput = mkdtempSync(join(REPOSITORY_ROOT, '..', 'dsh-electron-builder-'))
      electronBuilderEnv.DSH_DESKTOP_BUILDER_OUTPUT = builderOutput
    }
    await execute(desktopElectronBuilderArguments(target, invocation.directory), electronBuilderEnv)
    if (builderOutput !== undefined) {
      const completedOutput = builderOutput
      builderOutput = undefined
      publishCompletedArtifactDirectory(completedOutput, buildPaths.artifacts)
    }
    if (!invocation.directory) {
      writeReleaseRecord(target, electronBuilderEnv, buildPaths.artifacts, unsignedBuilder ? 'unsigned' : 'signed')
    }
  } finally {
    if (builderOutput !== undefined) rmSync(builderOutput, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await packageTarget(parseDesktopPackageInvocation(process.argv.slice(2)))
}
