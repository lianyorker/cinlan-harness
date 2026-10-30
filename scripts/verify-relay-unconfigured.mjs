/** Verify the owner-local unconfigured Relay page without exposing authentication data. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const log = readFileSync(new URL('../desktop-test-logs/p0-web-3081-profile-20261021.log', import.meta.url), 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3081[^\s]*/)?.[0]
if (!url) throw new Error('startup_url_unavailable')
let browser
let stage = 'launch'
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(url)
  await page.waitForTimeout(6000)
  stage = 'projection'
  const state = await page.evaluate(async () => {
    const response = await fetch('api/mobile-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'mobile-admin', payload: { operation: 'state' } }) })
    const result = (await response.json()).result
    if (!result.ok) throw new Error('mobile_admin_unavailable')
    return { configured: result.value.relayConfigured, status: result.value.relayStatus, internalAddressHidden: result.value.settings.directorUrl === '' }
  })
  console.log(JSON.stringify(state))
  if (state.configured !== false || state.status !== 'unconfigured' || !state.internalAddressHidden) throw new Error('unconfigured_projection_failed')
  stage = 'navigation'
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '移动端', exact: true }).last().click()
  const section = page.locator('[data-capability=companion]')
  stage = 'notice'
  const notice = section.getByText('当前版本未配置私有 Cinlan IDE Relay 服务。请使用局域网；部署并配置 Cinlan Cloud/Relay 后可启用。', { exact: true })
  await notice.waitFor()
  if (await notice.count() !== 1) throw new Error('duplicate_relay_notice')
  if (await section.getByRole('radio').nth(2).isEnabled()) throw new Error('unconfigured_relay_enabled')
  if ((await section.innerText()).includes('relay.cinlan.online')) throw new Error('internal_address_visible')
  await page.screenshot({ path: 'desktop-test-logs/relay-unconfigured-live.png' })
  console.log(JSON.stringify({ ...state, singleNotice: true, relayDisabled: true }))
} catch (error) {
  console.error('relay_unconfigured_live_failed:' + stage)
  console.error(error instanceof Error ? error.message.split('\n')[0].replace(/https?:\/\/[^\s]+/g, '<URL_REDACTED>') : 'verification_failed')
  process.exitCode = 1
} finally { await browser?.close() }
