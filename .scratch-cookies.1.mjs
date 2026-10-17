/** Reconcile the browser cookie jar for CLH web auth (scratch). */
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'

const CDP = process.env.CDP_HTTP ?? 'http://127.0.0.1:8015'
const ORIGIN = 'http://127.0.0.1:3080'
const AUTHORITY = new URL(ORIGIN).host

const encodeB64url = (v) => Buffer.from(v).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const decodeB64url = (t) => Buffer.from(t.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (t.length % 4)) % 4), 'base64')
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

const yaml = readFileSync('C:/Users/ASUS/.clh/.credentials.yaml', 'utf8')
const secret = decodeB64url(yaml.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/u)[1])

const issuedAt = Date.now() - 60_000
const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
const body = encodeB64url(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt, expiresAt }), 'utf8'))
const value = `v1.${body}.${encodeB64url(createHmac('sha256', secret).update(body).digest())}`
const name = 'dsh-auth-' + encodeB64url(createHash('sha256').update(AUTHORITY).digest())
console.log('expected value sha:', sha(value), 'len:', value.length)

const targets = await (await fetch(CDP + '/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.startsWith(ORIGIN) && !t.url.includes('devtools'))
console.log('target:', page?.url, page?.id)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let nextId = 1
const pending = new Map()
socket.onmessage = (e) => { const m = JSON.parse(e.data); const s = pending.get(m.id); if (s) { pending.delete(m.id); s(m) } }
const cdp = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })

await cdp('Network.enable', {})

// List everything visible to this browser.
const all = (await cdp('Network.getAllCookies', {})).result.cookies.filter(c => c.name.startsWith('dsh-auth'))
console.log('existing dsh-auth cookies:', all.length)
for (const c of all) console.log(' -', c.name.slice(0, 24) + '…', 'sha:', sha(c.value), 'len:', c.value.length, 'domain:', c.domain, 'path:', c.path, 'sourcePort:', c.sourcePort)

// Remove every one of them (any stale/truncated copy shadows the fresh one).
for (const c of all) {
  const r = await cdp('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path })
  console.log('deleted', c.name.slice(0, 24) + '…', JSON.stringify(r.result ?? {}))
}

// Set exactly one fresh cookie.
const set = await cdp('Network.setCookie', {
  name, value, url: ORIGIN + '/', path: '/',
  expires: Math.floor(expiresAt / 1000), httpOnly: true, sameSite: 'Strict', secure: false,
})
console.log('setCookie:', JSON.stringify(set.result))

// Read back and compare byte-for-byte.
const back = (await cdp('Network.getCookies', { urls: [ORIGIN + '/'] })).result.cookies.filter(c => c.name.startsWith('dsh-auth'))
for (const c of back) console.log('readback', c.name.slice(0, 24) + '…', 'sha:', sha(c.value), 'len:', c.value.length, 'equal:', c.value === value)

// Have the page itself confirm what the server answers with this jar.
const evalResult = await cdp('Runtime.evaluate', {
  expression: `(async () => { const r = await fetch('/', { redirect: 'manual', cache: 'no-store' }); const c = document.cookie ? 'js-cookies:' + document.cookie.length : 'js-cookies:0'; return 'fetch=' + r.status + ' ' + c; })()`,
  awaitPromise: true, returnByValue: true,
})
console.log('page probe:', JSON.stringify(evalResult.result?.result?.value ?? evalResult.result))

socket.close()
console.log('RECONCILE-DONE')
