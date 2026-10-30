/** Exercise the real Host and mobile build without printing enrollment credentials. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const log = readFileSync(new URL('../desktop-test-logs/p0-web-3081-profile-20261021.log', import.meta.url), 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3081[^\s]*/)?.[0]
if (!url) throw new Error('startup_url_unavailable')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(url)
  await page.waitForTimeout(1500)
  const state = await page.evaluate(async () => {
    const response = await fetch('api/mobile-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'mobile-admin', payload: { operation: 'state' } }) })
    const envelope = await response.json()
    if (!envelope.result.ok) throw new Error('mobile_admin_unavailable')
    return envelope.result.value
  })
  console.log(JSON.stringify({ mode: state.settings.mode, port: state.port, relayStatus: state.relayStatus, deviceCount: state.devices.length, addressCount: state.addresses.length }))
  const admin = payload => page.evaluate(async payload => {
    const response = await fetch('api/mobile-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'mobile-admin', payload }) })
    const envelope = await response.json()
    if (!envelope.result.ok) throw new Error(String(envelope.result.error?.message ?? 'mobile_admin_rejected').replace(/https?:\/\/[^\s]+/g, '<URL_REDACTED>'))
    return envelope.result.value
  }, payload)
  const staleAddress = state.settings.mode === 'lan' && state.settings.address && !state.addresses.includes(state.settings.address)
  let phone
  let deviceId
  try {
    if (staleAddress) await admin({ operation: 'save', settings: { ...state.settings, address: '' } })
    const pairing = await admin({ operation: 'pair' })
    phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await phone.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      window.__mobileCloses = []
      window.__mobileSockets = []
      window.WebSocket = class extends NativeWebSocket {
        constructor(...args) {
          super(...args)
          window.__mobileSockets.push(this)
          this.addEventListener('close', event => window.__mobileCloses.push({ code: event.code, reason: event.reason }))
        }
      }
    })
    const errors = []
    const sockets = []
    phone.on('websocket', socket => {
      const record = { sent: [], received: [], closed: false }
      sockets.push(record)
      socket.on('framesent', frame => record.sent.push(frame.payload.length))
      socket.on('framereceived', frame => record.received.push(frame.payload.length))
      socket.on('close', () => { record.closed = true })
    })
    phone.on('pageerror', () => errors.push('pageerror'))
    await phone.goto(pairing.pairingUrl)
    await phone.waitForFunction(() => localStorage.getItem('cinlan-mobile:hosts-v1') !== null, undefined, { timeout: 20000 })
    deviceId = await phone.evaluate(() => JSON.parse(localStorage.getItem('cinlan-mobile:hosts-v1'))[0].deviceId)
    console.log(JSON.stringify({ paired: true, errors }))
    await phone.screenshot({ path: 'desktop-test-logs/p0-mobile-dashboard.png' })
    await phone.getByText(state.settings.name, { exact: true }).click()
    await phone.waitForTimeout(600)
    verification: {
    if (process.argv.includes('--live') || process.argv.includes('--permission')) {
      const permissionOnly = process.argv.includes('--permission')
      const title = (permissionOnly ? 'Mobile permission acceptance ' : 'Mobile live acceptance ') + Date.now()
      await phone.getByRole('button', { name: '新建会话', exact: true }).click()
      await phone.getByPlaceholder('输入名称或搜索源...').fill(title)
      await phone.getByRole('button', { name: '创建会话', exact: true }).click()
      await phone.getByRole('textbox', { name: '会话消息', exact: true }).waitFor()
      if (permissionOnly) {
        const sessionId = await page.evaluate(async title => {
          const response = await fetch('api/session/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/list', payload: { args: { _request: {} } } }) })
          const result = (await response.json()).result
          if (!result.ok) throw new Error('session_list_unavailable')
          const created = result.value.items.find(item => item.projections?.values.title === title)
          if (!created) throw new Error('created_session_not_listed')
          return created.sessionId
        }, title)
        const currentValue = await page.evaluate(async sessionId => {
          const response = await fetch('api/session/projections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/projections', payload: { args: { request: { sessionId } } } }) })
          const result = (await response.json()).result
          if (!result.ok) throw new Error('session_projections_unavailable')
          return result.value?.values.permissions?.currentValue
        }, sessionId)
        if (currentValue !== 'workspace-write') throw new Error('new_session_permission_mismatch')
        await page.evaluate(sessionId => localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId })), sessionId)
        await page.reload()
        await page.getByRole('button', { name: '访问模式，当前：工作区内修改', exact: true }).waitFor()
        await page.screenshot({ path: 'desktop-test-logs/closure-new-session-permission.png' })
        console.log(JSON.stringify({ newMobileSessionWorkspaceWrite: true, currentValue, title, errors }))
        await page.getByText('Mobile live acceptance 1792564996689', { exact: true }).click()
        await page.getByRole('button', { name: '访问模式，当前：Custom', exact: true }).waitFor()
        console.log(JSON.stringify({ previousSessionCustomPreserved: true }))
        await phone.getByRole('button', { name: '返回', exact: true }).click()
        await phone.getByText('Mobile live acceptance 1792564996689', { exact: true }).click()
        await phone.locator('main .theme-card').filter({ hasText: 'CINLAN_MOBILE_LIVE_OK' }).waitFor()
        console.log(JSON.stringify({ previousAssistantReplyAfterHostRestart: true }))
        break verification
      }
      await phone.evaluate(() => {
        window.__liveSeen = { streaming: false, completed: false }
        window.__liveObserver = new MutationObserver(() => {
          const text = document.body.innerText
          if (text.includes('Agent 正在回复')) window.__liveSeen.streaming = true
          if (text.includes('CINLAN_MOBILE_LIVE_OK')) window.__liveSeen.completed = true
        })
        window.__liveObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
      })
      await phone.getByRole('textbox', { name: '会话消息', exact: true }).fill('不要调用工具，不要读取文件。请直接回复 CINLAN_MOBILE_LIVE_OK，然后写一段约 150 字的中文，解释为什么要区分流式输出与持久化历史。')
      await phone.getByRole('button', { name: '发送', exact: true }).click()
      await phone.waitForFunction(() => {
        const text = document.body.innerText
        return window.__liveSeen.streaming && text.includes('CINLAN_MOBILE_LIVE_OK') && !text.includes('Agent 正在回复') && !text.includes('Agent 正在思考')
      }, undefined, { timeout: 180000 })
      const live = await phone.evaluate(() => { window.__liveObserver.disconnect(); return window.__liveSeen })
      console.log(JSON.stringify({ title, live, errors }))
      await phone.screenshot({ path: 'desktop-test-logs/closure-mobile-live-completed.png' })
      await phone.reload()
      await phone.getByText(state.settings.name, { exact: true }).waitFor()
      await phone.getByText(state.settings.name, { exact: true }).click()
      await phone.getByText(title, { exact: true }).click()
      await phone.getByText(/CINLAN_MOBILE_LIVE_OK/).last().waitFor({ timeout: 20000 })
      console.log(JSON.stringify({ completedHistoryAfterRefresh: true, errors }))
      await page.reload()
      await page.getByText(title, { exact: true }).click()
      await page.waitForTimeout(1500)
      console.log(JSON.stringify({ webAccessMode: await page.getByRole('button').evaluateAll(items => items.map(item => item.getAttribute('aria-label')).filter(label => label?.startsWith('访问模式'))), webHistory: (await page.locator('body').innerText()).includes('CINLAN_MOBILE_LIVE_OK') }))
      break verification
    }
    console.log(JSON.stringify({ sessionListHasTarget: await phone.getByText('say hi', { exact: true }).count() === 1 }))
    await phone.getByText('say hi', { exact: true }).click()
    await phone.getByText('Hi! How can I assist you today?', { exact: true }).waitFor({ timeout: 20000 })
    console.log(JSON.stringify({ historyVisible: true, errors, sockets, closes: await phone.evaluate(() => window.__mobileCloses) }))
    await phone.evaluate(() => window.__mobileSockets.at(-1).close())
    await phone.waitForTimeout(3000)
    if (!(await phone.locator('body').innerText()).includes('已连接')) throw new Error('reconnect_not_paired')
    if (await phone.getByText('Hi! How can I assist you today?', { exact: true }).count() !== 1) throw new Error('reconnect_history_missing')
    console.log(JSON.stringify({ reconnectHistoryVisible: true }))
    await phone.reload()
    await phone.getByText(state.settings.name, { exact: true }).waitFor()
    await phone.getByText(state.settings.name, { exact: true }).click()
    await phone.getByText('say hi', { exact: true }).click()
    await phone.getByText('Hi! How can I assist you today?', { exact: true }).waitFor({ timeout: 20000 })
    console.log(JSON.stringify({ refreshHistoryVisible: true }))
    await phone.getByRole('button', { name: '返回', exact: true }).click()
    await phone.getByText('安全研究启动 (1)', { exact: true }).click()
    await phone.waitForTimeout(1000)
    if (await phone.getByText('Hi! How can I assist you today?', { exact: true }).count() !== 0) throw new Error('session_history_leaked')
    await phone.getByRole('button', { name: '返回', exact: true }).click()
    await phone.getByText('say hi', { exact: true }).click()
    await phone.getByText('Hi! How can I assist you today?', { exact: true }).waitFor({ timeout: 20000 })
    console.log(JSON.stringify({ sessionSwitchIsolated: true, originalHistoryRetained: true }))
    await phone.screenshot({ path: 'desktop-test-logs/p0-mobile-history.png' })
    }
  } finally {
    try {
      await phone?.close()
    } finally {
      try {
        if (deviceId && !state.devices.some(device => device.id === deviceId)) await admin({ operation: 'revoke', deviceId })
      } finally {
        if (staleAddress) await admin({ operation: 'save', settings: state.settings })
      }
    }
  }
} finally { await browser.close() }
