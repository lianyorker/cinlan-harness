/** Drive the CLH web UI through the running automation browser via Playwright CDP (scratch). */
const candidates = [
  'file:///D:/Company/cinlan/apps/cinlan-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs',
  'file:///D:/Company/cinlan/apps/cinlan-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js',
]
let chromium
for (const candidate of candidates) {
  try {
    const mod = await import(candidate)
    chromium = mod.chromium ?? mod.default?.chromium
    if (chromium !== undefined) { console.log('loaded:', candidate.split('/').slice(-2).join('/')); break }
  } catch (error) { console.log('skip:', candidate.split('/').slice(-2).join('/'), String(error).slice(0, 100)) }
}
if (chromium === undefined) throw new Error('playwright not loadable')

const browser = await chromium.connectOverCDP(process.env.CDP_HTTP ?? 'http://127.0.0.1:8015')
const contexts = browser.contexts()
console.log('contexts:', contexts.length)
for (const [index, context] of contexts.entries()) {
  console.log(' context', index, 'pages:', context.pages().map(p => p.url().slice(0, 80)))
}
const context = contexts[0]
const page = await context.newPage()
const problems = []
page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text().slice(0, 300)) })
page.on('pageerror', error => problems.push('pageerror: ' + String(error.message).slice(0, 300)))
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'load', timeout: 60_000 })
await page.waitForTimeout(9_000)
console.log('url:', page.url())
console.log('title:', await page.title())
const body = await page.evaluate(() => document.body.innerText.slice(0, 1600))
console.log('=== body ===')
console.log(body)
await page.screenshot({ path: '.scratch-e2e-1.png', fullPage: false })
console.log('=== problems (first 15) ===')
console.log(problems.slice(0, 15).join('\n') || '(none)')
await browser.close()
console.log('E2E-STEP-DONE')
