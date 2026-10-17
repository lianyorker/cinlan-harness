/** Capture the api-remotes apply error: all console types + boot manifest (scratch). */
const mod = await import('file:///D:/Company/cinlan/apps/cinlan-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs')
const { chromium } = mod
const fs = await import('node:fs/promises')
const browser = await chromium.connectOverCDP(process.env.CDP_HTTP ?? 'http://127.0.0.1:8015')
const context = browser.contexts()[0]
const page = await context.newPage()
const messages = []
page.on('console', message => { messages.push(`[${message.type()}] ${message.text()}`) })
page.on('pageerror', error => messages.push(`[pageerror] ${String(error.message)}`))
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'load', timeout: 60_000 })
await page.waitForTimeout(12_000)
const manifest = await page.evaluate(() => {
  const boot = window.__DSH_BOOT__
  return boot === undefined ? 'no __DSH_BOOT__' : JSON.stringify({ rev: boot.rev, batches: boot.batches?.length })
})
const interesting = messages.filter(text =>
  text.includes('api-remotes') && !text.includes('pending')
  || text.includes('terminalQuickCommands')
  || text.includes('$mount')
  || /apply failed|activation failed|fiber/i.test(text))
await fs.writeFile('.scratch-boot3-all.txt', messages.join('\n\n'))
console.log('total messages:', messages.length)
console.log('manifest:', manifest)
console.log('=== interesting (first 8) ===')
console.log(interesting.slice(0, 8).join('\n---\n').slice(0, 5000) || '(none)')
await page.close()
await browser.close()
console.log('CAPTURE3-DONE')
