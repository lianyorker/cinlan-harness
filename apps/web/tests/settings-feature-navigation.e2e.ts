/** Independent feature menus retain shared chrome and durable preferences. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, waitForApplicationFrame } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/settings-feature-navigation', import.meta.url))
const ARTIFACTS = fileURLToPath(new URL('../../../.artifacts/settings-feature-navigation', import.meta.url))

describe('web e2e: independent feature settings navigation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ locale: ZH_BROWSER_LOCALE, viewport: { width: 1680, height: 1000 } })
    page.setDefaultTimeout(10_000)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
    await mkdir(ARTIFACTS, { recursive: true })
    if (MODE === 'refresh') await mkdir(EXPECTED, { recursive: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  async function prefs(): Promise<Record<string, unknown>> {
    const raw = load(await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')) as Record<string, Record<string, unknown>>
    return raw['dsh-better-sidebar'] ?? {}
  }

  it('opens each tool independently, saves its switch, and restores it after reload', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('region', { name: '设置', exact: true })
    const nav = settings.getByRole('navigation', { name: '设置导航' })
    expect(await nav.getByRole('button', { name: '侧边卡片', exact: true }).count()).toBe(0)
    for (const label of ['工作区布局', '文件', '任务管理', '侧边对话(beta)', 'Git 与源代码控制', '浏览器', '终端']) {
      expect(await nav.getByRole('button', { name: label, exact: true }).count()).toBe(1)
    }
    expect((await nav.boundingBox())?.width).toBe(280)
    const header = (await settings.locator('header').boundingBox())?.height
    expect(header).toBeGreaterThanOrEqual(64)
    expect(header).toBeLessThanOrEqual(65)

    await nav.getByRole('button', { name: '工作区布局', exact: true }).click()
    expect(await settings.locator('[data-settings-anchor$="-enabled"]').count()).toBe(0)
    await compareOrRefreshGolden(join(EXPECTED, 'layout.expected.md'),
      await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), MODE)

    await nav.getByRole('button', { name: '任务管理', exact: true }).click()
    const taskToggle = settings.locator('[data-settings-anchor="better-sidebar-subagent-enabled"] input')
    await taskToggle.uncheck()
    await expect.poll(async () => (await prefs()).tabsEnabled).toMatchObject({ subagent: false })
    expect(await nav.getByRole('button', { name: '任务管理', exact: true }).count()).toBe(1)
    expect(await settings.locator('[data-settings-anchor="better-sidebar-browser-enabled"]').count()).toBe(0)
    await compareOrRefreshGolden(join(EXPECTED, 'tasks.expected.md'),
      await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), MODE)
    await page.screenshot({ path: join(ARTIFACTS, 'tasks-desktop.png') })

    await nav.getByRole('button', { name: '文件', exact: true }).click()
    await settings.locator('[data-settings-anchor="better-sidebar-editor-enabled"]').waitFor()
    await settings.locator('[data-settings-anchor="better-sidebar-editor-intercept-open-path"]').waitFor()
    expect(await settings.locator('[data-settings-anchor^="better-sidebar-viewer-"]').count()).toBeGreaterThan(0)
    await compareOrRefreshGolden(join(EXPECTED, 'files.expected.md'),
      await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), MODE)
    await page.screenshot({ path: join(ARTIFACTS, 'files-desktop.png') })

    for (const [label, feature] of [['Git 与源代码控制', 'git'], ['浏览器', 'browser'], ['终端', 'terminal']] as const) {
      await nav.getByRole('button', { name: label, exact: true }).click()
      const own = settings.locator('[data-settings-anchor="better-sidebar-' + feature + '-enabled"]')
      await own.waitFor()
      expect(await settings.locator('[data-settings-anchor="better-sidebar-editor-enabled"]').count()).toBe(0)
      expect(await nav.getByRole('button', { name: label, exact: true }).getAttribute('aria-current')).toBe('page')
    }
    await page.screenshot({ path: join(ARTIFACTS, 'terminal-desktop.png') })
    const search = settings.getByRole('searchbox', { name: '搜索设置...', exact: true })
    await search.fill('任务管理')
    await settings.getByRole('button', { name: /AI 与模型.*任务管理.*·/ }).click()
    await expect.poll(() => settings.locator('[data-settings-anchor="better-sidebar-subagent-enabled"]').evaluate(
      element => element === document.activeElement || element.contains(document.activeElement),
    )).toBe(true)
    const warningCount = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await waitForApplicationFrame(page)
    acknowledgeReloadConnectionLoss(tripwire, warningCount)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await nav.getByRole('button', { name: '任务管理', exact: true }).click()
    expect(await taskToggle.isChecked()).toBe(false)
    await taskToggle.check()
    await expect.poll(async () => (await prefs()).tabsEnabled).toMatchObject({ subagent: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: join(ARTIFACTS, 'tasks-mobile.png') })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
