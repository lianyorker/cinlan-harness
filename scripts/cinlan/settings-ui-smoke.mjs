/** Inspect the running Web profile without exposing its authentication URL. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '../../apps/web/node_modules/playwright/index.mjs'

const log = await readFile(join(process.env.TEMP, 'cinlan-ui-repair-web.out.log'), 'utf8')
const url = log.split(/\s+/u).find(part => part.startsWith('http://127.0.0.1:3080/?token='))
if (!url) throw new Error('Authenticated startup URL missing')
try {
  await fetch('http://127.0.0.1:9222/json/version')
} catch {
  const child = spawn(chromium.executablePath(), [
    '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP, 'cinlan-ui-review-browser'), 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
}
let browser
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
    break
  } catch (error) {
    if (attempt === 29) throw error
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}
try {
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? await context.newPage()
  await page.setViewportSize({ width: 1680, height: 1000 })
  const errors = []
  const failedRequests = []
  const cancelledRequests = []
  let settingsOpened = false
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => {
    const failure = { path: new URL(request.url()).pathname, error: request.failure()?.errorText }
    // Opening settings unmounts the composer and cancels its skill prewarm.
    if (settingsOpened && failure.path === '/api/skills/list' && failure.error === 'net::ERR_ABORTED') {
      cancelledRequests.push(failure)
    } else failedRequests.push(failure)
  })
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push({ path: new URL(response.url()).pathname, status: response.status() })
  })
  await page.goto(url)
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  await trigger.waitFor()
  const triggerIcons = await trigger.locator('svg').count()
  settingsOpened = true
  await trigger.click()
  const settings = page.getByRole('region', { name: '设置', exact: true })
  const nav = settings.getByRole('navigation', { name: '设置导航', exact: true })
  await nav.waitFor()
  const result = { triggerIcons, navigationWidth: (await nav.boundingBox()).width,
    entries: await nav.getByRole('button').allTextContents(), sections: [], errors, failedRequests, cancelledRequests }
  for (const label of ['通用设置', '通知', '语音', '快捷键', '编排', '模型']) {
    await nav.getByRole('button', { name: label, exact: true }).click()
    await settings.getByRole('heading', { name: label, level: 1, exact: true }).waitFor()
    result.sections.push({ label, overflow: await settings.evaluate(element => element.scrollWidth > element.clientWidth) })
  }
  await nav.getByRole('button', { name: '入门引导', exact: true }).click()
  await settings.getByRole('heading', { name: '模型', level: 1, exact: true }).waitFor()
  await page.screenshot({ path: 'reports/ui-repair-latest-wide.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await settings.getByRole('button', { name: '打开设置导航', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '设置导航', exact: true })
  await drawer.getByRole('button', { name: '通用设置', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  result.narrowOverflow = await settings.evaluate(element => element.scrollWidth > element.clientWidth)
  await page.screenshot({ path: 'reports/ui-repair-latest-narrow.png' })
  await page.setViewportSize({ width: 1680, height: 1000 })
  await nav.waitFor()
  await page.screenshot({ path: 'reports/ui-repair-latest-general.png' })
  await writeFile('reports/ui-repair-latest-browser.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  if (errors.length || failedRequests.length || result.navigationWidth !== 280 || result.narrowOverflow
    || result.sections.some(section => section.overflow) || triggerIcons === 0) throw new Error('Settings browser smoke failed')
} finally {
  await browser.close()
}
