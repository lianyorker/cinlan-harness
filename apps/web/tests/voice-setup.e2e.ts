/** Built-in voice settings and explicitly installed experimental voice setup remain independent. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
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

describe('explicit experimental voice input bundle', () => {
  const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-input-bundle', import.meta.url))
  const expected = fileURLToPath(new URL('./expected/voice-setup.expected.md', import.meta.url))

  it('guides a newly enabled voice plugin to installation and lets the user postpone it', async () => {
    const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
    onTestFinished(async () => {
      try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
    })
    const scaffold = await launchWebScaffold({ profile: { packages: [
      { dir: bundle, enabled: false },
      ...['speech-to-text', 'speech-to-text-sensevoice', 'api-speech-to-text', 'client-ui-voice-input'].map(name => ({
        dir: fileURLToPath(new URL(`../../../packages/experimental/${name}`, import.meta.url)),
      })),
    ] } })
    resources.scaffold = scaffold
    const browser = await chromium.launch()
    resources.browser = browser
    const page = await newEnglishPage(browser), tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    const toggle = page.getByRole('switch', { name: 'Enable Voice input', exact: true })
    await toggle.waitFor()
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    const dialog = page.getByRole('dialog', { name: 'Set up voice input before recording', exact: true })
    expect(await dialog.count()).toBe(0)
    await toggle.click()
    await dialog.waitFor()
    await compareOrRefreshGolden(expected, await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
    await dialog.getByRole('button', { name: 'Later', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    const card = page.locator('[data-plugin-package="@deepseek-ai/dsh-experimental-voice-input-bundle"]')
    expect(await card.getByRole('status').textContent()).toBe('')
    await toggle.click()
    await page.getByRole('switch', { name: 'Enable Voice input', exact: true, checked: false }).click()
    await dialog.getByRole('button', { name: 'Go to setup', exact: true }).click()
    await page.getByRole('button', { name: 'Download and prepare', exact: true }).waitFor()
    expect(await dialog.count()).toBe(0)
    expect(await page.getByText('Local models will be downloaded to the machine running DSH. No Python or compiler is required.', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Audio is recognized on the machine running DSH. If models need downloading, that machine must be able to reach the selected source and its file services. Configure a proxy on that machine if needed.', { exact: true }).count()).toBe(1)
    const source = page.getByLabel('Model download source', { exact: true })
    expect(await source.inputValue()).toBe('')
    expect(await source.getByRole('option').allTextContents()).toEqual(['Automatic (recommended)', 'Hugging Face', 'HF-Mirror (China mirror)'])
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/voice-source-auto.expected.md', import.meta.url)),
      await captureStableAria(page, '[data-speech-provider]', scaffold.workspaceCwd), webSnapshotMode())
    await source.selectOption('https://hf-mirror.com')
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/voice-source-manual.expected.md', import.meta.url)),
      await captureStableAria(page, '[data-speech-provider]', scaffold.workspaceCwd), webSnapshotMode())
    expect(tripwire.pageErrors).toEqual([])
  })
})
