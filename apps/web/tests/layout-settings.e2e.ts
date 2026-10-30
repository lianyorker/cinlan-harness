/** Current-window layout settings over the shipped frame and independent Sidebar. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, waitForApplicationFrame } from './support.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold({})
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  page.setDefaultTimeout(10_000)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
})

afterAll(async () => { await browser?.close(); await scaffold?.close() })

it('changes live columns, restores defaults, exposes searchable controls and resets on reload', async () => {
  const tripwire = watchConsole(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const settings = page.getByRole('region', { name: 'Settings', exact: true })
  const open = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settings.getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('button', { name: 'Workspace layout', exact: true }).click()
  }
  await open()
  const left = settings.getByRole('slider', { name: 'Left sidebar width', exact: true })
  const right = settings.getByRole('slider', { name: 'Right panel width', exact: true })
  const frame = page.locator('[data-sidebar-collapsed]').or(page.locator('[style*="grid-template-columns"]')).first()
  const sidebarWidth = (): Promise<number> => frame.evaluate(element => Number.parseFloat(getComputedStyle(element).gridTemplateColumns))
  expect(await left.inputValue()).toBe('280')
  await left.focus()
  await page.keyboard.press('End')
  await expect.poll(() => left.inputValue()).toBe('420')
  await expect.poll(sidebarWidth).toBe(420)
  await right.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => right.inputValue()).toBe('300')
  // Closing Settings never remounts the frame's geometry store.
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  await open()
  expect(await left.inputValue()).toBe('420')
  expect(await right.inputValue()).toBe('300')
  await settings.getByRole('button', { name: 'Reset column widths', exact: true }).click()
  await expect.poll(() => left.inputValue()).toBe('280')
  await expect.poll(sidebarWidth).toBe(280)
  expect(await right.inputValue()).toBe('648')
  const search = settings.getByRole('searchbox', { name: 'Search settings...', exact: true })
  await search.fill('Right panel width')
  await settings.getByRole('button', { name: /Right panel width/ }).click()
  await expect.poll(() => settings.locator('[data-settings-anchor="layout-rightbar"]').getAttribute('data-settings-target')).toBe('true')
  const expected = fileURLToPath(new URL('./expected/layout-settings', import.meta.url))
  const artifacts = fileURLToPath(new URL('../../../.artifacts/layout-settings', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  if (webSnapshotMode() === 'refresh') await mkdir(expected, { recursive: true })
  await compareOrRefreshGolden(join(expected, 'layout.expected.md'),
    await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), webSnapshotMode())
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await settings.getByRole('region', { name: 'Workspace layout', exact: true })
        .evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: join(artifacts, colorScheme + '-' + String(width) + '.png') })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await left.focus()
  await page.keyboard.press('End')
  const warningCount = tripwire.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(tripwire, warningCount)
  await open()
  expect(await left.inputValue()).toBe('280')
  expect(await right.inputValue()).toBe('648')
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})

it('applies all font roles from Settings, persists them and restores built-in font lists', async () => {
  const tripwire = watchConsole(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const settings = page.getByRole('region', { name: 'Settings', exact: true })
  const openFonts = async (): Promise<void> => {
    await settings.getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('button', { name: 'General', exact: true }).click()
    await settings.getByRole('button', { name: 'More font settings', exact: true }).click()
  }
  await openFonts()
  for (const name of ['Increase font size', 'Increase code font size', 'Increase terminal font size']) {
    const button = settings.getByRole('button', { name, exact: true })
    await button.focus()
    await button.press('Enter')
  }
  const families = [['Text font', 'Arial', 'text'], ['Code font', 'Consolas', 'code'],
    ['Terminal font', 'Courier New', 'terminal']] as const
  for (const [label, value] of families) {
    const input = settings.getByRole('textbox', { name: label, exact: true })
    await input.fill(value)
    await input.press('Enter')
  }
  const typography = (): Promise<Record<string, string>> => page.evaluate(() => {
    const style = document.body.style
    return Object.fromEntries(['--dsh-content-font-size', '--dsh-code-font-size', '--dsh-terminal-font-size',
      '--dsh-font-family-text', '--dsh-font-family-code', '--dsh-font-family-terminal']
      .map(name => [name, style.getPropertyValue(name)]))
  })
  const expectedTypography = {
    '--dsh-content-font-size': '15px', '--dsh-code-font-size': '12px', '--dsh-terminal-font-size': '14px',
    '--dsh-font-family-text': '"Arial"', '--dsh-font-family-code': '"Consolas"', '--dsh-font-family-terminal': '"Courier New"',
  }
  await expect.poll(typography).toEqual(expectedTypography)
  const expected = fileURLToPath(new URL('./expected/layout-settings', import.meta.url))
  await compareOrRefreshGolden(join(expected, 'fonts.expected.md'),
    await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), webSnapshotMode())
  const artifacts = fileURLToPath(new URL('../../../.artifacts/layout-settings', import.meta.url))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      const textFont = settings.getByRole('textbox', { name: 'Text font', exact: true })
      await textFont.scrollIntoViewIfNeeded()
      if (width === 390) {
        const geometry = await textFont.evaluate((input) => {
          const row = input.parentElement?.parentElement
          const text = row?.firstElementChild
          if (row === null || row === undefined || text === null || text === undefined) throw new Error('Missing font row')
          return { row: row.getBoundingClientRect().width, text: text.getBoundingClientRect().width,
            field: input.parentElement?.getBoundingClientRect().width, height: input.getBoundingClientRect().height,
            stacked: input.getBoundingClientRect().top >= text.getBoundingClientRect().bottom }
        })
        expect(geometry.text).toBeGreaterThanOrEqual(geometry.row - 1)
        expect(geometry.field).toBeGreaterThanOrEqual(geometry.row - 1)
        expect(geometry.height).toBeGreaterThanOrEqual(44)
        expect(geometry.stacked).toBe(true)
      }
      await page.screenshot({ path: join(artifacts, 'fonts-' + colorScheme + '-' + String(width) + '.png') })
    }
  }
  const warningCount = tripwire.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(tripwire, warningCount)
  await expect.poll(typography).toEqual(expectedTypography)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await openFonts()
  for (const [label, value, role] of families) {
    const input = settings.getByRole('textbox', { name: label, exact: true })
    expect(await input.inputValue()).toBe('"' + value + '"')
    await input.fill('')
    await input.press('Enter')
    await expect.poll(async () => (await typography())['--dsh-font-family-' + role]).toBe('')
  }
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
