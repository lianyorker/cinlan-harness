import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { packageTarget, resolveDesktopPackageTarget } from '../scripts/package-target.ts'

const fixture = vi.hoisted(() => ({ root: '' }))
const builderEntry = createRequire(import.meta.url).resolve('electron-builder/out/cli/cli.js')
vi.mock('../scripts/desktop-build-paths.mjs', () => ({ desktopTargetBuildPaths: () => ({
  artifacts: join(fixture.root, 'artifacts'), packedDsh: join(fixture.root, 'packed', 'dsh'),
  packedVendor: join(fixture.root, 'packed', 'vendor'), packedLandlock: join(fixture.root, 'packed', 'landlock'),
}) }))

beforeEach(async () => { fixture.root = await mkdtemp(join(tmpdir(), 'desktop-package-pipeline-')) })
afterEach(async () => { await rm(fixture.root, { recursive: true, force: true }) })

const signingEnvironment = {
  DSH_DESKTOP_WINDOWS_CER_FILE: 'release.cer', DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'fixture-pin',
  DSH_DESKTOP_WINDOWS_SIGNTOOL: 'signtool.exe', DSH_DESKTOP_WINDOWS_KEY_CONTAINER: 'fixture-container',
  DOWNLOAD_TEST_COS_SECRET_KEY: 'upload-secret',
}

it('rejects a signed Windows installer before preparation without credentials', async () => {
  const execute = vi.fn()
  await expect(packageTarget({
    target: resolveDesktopPackageTarget('win-x64', 'win32', 'x64'),
    directory: false,
    prepareOnly: false,
    unsigned: false,
  }, {}, execute)).rejects.toThrow(/signed Windows packaging requires/u)
  expect(execute).not.toHaveBeenCalled()
})

it.each([
  { signed: true, unsigned: false, msi: false, directory: false, prepareOnly: false },
  { signed: false, unsigned: true, msi: false, directory: false, prepareOnly: false },
  { signed: false, unsigned: true, msi: true, directory: false, prepareOnly: false },
  { signed: false, unsigned: false, msi: false, directory: true, prepareOnly: false },
  { signed: true, unsigned: false, msi: false, directory: false, prepareOnly: true },
])('preserves build, package-set and seed ordering for %j', async ({ signed, unsigned, msi, directory, prepareOnly }) => {
  const execute = vi.fn(async (args: readonly string[], environment?: NodeJS.ProcessEnv, _cwd?: string) => {
    if (args.includes(builderEntry) && environment?.DSH_DESKTOP_BUILDER_OUTPUT !== undefined) {
      await mkdir(environment.DSH_DESKTOP_BUILDER_OUTPUT, { recursive: true })
    }
  })
  await packageTarget({ target: resolveDesktopPackageTarget('win-x64', 'win32', 'x64'), directory, prepareOnly, unsigned, msi },
    signed ? signingEnvironment : {}, execute)
  const commands = execute.mock.calls.map(([args]) => args.join(' '))
  const stages = commands.filter(command => command.startsWith('run '))
  expect(stages).toEqual([
    'run build:official', 'run build',
    'run release:pack --family dsh --out ' + join(fixture.root, 'packed', 'dsh'),
    'run release:pack --family vendor --out ' + join(fixture.root, 'packed', 'vendor'),
    'run prepare:runtime' + (signed && !directory && !prepareOnly ? ' --defer-primary-runtime-smoke' : ''),
    ...(signed && !directory && !prepareOnly ? ['run sign:primary-runtime'] : []),
    'run prepare:packages', 'run prepare:seed',
  ])
  expect(commands.some(command => command.includes('prepare:dsh'))).toBe(false)
  if (directory) expect(existsSync(join(fixture.root, 'artifacts', 'win-x64-release.json'))).toBe(false)
  if (!directory && !prepareOnly) {
    const record = JSON.parse(readFileSync(join(fixture.root, 'artifacts', 'win-x64-release.json'), 'utf8')) as {
      schemaVersion: number
      signingMode: 'signed' | 'unsigned'
    }
    expect(record).toMatchObject({ schemaVersion: 2, signingMode: unsigned ? 'unsigned' : 'signed' })
  }
  expect(commands.at(-1)).toBe(prepareOnly ? 'run prepare:seed'
    : `node ${builderEntry} --config electron-builder.config.mjs --win --x64 --publish never${directory ? ' --dir' : ''}`)
  for (const [args, environment] of execute.mock.calls) {
    expect(environment?.DOWNLOAD_TEST_COS_SECRET_KEY).toBeUndefined()
    if (args.includes(builderEntry)) expect(environment?.DSH_DESKTOP_BUILDER_OUTPUT).toMatch(/dsh-electron-builder-/u)
    const receivesSigning = args.includes('sign:primary-runtime') || args.includes(builderEntry)
      || args.includes('scripts/validate-electron-builder-config.mjs')
    const receivesPreparation = args.some(arg => arg.startsWith('prepare:'))
    const dependencyValidation = args.includes('scripts/validate-electron-builder-dependencies.mjs')
    expect(environment?.DSH_DESKTOP_WINDOWS_TOKEN_PIN).toBe(signed && receivesSigning ? 'fixture-pin' : undefined)
    expect(environment?.DSH_DESKTOP_UNSIGNED).toBe(dependencyValidation || (!prepareOnly && (unsigned || directory) && (receivesSigning || receivesPreparation)) ? '1' : undefined)
    if (args.some(arg => arg.startsWith('prepare:')) || args.includes('sign:primary-runtime')) {
      expect(environment).toMatchObject({
        DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64',
        DSH_DESKTOP_INSTALLER_TARGET: msi ? 'msi' : 'nsis',
      })
    }
  }
})

it.each(['prepare:runtime', 'sign:primary-runtime', 'prepare:packages', 'prepare:seed'])('stops packaging when %s fails', async (failed) => {
  const commands: string[] = []
  const execute = async (args: readonly string[]) => {
    commands.push(args.join(' '))
    if (args.includes(failed)) throw new Error('fixture preparation failed')
  }
  await expect(packageTarget({ target: resolveDesktopPackageTarget('win-x64', 'win32', 'x64'), directory: false, prepareOnly: false, unsigned: false },
    signingEnvironment, execute)).rejects.toThrow('fixture preparation failed')
  expect(commands.at(-1)).toContain(failed)
  expect(commands.some(command => command.startsWith(`node ${builderEntry}`))).toBe(false)
})

it('keeps macOS runtime preparation and seed signing on the existing chain', async () => {
  const commands: string[] = []
  await packageTarget({ target: resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64'), directory: true, prepareOnly: false, unsigned: false },
    {}, async (args) => { commands.push(args.join(' ')) })
  expect(commands.slice(-4)).toEqual([
    'run prepare:runtime', 'run prepare:packages', 'run prepare:seed',
    `node ${builderEntry} --config electron-builder.config.mjs --mac --arm64 --publish never --dir`,
  ])
})
