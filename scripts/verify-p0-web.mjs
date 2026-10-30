/** Inspect the supported local Web profile without exposing authentication URLs. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const log = readFileSync(new URL('../desktop-test-logs/p0-web-3081-profile-20261021.log', import.meta.url), 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3081[^\s]*/)?.[0]
if (!url) throw new Error('startup_url_unavailable')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message.replace(/https?:\/\/[^\s]+/g, '<URL_REDACTED>')))
  await page.goto(url)
  await page.waitForTimeout(6000)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '浮动工作区', exact: true }).click()
  await page.waitForTimeout(500)
  console.log(JSON.stringify({ switches: await page.getByRole('switch').evaluateAll(items => items.map(item => ({ label: item.getAttribute('aria-label'), checked: item.getAttribute('aria-checked') }))), radios: await page.getByRole('radio').evaluateAll(items => items.map(item => ({ label: item.getAttribute('aria-label'), text: item.textContent, checked: item.getAttribute('aria-checked') }))) }))
  await page.getByRole('button', { name: '返回应用', exact: true }).click()
  await page.getByText('say hi', { exact: true }).click()
  await page.waitForTimeout(1200)
  console.log(JSON.stringify({ toggleButtons: await page.getByRole('button').evaluateAll(items => items.filter(item => /浮动/.test(item.getAttribute('aria-label') ?? '')).map(item => ({ label: item.getAttribute('aria-label'), visible: !!item.getClientRects().length }))) }))
  await page.getByRole('button', { name: '切换浮动工作区', exact: true }).click()
  const panel = page.locator('[data-floating-panel]')
  await panel.waitFor()
  const geometries = []
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 600 }, { width: 390, height: 400 }]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(350)
    const rect = await panel.boundingBox()
    const composers = await panel.locator('[data-composer-input]').count()
    geometries.push({ viewport, rect, composers, unsupported: (await panel.innerText()).includes('这类内容还没有可用的查看方式') })
    await page.screenshot({ path: `desktop-test-logs/p0-floating-${viewport.width}x${viewport.height}.png` })
  }
  console.log(JSON.stringify({ geometries }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByText('安全研究启动 (1)', { exact: true }).click()
  await page.waitForTimeout(800)
  if ((await panel.innerText()).includes('Hi! How can I assist you today?')) throw new Error('floating_session_history_leaked')
  await page.getByText('say hi', { exact: true }).first().click()
  await panel.getByText('Hi! How can I assist you today?', { exact: true }).waitFor()
  console.log(JSON.stringify({ floatingSessionSwitch: true }))
  await panel.getByRole('button', { name: '关闭浮动工作区', exact: true }).click()
  console.log(JSON.stringify({ errors }))
  await page.screenshot({ path: 'desktop-test-logs/p0-web-3081-initial.png' })
} finally { await browser.close() }
