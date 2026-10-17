/** Real SDK autosave against an explicitly supplied native ADB and an owned empty server. */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import * as yaml from 'js-yaml'
import type {} from '@deepseek-ai/dsh-mobile-device-runtime'
import { acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { waitForApplicationFrame } from './support.ts'

const adb = process.env.DSH_WEB_MOBILE_ADB
const serverSocket = process.env.ADB_SERVER_SOCKET
const available = process.platform === 'win32' && process.arch === 'x64' && adb !== undefined && serverSocket !== undefined

it.skipIf(!available)('autosaves SDK selection and leaves native resources and mirrors untouched', async () => {
  if (adb === undefined || serverSocket === undefined) throw new Error('Explicit ADB executable and owned server required')
  expect(isAbsolute(adb)).toBe(true)
  expect(existsSync(adb)).toBe(true)
  expect(serverSocket).toMatch(/^tcp:127[.]0[.]0[.]1:[0-9]+$/)
  const root = await mkdtemp(join(tmpdir(), 'dsh-mobile-resources-web-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() }
    finally { try { await resources.scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) } }
  })
  const overlay = join(root, 'mobile.patch.yml')
  await writeFile(overlay, yaml.dump([{ id: 'mobile-device-runtime', config: { storageDir: join(root, 'resources') } }]))
  const host = resources.scaffold = await launchWebScaffold({ harnessHome: join(root, 'home'), extraOverlayPath: overlay,
    profile: { packages: [], bundles: ['@deepseek-ai/dsh-cinlan-mobile-device'] } })
  const browser = resources.browser = await chromium.launch()
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1360, height: 1000 } })
  const consoleWatch = watchConsole(page)
  const openMobile = async (): Promise<void> => {
    const settings = page.getByRole('region', { name: 'Settings', exact: true })
    if (!await settings.isVisible()) await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings.getByRole('button', { name: 'Mobile emulator', exact: true }).click()
  }
  await page.goto(host.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await openMobile()
  const section = page.locator('[data-capability="mobile"]')
  expect(await section.locator('[data-settings-anchor="mobile-agent"], [data-settings-anchor="mobile-resources"]').count()).toBe(0)
  const sdkPath = section.getByRole('textbox', { name: 'Custom SDK path', exact: true })
  await sdkPath.fill(adb)
  await sdkPath.blur()
  const settingsFile = join(host.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml')
  await expect.poll(async (): Promise<unknown> => yaml.load(await readFile(settingsFile, 'utf8')))
    .toContainEqual({ id: 'mobile-device', name: '@deepseek-ai/dsh-mobile-device', config: {
      provider: 'adb', enabled: false, defaultDeviceId: '', androidSdkPath: adb,
    } })
  const runtime = host.ctx.mobileRuntime
  const observed = await runtime.status(new AbortController().signal)
  expect(observed.adb.error).toBeNull()
  expect(observed.adb.version).toContain('Android Debug Bridge version')
  expect(observed.adb.path).toBe(adb)
  expect(observed.devices).toEqual([])
  expect(observed.resources.every(resource => resource.integrity === 'missing')).toBe(true)
  expect(observed.task).toBeNull()
  expect(observed.mirror).toBeNull()
  const warningsBeforeReload = consoleWatch.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(consoleWatch, warningsBeforeReload)
  await openMobile()
  await expect.poll(() => sdkPath.inputValue()).toBe(adb)
  expect(consoleWatch.pageErrors).toEqual([])
})
