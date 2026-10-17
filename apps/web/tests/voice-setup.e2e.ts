/** Built-in dictation needs no optional experimental plugin or installation prompt. */
import { chromium, type Browser } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, waitForApplicationFrame, REPO_ROOT } from './support.ts'

it('offers voice settings and ten local models without an experimental voice plugin', async () => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
  })
  const scaffold = await launchWebScaffold()
  resources.scaffold = scaffold
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await waitForApplicationFrame(page)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  expect(await page.locator('[data-plugin-package="@deepseek-ai/dsh-experimental-voice-input-bundle"]').count()).toBe(0)
  expect(await page.getByRole('switch', { name: 'Enable Voice input', exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Voice', exact: true }).click()
  const section = page.locator('[data-voice-settings-panel]')
  expect(await section.getByRole('switch', { name: 'Enable voice dictation' }).getAttribute('aria-checked')).toBe('true')
  await section.getByRole('button', { name: 'Speech Model', exact: true }).click()
  const rows = page.locator('[data-voice-model]')
  expect(await rows.count()).toBe(10)
  expect(await rows.getByRole('button', { name: 'Download', exact: true }).count()).toBe(10)
  expect(await page.getByRole('dialog').count()).toBe(0)
  await page.keyboard.press('Escape')
  expect(await rows.count()).toBe(0)
  const screenshots = join(REPO_ROOT, '.artifacts', 'voice-refactor')
  await mkdir(screenshots, { recursive: true })
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), theme === 'dark')
      await section.getByRole('button', { name: 'Speech Model', exact: true }).click()
      const menu = page.getByRole('menu')
      const box = await menu.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      expect(box!.y + box!.height).toBeLessThanOrEqual(900)
      expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: join(screenshots, `voice-${width}-${theme}.png`) })
      await page.keyboard.press('Escape')
    }
  }
  expect(tripwire.pageErrors).toEqual([])
})
