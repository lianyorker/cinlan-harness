/** Real preference pages share the native settings shell and their runtime owners. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import { load } from 'js-yaml'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot, waitForApplicationFrame } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/settings-feature-pages', import.meta.url))
const ARTIFACTS = fileURLToPath(new URL('../../../.artifacts/settings-feature-pages', import.meta.url))

describe('web e2e: native preference pages use real settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    if (MODE === 'refresh') {
      await mkdir(ARTIFACTS, { recursive: true })
      await mkdir(EXPECTED, { recursive: true })
    }
  }, 120_000)

  beforeEach(async () => {
    const ownedPage = await browser.newPage({ locale: ZH_BROWSER_LOCALE, viewport: { width: 1280, height: 800 } })
    onTestFinished(() => ownedPage.close())
    page = ownedPage
    page.setDefaultTimeout(10_000)
    tripwire = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-native-feature-page'))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  async function open(label: string): Promise<Locator> {
    const settings = page.getByRole('region', { name: '设置', exact: true })
    if (!await settings.isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.getByRole('button', { name: label, exact: true }).click()
    await settings.getByRole('heading', { name: label, level: 1, exact: true }).waitFor()
    return settings
  }

  async function reload(): Promise<void> {
    const warnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await waitForApplicationFrame(page)
    acknowledgeReloadConnectionLoss(tripwire, warnings)
  }

  async function overrides(namespace: string): Promise<Record<string, unknown>> {
    const document: unknown = load(await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'))
    if (typeof document !== 'object' || document === null || Array.isArray(document)) throw new Error('Expected settings document')
    const section = (document as Record<string, unknown>)[namespace]
    if (section === undefined) return {}
    if (typeof section !== 'object' || section === null || Array.isArray(section)) throw new Error('Expected namespace settings')
    return section as Record<string, unknown>
  }

  function expectClean(): void {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }

  it('persists notification overrides and removes them on reset', async () => {
    const settings = await open('通知')
    const enabled = settings.getByRole('switch', { name: '启用通知', exact: true })
    await expect.poll(() => enabled.isEnabled()).toBe(true)
    await enabled.click()
    await expect.poll(() => overrides('notifications')).toMatchObject({ enabled: true })
    const completion = settings.getByRole('switch', { name: '智能体任务完成', exact: true })
    await completion.click()
    await settings.getByRole('combobox', { name: '通知声音', exact: true }).selectOption('ding')
    await expect.poll(() => overrides('notifications')).toMatchObject({ agentCompletion: true, sound: 'ding' })
    await settings.getByRole('switch', { name: '定时免打扰', exact: true }).click()
    const quietStart = settings.getByLabel('免打扰开始时间', { exact: true })
    const quietEnd = settings.getByLabel('免打扰结束时间', { exact: true })
    await expect.poll(() => quietStart.isEnabled()).toBe(true)
    await quietStart.fill('23:30')
    await quietEnd.fill('06:15')
    await settings.getByRole('button', { name: '保存免打扰时段', exact: true }).click()
    await expect.poll(() => overrides('notifications')).toMatchObject({
      quietHoursEnabled: true, quietHoursStart: '23:30', quietHoursEnd: '06:15',
    })
    await reload()
    const restored = await open('通知')
    expect(await restored.getByRole('switch', { name: '启用通知', exact: true }).getAttribute('aria-checked')).toBe('true')
    expect(await restored.getByRole('combobox', { name: '通知声音', exact: true }).inputValue()).toBe('ding')
    expect(await restored.getByRole('switch', { name: '定时免打扰', exact: true }).getAttribute('aria-checked')).toBe('true')
    expect(await restored.getByLabel('免打扰开始时间', { exact: true }).inputValue()).toBe('23:30')
    expect(await restored.getByLabel('免打扰结束时间', { exact: true }).inputValue()).toBe('06:15')
    await restored.getByRole('searchbox', { name: '搜索设置...', exact: true }).fill('免打扰开始时间')
    await restored.getByRole('button', { name: /个人偏好.*免打扰开始时间/ }).click()
    const quietRow = restored.locator('[data-settings-anchor="notifications-quiet-start"]')
    await expect.poll(() => quietRow.evaluate(
      element => element === document.activeElement || element.contains(document.activeElement),
    )).toBe(true)
    await compareOrRefreshGolden(join(EXPECTED, 'notifications.expected.md'),
      await captureStableAria(page, '[aria-labelledby="notifications-title"]', scaffold.workspaceCwd), MODE)
    if (MODE === 'refresh') await page.screenshot({ path: join(ARTIFACTS, 'notifications-desktop.png') })
    await restored.getByRole('button', { name: '恢复默认', exact: true }).click()
    await expect.poll(() => overrides('notifications')).toEqual({})
    await expect.poll(() => restored.getByRole('switch', { name: '启用通知', exact: true }).getAttribute('aria-checked')).toBe('false')
    expect(await restored.getByRole('combobox', { name: '通知声音', exact: true }).inputValue()).toBe('system')
    expect(await restored.getByRole('switch', { name: '定时免打扰', exact: true }).getAttribute('aria-checked')).toBe('false')
    expect(await restored.getByLabel('免打扰开始时间', { exact: true }).inputValue()).toBe('22:00')
    expect(await restored.getByLabel('免打扰结束时间', { exact: true }).inputValue()).toBe('08:00')
    await reload()
    const reset = await open('通知')
    await expect.poll(() => reset.getByRole('switch', { name: '启用通知', exact: true }).isEnabled()).toBe(true)
    expect(await reset.getByRole('switch', { name: '定时免打扰', exact: true }).getAttribute('aria-checked')).toBe('false')
    expect(await reset.getByLabel('免打扰开始时间', { exact: true }).inputValue()).toBe('22:00')
    expect(await reset.getByLabel('免打扰结束时间', { exact: true }).inputValue()).toBe('08:00')
    expectClean()
  })

  it('persists host parallelism and reveals composition limits through search', async () => {
    const settings = await open('编排')
    const limit = settings.getByRole('spinbutton', { name: '并行工具调用上限', exact: true })
    await expect.poll(() => limit.isEnabled()).toBe(true)
    const inherited = await limit.inputValue()
    const requested = Number(inherited) === 3 ? 4 : 3
    await limit.fill(String(requested))
    await settings.locator('[data-settings-anchor="orchestration-parallelism"]').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => overrides('agent-loop')).toMatchObject({ maxParallelToolCalls: requested })
    await reload()
    const restored = await open('编排')
    expect(await restored.getByRole('spinbutton', { name: '并行工具调用上限', exact: true }).inputValue()).toBe(String(requested))
    await restored.getByRole('searchbox', { name: '搜索设置...', exact: true }).fill('工作流引擎与限制')
    await restored.getByRole('button', { name: /AI 与模型.*工作流引擎与限制/ }).click()
    const limits = restored.locator('[data-settings-anchor="orchestration-workflow-limits"]')
    await limits.waitFor()
    expect(await limits.evaluate(element => element.closest('details')?.open)).toBe(true)
    await expect.poll(() => limits.evaluate(
      element => element === document.activeElement || element.contains(document.activeElement),
    )).toBe(true)
    const row = restored.locator('[data-settings-anchor="orchestration-parallelism"]')
    await compareOrRefreshGolden(join(EXPECTED, 'parallelism.expected.md'),
      await captureStableAria(page, '[data-settings-anchor="orchestration-parallelism"]', scaffold.workspaceCwd), MODE)
    if (MODE === 'refresh') await page.screenshot({ path: join(ARTIFACTS, 'orchestration-desktop.png') })
    await row.getByRole('button', { name: '恢复继承值', exact: true }).click()
    await expect.poll(() => overrides('agent-loop')).not.toHaveProperty('maxParallelToolCalls')
    await expect.poll(() => restored.getByRole('spinbutton', { name: '并行工具调用上限', exact: true }).inputValue()).toBe(inherited)
    expectClean()
  })

  it('keeps browser voice preferences across reload and targets disabled rows', async () => {
    const settings = await open('语音')
    const hold = settings.getByRole('radio', { name: /按住模式/ })
    await hold.check()
    await reload()
    const restored = await open('语音')
    expect(await restored.getByRole('radio', { name: /按住模式/ }).isChecked()).toBe(true)
    const enabled = restored.getByRole('switch', { name: '启用语音听写', exact: true })
    await enabled.click()
    await expect.poll(() => restored.getByRole('radio', { name: /按住模式/ }).isDisabled()).toBe(true)
    await restored.getByRole('searchbox', { name: '搜索设置...', exact: true }).fill('麦克风权限')
    await restored.getByRole('button', { name: /AI 与模型.*麦克风权限/ }).click()
    await restored.locator('[data-settings-anchor="voice-permission"]').waitFor()
    expect(await restored.getByRole('switch', { name: '启用语音听写', exact: true }).getAttribute('aria-checked')).toBe('false')
    await compareOrRefreshGolden(join(EXPECTED, 'voice-preferences.expected.md'),
      await captureStableAria(page, '[data-settings-anchor="voice-enabled"]', scaffold.workspaceCwd), MODE)
    expect(await overrides('voice')).toEqual({})
    expectClean()
  })

  it('keeps preference controls usable at narrow widths and increased page scale', async () => {
    const settings = await open('通知')
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 844 })
      await expect.poll(() => settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await settings.getByRole('heading', { name: '通知', level: 1, exact: true }).waitFor()
      if (MODE === 'refresh') await page.screenshot({ path: join(ARTIFACTS, 'notifications-' + String(width) + '.png') })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(2)
      await settings.getByRole('switch', { name: '启用通知', exact: true }).scrollIntoViewIfNeeded()
      expect(await settings.getByRole('switch', { name: '启用通知', exact: true }).isVisible()).toBe(true)
    } finally {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
      await cdp.detach()
    }
    expectClean()
  })
})
