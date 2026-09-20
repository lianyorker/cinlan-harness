/** Real CLI composition and official Plugin Manager persistence for default provider activation. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import {
  boot, composeEntries, initProfile, loadOverlayPatches, PROFILE_TEMPLATES, readProfilePatches,
  type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import PluginManager from '@deepseek-ai/dsh-plugin-manager'
import { load } from 'js-yaml'

const workspace = fileURLToPath(new URL('../../../..', import.meta.url))
const bundleRoot = fileURLToPath(new URL('..', import.meta.url))
const targets = ['browser-playwright', 'computer-use-cua-driver-native'] as const
interface Row { id?: string; name?: string; disabled?: boolean; config?: unknown }

async function temporaryHome() {
  const home = await mkdtemp(join(tmpdir(), 'web-capability-defaults-'))
  onTestFinished(async () => { await rm(home, { recursive: true, force: true }) })
  return home
}

async function linkBundles(home: string, profile: string) {
  const directory = join(home, 'profiles', profile)
  for (const folder of ['base', 'web-app', 'cinlan-browser', 'cinlan-computer-use', 'cinlan-mobile-device', 'web-capability-defaults']) {
    const destination = join(directory, 'node_modules', '@deepseek-ai', 'dsh-' + folder)
    await mkdir(dirname(destination), { recursive: true })
    await symlink(join(workspace, 'packages', 'bundle', folder), destination, process.platform === 'win32' ? 'junction' : 'dir')
  }
  return directory
}

async function dump(home: string, profile: string): Promise<Row[]> {
  const child = spawn(process.execPath, [
    '--import', pathToFileURL(join(workspace, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href,
    join(workspace, 'apps', 'cli', 'src', 'bin.ts'), '--profile', profile, '--dump-config',
  ], { cwd: home, env: { ...process.env, DSH_HOME: home, TSX_TSCONFIG_PATH: join(workspace, 'tsconfig.json') }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('CLI dump failed: ' + stderr))
    })
  })
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited.catch(() => { /* The dump rejection is asserted by its caller. */ })
  })
  await exited
  const value: unknown = load(stdout, { schema: entryListSchema })
  if (!Array.isArray(value)) throw new Error('Expected a CLI entry array')
  return value as Row[]
}

it('publishes only two activation patches and no runtime entrypoint', async () => {
  const manifest = JSON.parse(await readFile(join(bundleRoot, 'package.json'), 'utf8')) as {
    main?: string
    types?: string
    exports: Record<string, unknown>
    files: string[]
  }
  expect(manifest.main).toBeUndefined()
  expect(manifest.types).toBeUndefined()
  expect(manifest.exports['.']).toBeUndefined()
  expect(manifest.files).toEqual(['cordis.patch.yml'])
  expect(loadOverlayPatches('test', join(bundleRoot, 'cordis.patch.yml'))).toEqual(
    targets.map(id => ({ id, disabled: true })),
  )
})

it('composes each default provider once in the actual CLI and leaves opt-in profiles enabled', async () => {
  const home = await temporaryHome()
  for (const profile of ['web', 'browser', 'device-control']) await linkBundles(home, profile)
  const web = await dump(home, 'web')
  for (const id of [
    'browser-runtime', 'browser', 'browser-playwright', 'browser-permission-policy', 'tool-browser',
    'browser-controller', 'ui-browser-element-capture', 'computer-use', 'computer-use-permission-policy',
    'computer-use-cua-driver-native',
  ]) expect(web.filter(row => row.id === id)).toHaveLength(1)
  for (const id of targets) expect(web.find(row => row.id === id)?.disabled).toBe(true)
  expect(web.filter(row => row.id === 'mobile-device')).toHaveLength(1)
  expect(web.find(row => row.id === 'mobile-device')?.disabled).not.toBe(true)
  const browser = await dump(home, 'browser')
  expect(browser.filter(row => row.id === targets[0])).toHaveLength(1)
  expect(browser.find(row => row.id === targets[0])?.disabled).not.toBe(true)
  expect(browser.some(row => row.id === targets[1])).toBe(false)
  const devices = await dump(home, 'device-control')
  expect(devices.filter(row => row.id === targets[1])).toHaveLength(1)
  expect(devices.find(row => row.id === targets[1])?.disabled).not.toBe(true)
})

it('persists official Plugin Manager enables after the defaults layer without changing bundle files', async () => {
  const home = await temporaryHome()
  const dir = await linkBundles(home, 'management')
  const fixture = join(dir, 'node_modules', 'management-fixture')
  await mkdir(fixture, { recursive: true })
  const rows = [
    { id: 'manager', name: 'cordis:manager' },
    { id: targets[0], name: '@deepseek-ai/dsh-browser-playwright' },
    { id: targets[1], name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native' },
  ]
  await writeFile(join(fixture, 'package.json'), JSON.stringify({
    name: 'management-fixture', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(fixture, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]))
  const bundles = ['management-fixture', '@deepseek-ai/dsh-web-capability-defaults']
  initProfile(dir, bundles, 'startup')
  const anchor = join(home, 'package.json')
  await writeFile(anchor, JSON.stringify({ name: 'management-installation', dependencies: {} }))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'management', dir, home, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: anchor,
    cwd: home, startedBundles: bundles, overlays: [], telemetryDisabledEnv: undefined, patchReload: 'startup',
  }
  const before = await readFile(join(bundleRoot, 'cordis.patch.yml'), 'utf8')
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    ctx.provide('profileContext', profile)
    ctx.loader.builtins.manager = PluginManager
  })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const inventory = await ctx.pluginManager.listPlugins()
  for (const id of targets) {
    const row = inventory.find(row => row.patchId === id)
    if (row === undefined) throw new Error('Missing configured provider entry: ' + id)
    expect(await ctx.pluginManager.setPluginEnabled(row.entryId, true)).toMatchObject({ changed: true, application: 'restart-required' })
  }
  const patches = loadOverlayPatches('test', profile.patchPath)
  for (const id of targets) expect(patches).toContainEqual({ id, disabled: false })
  const composed = composeEntries([readProfilePatches('test', profile)])
  for (const id of targets) expect(composed.find(row => row.id === id)?.disabled).toBe(false)
  expect(await readFile(join(bundleRoot, 'cordis.patch.yml'), 'utf8')).toBe(before)

  const webDir = await linkBundles(home, 'web')
  await writeFile(join(webDir, 'cordis.patch.yml'), await readFile(profile.patchPath))
  const final = await dump(home, 'web')
  for (const id of targets) expect(final.find(row => row.id === id)?.disabled).toBe(false)
  expect(PROFILE_TEMPLATES.web?.bundles.at(-1)).toBe('@deepseek-ai/dsh-web-capability-defaults')
})
