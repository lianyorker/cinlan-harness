/** Capture the full boot failure list from the CLH web UI (scratch). */
const mod = await import('file:///D:/Company/cinlan/apps/cinlan-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs')
const { chromium } = mod
const browser = await chromium.connectOverCDP(process.env.CDP_HTTP ?? 'http://127.0.0.1:8015')
const context = browser.contexts()[0]
const page = await context.newPage()
const problems = []
page.on('console', message => { if (message.type() === 'error') problems.push(message.text()) })
page.on('pageerror', error => problems.push(String(error.message)))
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'load', timeout: 60_000 })
await page.waitForTimeout(9_000)
const full = problems.join('\n')
await (await import('node:fs/promises')).writeFile('.scratch-boot-errors.txt', full)
console.log('total problems:', problems.length, 'chars:', full.length)
// Print only lines of the error list (entry: state ...)
const listLines = full.split('\n').filter(line => /^(?:@|\.\/|[\w@][^\s:]*):.*(?:pending|failed|import)/u.test(line))
console.log('entries listed:', listLines.length)
// Root-cause candidates: entries that are NOT pending / failed themselves but provide nothing.
const importFailed = listLines.filter(line => line.includes('import failed'))
const failed = listLines.filter(line => /: (?!pending).*(?:$)/u.test(line) && line.includes(': failed'))
const pending = listLines.filter(line => line.includes('pending'))
console.log('import failed:', importFailed.length)
console.log(importFailed.slice(0, 30).join('\n'))
console.log('failed:', failed.length)
console.log(failed.slice(0, 30).join('\n'))
console.log('pending:', pending.length)
await browser.close()
console.log('CAPTURE-DONE')
