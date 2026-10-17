/**
 * Local acceptance helper (scratch): mint the browser-auth cookie for the
 * running CLH web instance from the persistent signing secret, then set it
 * into the IDE automation browser over CDP. Reads the secret directly from
 * disk so the value never needs to pass through an agent transcript.
 */
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'

const CDP = process.env.CDP_HTTP ?? 'http://127.0.0.1:8610'
const ORIGIN = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3080'
const AUTHORITY = new URL(ORIGIN).host

function encodeB64url(value) {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}
function decodeB64url(text) {
  const pad = '='.repeat((4 - (text.length % 4)) % 4)
  return Buffer.from(text.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64')
}

// 1. Persistent signing secret (client-connection/browser-session).
const yaml = readFileSync('C:/Users/ASUS/.clh/.credentials.yaml', 'utf8')
const match = yaml.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/u)
if (match === null) throw new Error('browser-session secret not found in .credentials.yaml')
const secret = decodeB64url(match[1])
console.log(`secret: ${secret.length} bytes`)

// 2. Build the v1 cookie exactly as BrowserAuth.encodeCookie does.
const issuedAt = Date.now() - 60_000
const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
const body = encodeB64url(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt, expiresAt }), 'utf8'))
const signature = encodeB64url(createHmac('sha256', secret).update(body).digest())
const value = `v1.${body}.${signature}`
const name = 'dsh-auth-' + encodeB64url(createHash('sha256').update(AUTHORITY).digest())
console.log(`cookie name: ${name}`)

// 3. Sanity check: a request carrying the cookie must get the index (200).
const probe = await fetch(ORIGIN + '/', { headers: { cookie: `${name}=${value}` }, redirect: 'manual' })
console.log(`probe: ${probe.status} ${probe.headers.get('content-type') ?? ''}`)
if (probe.status !== 200) throw new Error(`probe expected 200, got ${probe.status}`)

// 4. Set the cookie in the automation browser over CDP.
const targets = await (await fetch(CDP + '/json/list')).json()
const page = targets.find(target => target.type === 'page' && target.url.startsWith(ORIGIN))
if (page === undefined) throw new Error('no 3080 page target in the automation browser')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let nextId = 1
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const settle = pending.get(message.id)
  if (settle !== undefined) { pending.delete(message.id); settle(message) }
}
function cdp(method, params) {
  const id = nextId++
  return new Promise((resolve) => { pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })
}
await cdp('Network.enable', {})
const outcome = await cdp('Network.setCookie', {
  name, value, url: ORIGIN + '/', path: '/',
  expires: Math.floor(expiresAt / 1000), httpOnly: true, sameSite: 'Strict', secure: false,
})
console.log('setCookie:', JSON.stringify(outcome.result))
socket.close()
console.log('AUTH-READY')
