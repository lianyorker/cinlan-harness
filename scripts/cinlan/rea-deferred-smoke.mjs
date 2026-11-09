/** Verify that default Settings omits REA while retaining the research preset. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '../../apps/web/node_modules/playwright/index.mjs'

const log = await readFile(join(process.env.TEMP, 'cinlan-ui-repair-web.out.log'), 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+/u)?.[0]
assert.ok(url, 'Authenticated startup URL missing')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
try {
  const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const nav = page.getByRole('navigation', { name: '设置导航', exact: true })
  await nav.waitFor()
  assert.equal(await nav.getByRole('button', { name: '逆向分析', exact: true }).count(), 0)
  assert.equal(await page.locator('[data-capability="rea"]').count(), 0)
  await nav.getByRole('button', { name: 'Agent 预设', exact: true }).click()
  await page.locator('[data-agent-preset-id="security-research"]').waitFor()
  await nav.getByRole('button', { name: '通用设置', exact: true }).click()
  await page.getByRole('heading', { name: '通用设置', level: 1, exact: true }).waitFor()
  await page.screenshot({ path: 'reports/rea-deferred-settings.png' })
  assert.deepEqual(errors, [])
  const result = { reaEntry: false, securityPreset: true, pageErrors: errors.length }
  await writeFile('reports/rea-deferred-browser.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
