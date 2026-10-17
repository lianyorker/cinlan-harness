/** Boot acceptance: load the CLH web app and report whether every entry activated (scratch). */
const mod = await import('file:///D:/Company/cinlan/apps/cinlan-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs')
const { chromium } = mod
const browser = await chromium.connectOverCDP(process.env.CDP_HTTP ?? 'http://127.0.0.1:8015')
const context = browser.contexts()[0]
const page = await context.newPage()
const problems = []
page.on('console', message => { if (message.type() === 'error') problems.push(message.text()) })
page.on('pageerror', error => problems.push(String(error.message)))
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'load', timeout: 60_000 })
// Wait for the body text to stabilize (boot page swaps to the real UI or the failure list).
let last = ''
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  const text = await page.evaluate(() => document.body.innerText)
  if (text === last && i > 4) break
  last = text
}
console.log('url:', page.url(), 'title:', await page.title())
console.log('=== body (first 1500) ===')
console.log(last.slice(0, 1500))
const bootFailed = last.includes('Failed to load plugins')
console.log('=== BOOT', bootFailed ? 'FAILED' : 'OK', '===')
if (bootFailed) console.log(problems.join('\n').slice(0, 5000))
else {
  // Orientation for the next stage: what controls exist on the landing UI.
  const controls = await page.evaluate(() => [...document.querySelectorAll('button,[role=button],a,input,textarea')]
    .map(element => `${element.tagName}:${(element.getAttribute('aria-label') ?? element.textContent ?? element.getAttribute('placeholder') ?? '').trim().slice(0, 40)}`)
    .filter(label => label.length > 3))
  console.log('=== controls (first 40) ===')
  console.log([...new Set(controls)].slice(0, 40).join('\n'))
}
await page.close()
await browser.close()
console.log('BOOT-CHECK-DONE')
