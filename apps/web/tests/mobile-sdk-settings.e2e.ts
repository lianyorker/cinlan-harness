/** SDK settings autosave and the composed browse picker; native folder opening is stubbed at the wire. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Route } from 'playwright'
import { load } from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { waitForApplicationFrame } from './support.ts'

it('locates and saves an SDK folder, opens detected paths, and keeps mobile settings within the viewport', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [], bundles: ['@deepseek-ai/dsh-cinlan-mobile-device'] } })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1360, height: 1000 } })
  const consoleWatch = watchConsole(page)
  const sdkRoot = 'C:\\Users\\Yorker\\AppData\\Local\\Android\\Sdk'
  const artifacts = fileURLToPath(new URL('../../../.artifacts/mobile-sdk', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  const settingsFile = join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml')
  const readSavedSettings = async (): Promise<unknown> => load(await readFile(settingsFile, 'utf8'))
  let detectedPath: string | null = null
  const opened: unknown[] = []
  const rpcId = (route: Route): unknown => {
    const body: unknown = route.request().postDataJSON()
    if (body === null || typeof body !== 'object' || !('rpcId' in body)) throw new Error('Missing RPC request id')
    return body.rpcId
  }
  await page.route('**/api/directoryPicker/list', route => route.fulfill({
    json: { type: 'server-response', rpcId: rpcId(route), result: { ok: true, value: {
      path: sdkRoot, home: sdkRoot, crumbs: [{ name: 'Sdk', path: sdkRoot, hidden: false }], entries: [], truncated: false,
    } } },
  }))
  await page.route('**/api/deviceCapabilities/checkSdk', route => route.fulfill({
    json: { type: 'server-response', rpcId: rpcId(route), result: { ok: true, value: {
      platform: 'win32', android: { found: detectedPath !== null, sdkPath: detectedPath, message: '' }, ios: null,
    } } },
  }))
  await page.route('**/api/session/canOpenWorkspacePath', route => route.fulfill({
    json: { type: 'server-response', rpcId: rpcId(route), result: { ok: true, value: true } },
  }))
  await page.route('**/api/session/openWorkspacePath', (route) => {
    opened.push(route.request().postDataJSON())
    return route.fulfill({
      json: { type: 'server-response', rpcId: rpcId(route), result: { ok: true, value: { opened: true } } },
    })
  })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Mobile emulator', exact: true }).click()
  const section = page.locator('[data-capability="mobile"]')
  const sdk = section.locator('[data-settings-anchor="mobile-sdk-path"]')
  const input = sdk.getByRole('textbox', { name: 'Custom SDK path', exact: true })
  expect(await sdk.getByRole('link', { name: 'Download Android Studio', exact: true }).getAttribute('href'))
    .toBe('https://developer.android.com/studio')
  const locate = sdk.getByRole('button', { name: 'Locate SDK folder', exact: true })
  await locate.click()
  const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true })
  await picker.waitFor()
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => locate.isEnabled()).toBe(true)
  expect(await input.inputValue()).toBe('')
  await locate.click()
  await picker.waitFor()
  await page.keyboard.press('Escape')
  await expect.poll(() => locate.isEnabled()).toBe(true)
  await locate.click()
  await picker.waitFor()
  await expect.poll(() => picker.getByRole('button', { name: 'Open', exact: true }).isEnabled()).toBe(true)
  await expect.poll(() => picker.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
  expect(await picker.evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
  })).toBe(true)
  await page.screenshot({ path: join(artifacts, 'picker-1360.png') })
  await page.setViewportSize({ width: 390, height: 800 })
  expect(await picker.evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
  })).toBe(true)
  await page.screenshot({ path: join(artifacts, 'picker-390.png') })
  await page.mouse.click(5, 5)
  await expect.poll(() => locate.isEnabled()).toBe(true)
  await page.setViewportSize({ width: 1360, height: 1000 })
  expect(await input.inputValue()).toBe('')
  detectedPath = sdkRoot
  await locate.click()
  await picker.getByRole('button', { name: 'Open', exact: true }).click()
  await expect.poll(() => input.inputValue()).toBe(sdkRoot)
  await section.getByText('Preferences saved.', { exact: true }).waitFor()
  expect(await readSavedSettings())
    .toContainEqual({ id: 'mobile-device', name: '@deepseek-ai/dsh-mobile-device', config: {
      provider: 'adb', enabled: false, defaultDeviceId: '', androidSdkPath: sdkRoot,
    } })
  const open = sdk.getByRole('button', { name: 'Open folder', exact: true })
  await open.click()
  await expect.poll(() => opened.length).toBe(1)
  expect(opened[0]).toMatchObject({ payload: { args: { request: { path: sdkRoot } } } })
  const expected = fileURLToPath(new URL('./expected/mobile-sdk', import.meta.url))
  if (webSnapshotMode() === 'refresh') await mkdir(expected, { recursive: true })
  await compareOrRefreshGolden(join(expected, 'detected.expected.md'),
    await captureStableAria(page, '[data-settings-anchor="mobile-sdk-path"]', scaffold.workspaceCwd), webSnapshotMode())
  for (const name of ['Save preferences', 'Discard draft', 'Restore defaults', 'Disable']) {
    expect(await section.getByRole('button', { name, exact: true }).count()).toBe(0)
  }
  expect(await section.getByRole('switch').count()).toBe(0)
  expect(await section.locator('[data-settings-anchor="mobile-enabled"]').count()).toBe(0)
  expect(await section.locator('[data-settings-anchor="mobile-agent"], [data-settings-anchor="mobile-resources"]').count()).toBe(0)
  await section.getByRole('heading', { name: 'Common emulator commands', exact: true }).waitFor()
  await section.locator('[data-settings-anchor="mobile-usage"]').waitFor()
  await compareOrRefreshGolden(join(expected, 'page.expected.md'),
    await captureStableAria(page, '[data-capability="mobile"]', scaffold.workspaceCwd), webSnapshotMode())
  await input.fill(sdkRoot + '\\manual')
  await input.blur()
  await expect.poll(readSavedSettings)
    .toContainEqual({ id: 'mobile-device', name: '@deepseek-ai/dsh-mobile-device', config: {
      provider: 'adb', enabled: false, defaultDeviceId: '', androidSdkPath: sdkRoot + '\\manual',
    } })
  await input.fill(sdkRoot)
  await input.blur()
  await expect.poll(readSavedSettings)
    .toContainEqual({ id: 'mobile-device', name: '@deepseek-ai/dsh-mobile-device', config: {
      provider: 'adb', enabled: false, defaultDeviceId: '', androidSdkPath: sdkRoot,
    } })
  detectedPath = sdkRoot + '\\platform-tools\\adb.exe'
  await section.locator('[data-settings-anchor="mobile-readiness"]').getByRole('button', { name: 'Re-check', exact: true }).click()
  await sdk.getByText('Detected at ' + detectedPath, { exact: true }).waitFor()
  await open.click()
  await expect.poll(() => opened.length).toBe(2)
  expect(opened[1]).toMatchObject({ payload: { args: { request: { path: detectedPath, action: 'reveal' } } } })
  for (const width of [1360, 600, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    expect(await sdk.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: join(artifacts, `settings-${width}.png`) })
  }
  await section.locator('[data-settings-anchor="mobile-commands"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(artifacts, 'controls-390.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(true)
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await sdk.scrollIntoViewIfNeeded()
    expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: join(artifacts, `settings-dark-${width}.png`) })
  }
  const warningsBeforeReload = consoleWatch.warnings.length
  await page.setViewportSize({ width: 1360, height: 1000 })
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(consoleWatch, warningsBeforeReload)
  if (!await page.getByRole('region', { name: 'Settings', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Mobile emulator', exact: true }).click()
  await expect.poll(() => input.inputValue()).toBe(sdkRoot)
  expect(consoleWatch.pageErrors).toEqual([])
})
