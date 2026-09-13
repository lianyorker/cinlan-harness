/** Keyless browser proof of device readiness through the real Web Host Remote. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'

import { createChatScrollFixture } from './chat-scroll-fixture.ts'

const expected = fileURLToPath(new URL('./expected/device-capabilities/computer.expected.md', import.meta.url))

describe('Web device readiness', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, createChatScrollFixture({ markerPrefix: 'CAPABILITY_REVIEW', title: 'CAPABILITY_REVIEW', turns: 1 }).log, 'capability-review-session')
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '设置', exact: true }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('reports unmounted Providers honestly and rechecks through the generated Remote', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '计算机控制', exact: true }).click()
    const section = page.locator('[data-capability="computer"]')
    await section.getByText('未启用', { exact: true }).waitFor()
    expect(await section.getByText('已安装', { exact: true }).count()).toBe(0)
    expect(await section.getByText('dsh --profile device-control', { exact: true }).count()).toBe(1)
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/deviceCapabilities/check')
    await section.getByRole('button', { name: '重新检查', exact: true }).click()
    expect(await (await response).json()).toMatchObject({ result: { ok: true, value: {
      capability: 'computer', status: 'not-configured', reason: 'not-configured',
    } } })
    await section.getByText('未启用', { exact: true }).waitFor()
    const aria = await captureStableAria(page, '[data-capability="computer"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(expected, aria, webSnapshotMode())
    const artifactDir = fileURLToPath(new URL('../../../.artifacts/device-control', import.meta.url))
    await mkdir(artifactDir, { recursive: true })
    await page.screenshot({ path: join(artifactDir, 'computer-settings.png') })
    await page.getByRole('button', { name: '手机模拟器', exact: true }).click()
    await page.locator('[data-capability="mobile"]').getByText('未启用', { exact: true }).waitFor()
    expect(consoleWatch.pageErrors).toEqual([])
  })

  it('presents supported setup steps without fake installation or Cookie actions', async () => {
    expect(await page.getByRole('button', { name: '安全研究', exact: true }).count()).toBe(0)
    for (const [id, name] of [['design', '设计'], ['browser', '浏览器'], ['mobile', '手机模拟器']] as const) {
      await page.getByRole('button', { name, exact: true }).click()
      const section = page.locator(`[data-capability="${id}"]`)
      await expect.poll(() => section.getAttribute('aria-busy')).toBe('false')
      expect(await section.getByRole('button', { name: /^(安装|导入|启用)$/u }).count()).toBe(0)
      expect(await section.locator('details[open]').count()).toBe(0)
      await compareOrRefreshGolden(fileURLToPath(new URL(`./expected/device-capabilities/${id}.expected.md`, import.meta.url)),
        await captureStableAria(page, `[data-capability="${id}"]`, scaffold.workspaceCwd), webSnapshotMode())
      const dir = fileURLToPath(new URL('../../../.artifacts/device-control', import.meta.url))
      await mkdir(dir, { recursive: true })
      await page.screenshot({ path: join(dir, `${id}-settings.png`) })
    }
    await page.setViewportSize({ width: 600, height: 1000 })
    expect(await page.locator('[data-capability="mobile"]').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
    await page.setViewportSize({ width: 1680, height: 1000 })
    expect(consoleWatch.pageErrors).toEqual([])
  })

  it('aligns collapsed workbench toggles with Session log and moves them only after opening', async () => {
    await page.getByRole('button', { name: '返回应用', exact: true }).click()
    await page.getByRole('button', { name: '搜索会话', exact: true }).click()
    const search = page.getByRole('textbox', { name: '搜索会话…', exact: true })
    await search.fill('CAPABILITY_REVIEW')
    await page.getByRole('tree', { name: '搜索结果' }).getByRole('treeitem').first().click()
    await search.fill('')
    const cluster = page.locator('[data-dsh-toggle-cluster]')
    const panel = page.locator('[data-dsh-panel]:not([data-dsh-bottom-panel])')
    const log = page.getByRole('button', { name: 'Session 日志', exact: true })
    await log.waitFor()
    const centerDifference = async (): Promise<number> => {
      const a = await cluster.boundingBox()
      const b = await log.boundingBox()
      if (a === null || b === null) throw new Error('Header controls are not measurable')
      return Math.abs(a.y + a.height / 2 - b.y - b.height / 2)
    }
    for (const width of [1680, 1000, 600]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await cluster.getAttribute('data-panel-open')).toBeNull()
      await expect.poll(() => panel.isVisible()).toBe(false)
      await expect.poll(centerDifference).toBeLessThan(1)
      const negativeControl = await page.addStyleTag({ content: '[data-dsh-toggle-cluster] { transform: none !important; }' })
      await expect.poll(centerDifference).toBeGreaterThan(5)
      await negativeControl.evaluate((e: HTMLStyleElement) => { e.remove() })
      await expect.poll(centerDifference).toBeLessThan(1)
      await cluster.getByRole('button', { name: '展开侧边栏', exact: true }).click()
      await expect.poll(() => cluster.getAttribute('data-panel-open')).not.toBeNull()
      await expect.poll(async () => (await cluster.boundingBox())?.y).toBe(3)
      await expect.poll(() => panel.isVisible()).toBe(true)
      await cluster.getByRole('button', { name: '折叠侧边栏', exact: true }).click()
      await expect.poll(centerDifference).toBeLessThan(1)
    }
    await page.setViewportSize({ width: 1680, height: 1000 })
    expect(consoleWatch.pageErrors).toEqual([])
  })
})
