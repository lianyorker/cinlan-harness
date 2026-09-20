/** Real Files navigation converts local Office fixtures and displays PDF pages in Chromium. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { docxFixture, xlsxFixture, pptxFixture } from '../../../packages/document/office-to-pdf/tests/fixtures/office.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, waitForApplicationFrame } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const AUDIT = fileURLToPath(new URL('../../../.artifacts/official-016-audit', import.meta.url))
const FILES = [
  { name: 'preview-word.docx', bytes: docxFixture() },
  { name: 'preview-excel.xlsx', bytes: xlsxFixture() },
  { name: 'preview-powerpoint.pptx', bytes: pptxFixture() },
]

// Chromium's full new-headless browser includes the native PDF viewer; headless-shell does not.
const BROWSER_OPTIONS = { channel: 'chromium' } as const

describe('web e2e: built-in Office previews in Files', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let artifacts: string
  const consoleErrors: string[] = []

  beforeAll(async () => {
    await mkdir(AUDIT, { recursive: true })
    artifacts = await mkdtemp(join(AUDIT, 'office-preview-'))
    scaffold = await launchWebScaffold({})
    await Promise.all(FILES.map(file => writeFile(join(scaffold.workspaceCwd, file.name), file.bytes)))
    await seedSession(scaffold, await readFile(SEED, 'utf8'), 'office-preview-web-e2e')
    browser = await chromium.launch(BROWSER_OPTIONS)
    page = await newEnglishPage(browser)
    page.setDefaultTimeout(15_000)
    tripwire = watchConsole(page)
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    if (artifacts !== undefined) {
      await writeFile(join(artifacts, 'console.json'), JSON.stringify({
        errors: consoleErrors, pageErrors: tripwire?.pageErrors ?? [], warnings: tripwire?.warnings ?? [],
      }, null, 2) + '\n').catch((error: unknown) => failures.push(error))
    }
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Office browser acceptance teardown failed')
  }, 120_000)

  it('opens Word, Excel, and PowerPoint, downloads originals, and switches localized Office controls', async () => {
    onTestFailed(async () => {
      try {
        await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
      } catch {
        // A closed page cannot supply evidence; keep the original assertion failure.
      }
    })
    const group = page.getByRole('treeitem').first()
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').nth(1).click()
    await page.getByText('DONE', { exact: true }).waitFor()

    const sidebar = page.locator('[data-dsh-better-sidebar]')
    await sidebar.waitFor({ state: 'attached' })
    await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await sidebar.getByRole('button', { name: 'New tab', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Files', exact: true }).click()
    const filesTab = sidebar.locator('[title="Files"][draggable="true"]').last()
    await filesTab.waitFor()
    const measurements: Record<string, unknown>[] = []

    for (const file of FILES) {
      await filesTab.click()
      const row = sidebar.locator('[role="button"][title$="' + file.name + '"]:visible')
      await row.waitFor()
      // The row's right edge contains a separate reference-in-chat action.
      await row.click({ position: { x: 8, y: 8 } })
      await sidebar.locator('[title="' + file.name + '"][draggable="true"]').waitFor()
      await filesTab.waitFor()
      const preview = sidebar.locator('[data-office-preview]:visible')
      await expect.poll(() => preview.getAttribute('data-office-preview'), { timeout: 60_000 }).toBe('ready')
      const frame = preview.locator('iframe')
      await frame.waitFor()
      expect(await frame.getAttribute('title')).toBe(file.name)
      const rendered = await frame.evaluate(async (element) => {
        const source = element.getAttribute('src')
        if (source === null || !source.startsWith('blob:')) throw new Error('Office viewer has no PDF Blob URL')
        const blob = await (await fetch(source)).blob()
        return {
          type: blob.type, size: blob.size, signature: await blob.slice(0, 5).text(),
          complete: (await blob.slice(-128).text()).includes('%%EOF'),
        }
      })
      expect(rendered.type).toBe('application/pdf')
      expect(rendered.signature).toBe('%PDF-')
      expect(rendered.complete).toBe(true)
      expect(rendered.size).toBeGreaterThan(1000)
      const blobUrl = await frame.getAttribute('src')
      await expect.poll(() => page.frames().some(current => current.parentFrame()?.url() === blobUrl), { timeout: 30_000 })
        .toBe(true)
      // Chromium hosts the PDF extension in a child frame outside the embedding document's DOM.
      const pdfFrame = page.frames().find(current => current.parentFrame()?.url() === blobUrl)
      if (pdfFrame === undefined) throw new Error('Chromium did not attach the native PDF frame')
      await pdfFrame.locator('pdf-viewer').waitFor({ timeout: 30_000 })
      const geometry = await frame.boundingBox()
      expect(geometry?.width).toBeGreaterThan(250)
      expect(geometry?.height).toBeGreaterThan(250)
      expect(await preview.getByRole('button', { name: 'Refresh preview', exact: true }).isEnabled()).toBe(true)
      expect(await preview.locator('[role="alert"]').count()).toBe(0)

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        preview.getByRole('link', { name: 'Download original', exact: true }).click(),
      ])
      expect(download.suggestedFilename()).toBe(file.name)
      const downloadedPath = await download.path()
      if (downloadedPath === null) throw new Error('Office original download has no completed file')
      expect(await readFile(downloadedPath)).toEqual(Buffer.from(file.bytes))
      expect(await readFile(join(scaffold.workspaceCwd, file.name))).toEqual(Buffer.from(file.bytes))
      measurements.push({ file: file.name, ...rendered, geometry })
      await page.screenshot({ path: join(artifacts, file.name + '.png'), animations: 'disabled' })
    }

    const readyPreview = sidebar.locator('[data-office-preview]:visible')
    const pdfSource = await readyPreview.locator('iframe').getAttribute('src')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'English', exact: true }).click()
    await page.getByRole('menuitem', { name: '中文', exact: true }).click()
    const chineseSettings = page.getByRole('region', { name: '设置', exact: true })
    await chineseSettings.getByRole('navigation', { name: '设置导航', exact: true })
      .getByRole('button', { name: '文件', exact: true }).click()
    for (const title of ['Word 文档', 'Excel 工作簿', 'PowerPoint 演示文稿']) {
      await chineseSettings.getByText(title, { exact: true }).waitFor()
    }
    await page.keyboard.press('Escape')
    await readyPreview.getByRole('link', { name: '下载原文件', exact: true }).waitFor()
    expect(await readyPreview.getByRole('button', { name: '刷新预览', exact: true }).isEnabled()).toBe(true)
    expect(await readyPreview.locator('iframe').getAttribute('src')).toBe(pdfSource)
    await page.screenshot({ path: join(artifacts, 'preview-powerpoint-zh.png'), animations: 'disabled' })
    await writeFile(join(artifacts, 'rendered.json'), JSON.stringify(measurements, null, 2) + '\n')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    expect(consoleErrors).toEqual([])
  }, 240_000)
})
