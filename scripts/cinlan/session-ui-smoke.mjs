/** Verify Session selection, blank creation, and reload against the running Web profile. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '../../apps/web/node_modules/playwright/index.mjs'

const log = await readFile(join(process.env.TEMP, 'cinlan-ui-repair-web.out.log'), 'utf8')
const url = log.split(/\s+/u).find(part => part.startsWith('http://127.0.0.1:3080/?token='))
if (!url) throw new Error('Authenticated startup URL missing')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
try {
  const page = browser.contexts()[0].pages()[0]
  await page.setViewportSize({ width: 1680, height: 1000 })
  const failures = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (!response.url().includes('/api/')) return
    const path = new URL(response.url()).pathname
    if (response.status() >= 400) failures.push({ path, status: response.status() })
  })
  await page.goto(url)
  const existing = page.getByRole('treeitem', { name: /^安全研究启动/ })
  await existing.waitFor()
  await existing.click()
  const editor = page.locator('[contenteditable="true"]')
  await editor.waitFor()
  await existing.waitFor()
  await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).isEnabled(), true)
  await page.screenshot({ path: 'reports/session-ui-existing-verified.png' })
  const before = await page.getByRole('treeitem').allTextContents()
  const createResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/create')
  await page.getByRole('button', { name: '新建会话', exact: true }).filter({ hasText: '新会话' }).click()
  const created = (await (await createResponse).json()).result
  if (created?.ok === false) failures.push({ path: '/api/session/create', error: created.error })
  assert.equal(created?.ok, true, JSON.stringify(created?.error))
  await editor.waitFor()
  await existing.waitFor()
  await page.screenshot({ path: 'reports/session-ui-created-verified.png' })
  await page.reload()
  await existing.waitFor()
  await existing.click()
  await editor.waitFor()
  await existing.waitFor()
  await page.screenshot({ path: 'reports/session-ui-reloaded-verified.png' })
  const result = {
    before, after: await page.getByRole('treeitem').allTextContents(),
    created: created.value, editable: await editor.count(), failures, errors,
  }
  await writeFile('reports/session-ui-smoke.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  assert.equal(failures.length, 0)
  assert.equal(errors.length, 0)
} finally {
  await browser.close()
}
