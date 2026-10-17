/** Full boot failure capture: body text + console errors to files (scratch). */
const mod = await import('file:///D:/Company/cinlan/apps/cinlan-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs')
const { chromium } = mod
const fs = await import('node:fs/promises')
const browser = await chromium.connectOverCDP(process.env.CDP_HTTP ?? 'http://127.0.0.1:8015')
const context = browser.contexts()[0]
const page = await context.newPage()
const problems = []
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') problems.push(`[${message.type()}] ${message.text()}`) })
page.on('pageerror', error => problems.push(`[pageerror] ${String(error.message)}\n${String(error.stack ?? '').slice(0, 800)}`))
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'load', timeout: 60_000 })
let last = ''
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  const text = await page.evaluate(() => document.body.innerText)
  if (text === last && i > 4) break
  last = text
}
await fs.writeFile('.scratch-boot-body.txt', last)
await fs.writeFile('.scratch-boot-console.txt', problems.join('\n\n'))
console.log('body chars:', last.length, 'console messages:', problems.length)
const apiRemotes = problems.filter(text => text.includes('api-remotes'))
console.log('=== api-remotes mentions ===')
console.log(apiRemotes.slice(0, 6).join('\n---\n').slice(0, 4000) || '(none)')
await page.close()
await browser.close()
console.log('CAPTURE2-DONE')
