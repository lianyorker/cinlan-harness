/** Human selection reaches the real Browser Remote and only the initiating Session draft. */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import type * as PlaywrightCore from 'playwright-core'
import { expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, readPersistedEvents,
  seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { saveFailureShot, waitForApplicationFrame } from './support.ts'

const FIXTURE = createChatScrollFixture({ markerPrefix: 'ELEMENT_DRAFT', title: 'Element capture draft', turns: 1 })
const OTHER = createChatScrollFixture({ markerPrefix: 'OTHER_DRAFT', title: 'Other capture draft', turns: 1 })

async function selectSession(page: Page, marker: string): Promise<void> {
  const search = page.getByRole('button', { name: 'Search sessions', exact: true })
  if (await search.getAttribute('aria-expanded') !== 'true') await search.click()
  await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill(marker)
  const rows = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => rows.count()).toBe(1)
  await rows.click()
  await page.getByText(marker, { exact: false }).last().waitFor()
}

it('cancels selection, previews a real crop, and attaches without sending or changing another draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-element-capture-web-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Capture target</title><button aria-label="Capture this element" style="display:block;width:180px;height:70px;margin:0;padding:0;border:0;background:rgb(50,100,150)" onclick="document.title=\'Unexpected click\'"></button>')
  })
  onTestFinished(async () => {
    if (!server.listening) return
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Capture fixture has no listener')
  const targetUrl = `http://127.0.0.1:${String(address.port)}/`
  const runtime = createRequire(new URL('../../../packages/browser/browser-playwright/package.json', import.meta.url))('playwright-core') as typeof PlaywrightCore
  const launch = runtime.chromium.launchPersistentContext.bind(runtime.chromium)
  const provider = Promise.withResolvers<PlaywrightCore.BrowserContext>()
  const spy = vi.spyOn(runtime.chromium, 'launchPersistentContext').mockImplementation(async (directory, options) => {
    const context = await launch(directory, options)
    provider.resolve(context)
    return context
  })
  onTestFinished(() => { spy.mockRestore() })
  const bundleUrl = new URL('../../../packages/bundle/cinlan-browser/cordis.patch.yml', import.meta.url)
  const overlayPath = join(root, 'capture.patch.yml')
  await writeFile(overlayPath, await readFile(bundleUrl, 'utf8') + yaml.dump([
    { id: 'browser-runtime', config: { storageDir: join(root, 'browser-runtime') } },
    { id: 'browser-playwright', config: { storageDir: join(root, 'browser-profile'), browserChannel: 'chromium', executablePath: chromium.executablePath(), headless: true } },
  ]))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: overlayPath,
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/cinlan-browser/package.json', import.meta.url))],
  })
  onTestFinished(() => scaffold.close())
  const sourceId = await seedSession(scaffold, FIXTURE.log, 'element-capture-source')
  const otherId = await seedSession(scaffold, OTHER.log, 'element-capture-other')
  const baselineSource = (await readPersistedEvents(scaffold, sourceId)).filter(event => event.type === 'user/message')
  const baselineOther = (await readPersistedEvents(scaffold, otherId)).filter(event => event.type === 'user/message')
  const target = await scaffold.ctx.browser.openPage(scaffold.ctx.browser.resolveNavigation({ kind: 'url', url: targetUrl }))
  const providerContext = await provider.promise
  const targetPage = providerContext.pages().find(candidate => candidate.url() === targetUrl)
  if (targetPage === undefined) throw new Error('Provider did not open the capture page')
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
  page.setDefaultTimeout(15_000)
  const observation = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-element-capture'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await selectSession(page, FIXTURE.markers.user(1))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Element capture', exact: true }).click()
  const section = page.locator('[data-browser-element-capture]')
  await section.getByRole('button', { name: 'Refresh pages', exact: true }).click()
  await section.getByRole('combobox', { name: 'Browser page', exact: true }).selectOption(target.pageId)
  await section.getByRole('button', { name: 'Select and capture', exact: true }).click()
  const overlay = targetPage.locator('#__dsh_browser_element_capture_overlay__')
  await overlay.waitFor({ state: 'attached' })
  await section.getByRole('button', { name: 'Cancel', exact: true }).click()
  await overlay.waitFor({ state: 'detached' })
  expect(await section.getByRole('img').count()).toBe(0)
  await section.getByRole('button', { name: 'Select again and capture', exact: true }).click()
  await overlay.waitFor({ state: 'attached' })
  await targetPage.getByRole('button', { name: 'Capture this element', exact: true }).click()
  const preview = section.getByRole('img', { name: 'Screenshot preview of the selected element' })
  try { await preview.waitFor() } catch (error) {
    await saveFailureShot(page, 'web-e2e-element-capture')
    throw new Error('Element capture preview unavailable: ' + await section.innerText(), { cause: error })
  }
  await expect.poll(() => preview.evaluate(image => image instanceof HTMLImageElement
    && image.complete && image.naturalWidth > 0)).toBe(true)
  expect(await targetPage.title()).toBe('Capture target')
  await saveFailureShot(page, 'web-e2e-element-capture-preview')
  await section.getByRole('button', { name: 'Attach to Session draft', exact: true }).click()
  await expect.poll(() => section.innerText(), { timeout: 15_000 }).toContain('It has not been sent.')
  const attachedAria = (await captureStableAria(page, '[data-browser-element-capture]', scaffold.workspaceCwd))
    .replaceAll(targetUrl, '{{browserUrl}}')
  await page.keyboard.press('Escape')
  const attachments = page.getByRole('group', { name: 'Pending attachments', exact: true })
  await attachments.getByRole('img', { name: 'browser-element.png', exact: true }).waitFor()
  await selectSession(page, OTHER.markers.user(1))
  expect(await attachments.count()).toBe(0)
  await selectSession(page, FIXTURE.markers.user(1))
  await attachments.getByRole('img', { name: 'browser-element.png', exact: true }).waitFor()
  expect((await readPersistedEvents(scaffold, sourceId)).filter(event => event.type === 'user/message')).toEqual(baselineSource)
  expect((await readPersistedEvents(scaffold, otherId)).filter(event => event.type === 'user/message')).toEqual(baselineOther)
  expect(observation.pageErrors).toEqual([])
  expect(observation.warnings).toEqual([])
  const expected = fileURLToPath(new URL('./expected/settings-element-capture/attached.expected.md', import.meta.url))
  const mode = webSnapshotMode()
  if (mode === 'refresh') await mkdir(dirname(expected), { recursive: true })
  await compareOrRefreshGolden(expected, attachedAria, mode)
})
