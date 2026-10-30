/** Inspect floating workspace states through the supported Web profile, without exposing authentication data. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const log = readFileSync(new URL('../desktop-test-logs/p0-web-3081-profile-20261021.log', import.meta.url), 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3081[^\s]*/)?.[0]
if (!url) throw new Error('startup_url_unavailable')
let browser
let stage = 'launch'
let page
let originalPosition
let originalEnabled
async function settings() {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '浮动工作区', exact: true }).click()
  await page.locator('[data-floating-workspace-section]').waitFor()
}
async function position(value) {
  const radio = page.locator(`input[type="radio"][value="${value}"]`)
  if (!(await radio.isChecked())) await radio.click()
  await page.waitForFunction(value => {
    const input = document.querySelector(`input[type="radio"][value="${value}"]`)
    return input?.checked && !input.disabled
  }, value)
}
try {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', () => errors.push('pageerror'))
  await page.goto(url)
  await page.waitForTimeout(4000)
  stage = 'preferences'
  await settings()
  originalPosition = await page.locator('input[type="radio"]:checked').inputValue()
  const enabled = page.getByRole('switch', { name: '启用浮动工作区', exact: true })
  originalEnabled = await enabled.getAttribute('aria-checked') === 'true'
  if (!originalEnabled) await enabled.click()
  await position('header')
  await page.getByRole('button', { name: '返回应用', exact: true }).click()
  const panel = page.locator('[data-floating-panel]')
  stage = 'blank_header'
  await page.locator('[data-floating-entry="header"] button').click()
  await panel.locator('[data-composer-input]').waitFor()
  if (await panel.getByText('Hi! How can I assist you today?', { exact: true }).count()) throw new Error('expected_blank_session')
  console.log(JSON.stringify({ blankSessionHeader: true, composer: true }))
  await panel.getByRole('button', { name: '关闭浮动工作区', exact: true }).click()
  stage = 'floating_entry'
  await settings()
  await position('floating')
  await page.getByRole('button', { name: '返回应用', exact: true }).click()
  await page.locator('[data-floating-entry="floating"] button').click()
  await panel.locator('[data-composer-input]').waitFor()
  console.log(JSON.stringify({ blankSessionFloating: true, headerEntryAbsent: await page.locator('[data-floating-entry="header"]').count() === 0 }))
  await page.screenshot({ path: 'desktop-test-logs/closure-floating-blank.png' })
  await panel.getByRole('button', { name: '关闭浮动工作区', exact: true }).click()
  stage = 'persisted_tab'
  await page.evaluate(() => {
    const id = JSON.parse(localStorage.getItem('dsh.sessions.current')).sessionId
    localStorage.setItem(`dsh.sidebar-right.v1.${id}`, JSON.stringify({ bySession: { [id]: { minted: 2, layout: {
      nodes: { pane1: { kind: 'pane', id: 'pane1', host: 'dock', tabs: ['tab2'], activeTabId: 'tab2' } },
      tabs: { tab2: { id: 'tab2', kind: 'floatingWorkspace', contentId: 'sidebar://floatingWorkspace', title: '浮动工作区' } },
      rootId: 'pane1', floats: [], activePaneId: 'pane1', expanded: true, mode: 'push',
    } } } }))
  })
  await page.reload()
  await page.waitForTimeout(3500)
  console.log(JSON.stringify({ restoredTabDiagnostics: await page.getByRole('button').evaluateAll(items => items.map(item => ({ label: item.getAttribute('aria-label'), text: item.textContent })).filter(item => /浮动|侧边栏/.test((item.label ?? '') + item.text))) }))
  await page.screenshot({ path: 'desktop-test-logs/closure-floating-tab-diagnostic.png' })
  const tab = page.getByText('浮动工作区', { exact: true }).first()
  await tab.waitFor()
  if ((await page.locator('body').innerText()).includes('这类内容还没有可用的查看方式')) throw new Error('persisted_tab_unsupported')
  const composers = await page.locator('[data-composer-input]').count()
  if (composers < 2) throw new Error('persisted_tab_composer_missing')
  console.log(JSON.stringify({ persistedFloatingTab: true, composers, errors }))
  await page.screenshot({ path: 'desktop-test-logs/closure-floating-persisted-tab.png' })
  if (errors.length) throw new Error('page_errors')
} catch (error) {
  console.error(JSON.stringify({ stage, error: String(error).split('\n')[0].replace(/https?:\/\/[^\s]+/g, '<URL_REDACTED>') }))
  process.exitCode = 1
} finally {
  try {
    if (page && originalPosition !== undefined) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await settings()
      await position(originalPosition)
      const enabled = page.getByRole('switch', { name: '启用浮动工作区', exact: true })
      if ((await enabled.getAttribute('aria-checked') === 'true') !== originalEnabled) await enabled.click()
      await page.waitForTimeout(500)
      console.log(JSON.stringify({ preferencesRestored: true }))
    }
  } catch { console.error('preference_restore_failed'); process.exitCode = 1 }
  await browser?.close()
}
