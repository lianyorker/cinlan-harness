/** Real Settings Remotes with an explicitly supplied native ADB and an existing empty ADB server. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import * as yaml from 'js-yaml'
import type {} from '@deepseek-ai/dsh-mobile-device-runtime'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, waitForApplicationFrame } from './support.ts'

const adb = process.env.DSH_WEB_MOBILE_ADB
const serverSocket = process.env.ADB_SERVER_SOCKET
const available = process.platform === 'win32' && process.arch === 'x64' && adb !== undefined && serverSocket !== undefined

it.skipIf(!available)('keeps Android resources opt-in, persists SDK selection, and reports the real empty device list', async () => {
  if (adb === undefined || serverSocket === undefined) throw new Error('Explicit ADB executable and owned server required')
  expect(isAbsolute(adb)).toBe(true)
  expect(existsSync(adb)).toBe(true)
  // This lane reads the explicitly supplied existing loopback server; it never starts or kills the ADB daemon.
  expect(serverSocket).toMatch(/^tcp:127[.]0[.]0[.]1:[0-9]+$/)
  const root = await mkdtemp(join(tmpdir(), 'dsh-mobile-resources-web-'))
  let scaffold: WebScaffold | undefined = undefined
  let browser: Browser | undefined = undefined
  onTestFinished(async () => {
    try { await browser?.close() }
    finally { try { await scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) } }
  })
  const runtimeDir = join(root, 'resources')
  const overlay = join(root, 'mobile.patch.yml')
  await writeFile(overlay, yaml.dump([{ id: 'mobile-device-runtime', config: { storageDir: runtimeDir } }]))
  const host = scaffold = await launchWebScaffold({ harnessHome: join(root, 'home'), extraOverlayPath: overlay, profile: {} })
  const runtime = host.ctx.mobileRuntime
  const initial = await runtime.status(new AbortController().signal)
  expect(initial.resources.map(resource => ({ id: resource.definition.id, integrity: resource.integrity, supported: resource.supported })))
    .toEqual([{ id: 'platform-tools', integrity: 'missing', supported: true }, { id: 'scrcpy', integrity: 'missing', supported: true }])
  expect(initial.task).toBeNull()
  expect(initial.mirror).toBeNull()
  const providers = [...host.ctx.loader.entries()].filter(entry => entry.options.name === '@deepseek-ai/dsh-mobile-device-adb')
  expect(providers).toHaveLength(1)
  expect(providers[0]?.disabled).toBe(true)

  browser = await chromium.launch()
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1360, height: 1000 } })
  page.setDefaultTimeout(20_000)
  const tripwire = watchConsole(page)
  const consoleErrors: string[] = []
  const networkErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 400) networkErrors.push(String(response.status()) + ' ' + response.url()) })
  onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-resources'))
  await page.goto(host.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  const openMobile = async (): Promise<void> => {
    const settings = page.getByRole('region', { name: 'Settings', exact: true })
    if (!await settings.isVisible()) await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings.getByRole('button', { name: 'Mobile emulator', exact: true }).click()
  }
  await openMobile()
  const section = page.locator('[data-capability="mobile"]')
  const resources = section.getByRole('region', { name: 'Android runtime resources', exact: true })
  const platformTools = resources.getByRole('article', { name: 'platform-tools', exact: true })
  const scrcpy = resources.getByRole('article', { name: 'scrcpy', exact: true })
  await platformTools.getByRole('checkbox').waitFor()
  for (const resource of [platformTools, scrcpy]) {
    expect(await resource.getByRole('checkbox').isChecked()).toBe(false)
    expect(await resource.getByRole('button', { name: 'Install', exact: true }).isDisabled()).toBe(true)
    expect(await resource.getByRole('link').getAttribute('href')).toMatch(/^https:/)
  }
  const expected = fileURLToPath(new URL('./expected/mobile-resources', import.meta.url))
  if (webSnapshotMode() === 'refresh') await mkdir(expected, { recursive: true })
  for (const id of ['platform-tools', 'scrcpy']) {
    await compareOrRefreshGolden(join(expected, id + '-uninstalled.expected.md'),
      await captureStableAria(page, '[data-settings-anchor="mobile-resources"] article[aria-label="' + id + '"]', host.workspaceCwd),
      webSnapshotMode())
  }
  await platformTools.getByRole('checkbox').check()
  expect(await platformTools.getByRole('button', { name: 'Install', exact: true }).isEnabled()).toBe(true)
  expect(await scrcpy.getByRole('button', { name: 'Install', exact: true }).isDisabled()).toBe(true)
  expect((await runtime.status(new AbortController().signal)).task).toBeNull()
  await platformTools.getByRole('checkbox').uncheck()

  const sdkPath = section.getByRole('textbox', { name: 'Custom SDK path', exact: true })
  await sdkPath.fill(adb)
  await section.getByRole('button', { name: 'Save preferences', exact: true }).click()
  const settingsFile = join(host.harnessHome, 'settings.yaml')
  await expect.poll(async () => yaml.load(await readFile(settingsFile, 'utf8')))
    .toMatchObject({ 'mobile-device': { androidSdkPath: adb } })
  await resources.getByRole('button', { name: 'Refresh resources and devices', exact: true }).click()
  await resources.getByText('Custom SDK', { exact: true }).waitFor()
  const observed = await runtime.status(new AbortController().signal)
  expect(observed.adb.error).toBeNull()
  expect(observed.adb.version).toContain('Android Debug Bridge version')
  expect(observed.adb.version).toContain('37.0')
  expect(observed.adb.path).toBe(adb)
  expect(observed.devices).toEqual([])
  await resources.getByText('No Android devices found. Connect a device, authorize USB debugging on it, then refresh.', { exact: true }).waitFor()
  expect(await resources.getByRole('button', { name: 'Start selected device mirror', exact: true }).isDisabled()).toBe(true)

  const activation = section.locator('[data-settings-anchor="mobile-activation"]')
  await expect.poll(() => activation.locator('code').allTextContents()).toEqual([providers[0]!.id])
  await activation.getByRole('button', { name: 'Enable provider', exact: true }).click()
  await activation.getByText('Configuration applied. Readiness is checked separately.', { exact: true }).waitFor()
  await expect.poll(() => providers[0]?.disabled).toBe(false)
  expect(yaml.load(await readFile(join(host.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')))
    .toContainEqual({ id: 'mobile-device-adb', disabled: false })
  expect(await resources.getByRole('button', { name: 'Start selected device mirror', exact: true }).isDisabled()).toBe(true)

  const warningsBeforeReload = tripwire.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(tripwire, warningsBeforeReload)
  await openMobile()
  await expect.poll(() => sdkPath.inputValue()).toBe(adb)
  await platformTools.getByRole('checkbox').waitFor()
  expect(await platformTools.getByRole('checkbox').isChecked()).toBe(false)
  expect(await scrcpy.getByRole('checkbox').isChecked()).toBe(false)
  await resources.getByText('No Android devices found. Connect a device, authorize USB debugging on it, then refresh.', { exact: true }).waitFor()
  const artifacts = fileURLToPath(new URL('../../../.artifacts/native-migration', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  await resources.scrollIntoViewIfNeeded()
  expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: join(artifacts, 'mobile-resources-settings-1360.png') })
  await resources.screenshot({ path: join(artifacts, 'mobile-resources-panel.png') })
  await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'General', exact: true }).click()
  const final = await runtime.status(new AbortController().signal)
  expect(final.task).toBeNull()
  expect(final.mirror).toBeNull()
  expect(final.resources.every(resource => resource.integrity === 'missing')).toBe(true)
  expect(final.devices).toEqual([])
  expect(networkErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
  expect(tripwire.pageErrors).toEqual([])
  await writeFile(join(artifacts, 'mobile-resources-web-evidence.json'), JSON.stringify({
    adbVersion: final.adb.version, deviceCount: final.devices.length,
    resources: final.resources.map(resource => ({
      id: resource.definition.id, version: resource.definition.version, integrity: resource.integrity,
    })),
    providerEnabled: providers[0]?.disabled === false, task: final.task, mirror: final.mirror,
    sdkPreferenceReloaded: true, installsStarted: 0, mirrorAcceptance: 'not attempted: no attached Android device',
    consoleErrors, networkErrors,
  }, null, 2))
})
