/** Fetch route registration through Loader, browser authentication, and the real HTTP bridge. */
import { createTrustedConnectionAccess } from '../src/rpc.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as Connection from '../src/index.ts'
import type { ConnectionFetchRoute, HostConnectionAccess } from '../src/rpc.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

const routePluginName = 'test-fetch-routes'

async function loadFixture(routes: readonly ConnectionFetchRoute[], maxRequestBodyBytes = 4) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-connection-fetch-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  const routePlugin = {
    inject: ['connection', 'webServer'],
    apply(scope: Context) {
      for (const route of routes) scope.connection.fetch.register(route)
      scope.effect(() => scope.webServer.register({
        kind: 'exact', path: '/',
        handler(request, response) {
          if (!scope.connection.authorizeIndex(request, response)) return
          response.writeHead(200, { 'content-type': 'text/html' })
          response.end('<title>Fetch route fixture</title>')
        },
      }))
    },
  }
  const rows = [
    { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
    { name: 'test-browser-credentials' },
    { name: '@deepseek-ai/dsh-client-connection', config: { maxRequestBodyBytes } },
    { name: routePluginName },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['test-browser-credentials', { apply: provideBrowserCredentials }],
    ['@deepseek-ai/dsh-client-connection', Connection],
    [routePluginName, routePlugin],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected Loader module: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const origin = 'http://127.0.0.1:' + String(ctx.webServer.port)
  const shared = ctx.connection.createSharedFetchHandler('/api', createTrustedConnectionAccess())
  return {
    ctx, origin, shared,
    async cookie(): Promise<string> {
      const response = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe('/')
      await response.text()
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
      if (cookie === undefined) throw new Error('Connection did not issue a browser cookie.')
      return cookie
    },
    async setEnabled(enabled: boolean): Promise<void> {
      const entry = [...ctx.loader.entries()].find(item => item.options.name === routePluginName)
      if (entry === undefined) throw new Error('Fetch route Loader entry missing.')
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
  }
}

describe('Connection Fetch Loader composition', () => {
  it('shares local browser identity within one Host and revokes it on disposal without affecting another Host', async () => {
    const first = await loadFixture([], 1024)
    const second = await loadFixture([])
    const access = first.ctx.connection.trustedAccess
    expect(first.ctx.connection.trustedAccess).toBe(access)
    expect(second.ctx.connection.trustedAccess.identity).not.toBe(access.identity)
    const received: HostConnectionAccess[] = []
    first.ctx.connection.rpc.intercept('/api', () => true, async (_endpoint, _payload, _signal, authority) => {
      received.push(authority)
      return { ok: true, value: 'same Host' }
    })
    const cookie = await first.cookie()
    const response = await fetch(first.origin + '/api/local/read', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'local-access', method: 'local/read', payload: {} }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true } })
    expect(received).toEqual([access])
    await first.ctx.fiber.dispose()
    expect(access.signal.aborted).toBe(true)
    expect(second.ctx.connection.trustedAccess.signal.aborted).toBe(false)
  })

  it('denies delegated raw requests before dispatch and passes their exact identity to RPC', async () => {
    const route = vi.fn(async () => new Response('private'))
    const h = await loadFixture([{ path: '/api/private', methods: ['POST'], requestBody: 'streaming', fetch: route }])
    const revoked = new AbortController()
    const denied = new Error('raw route not granted')
    const authorizeFetch = vi.fn((_request: Request) => { throw denied })
    const access: HostConnectionAccess = { kind: 'delegated', identity: {}, signal: revoked.signal, authorizeFetch }
    const shared = h.ctx.connection.createSharedFetchHandler('/api', access)
    const request = new Request(h.origin + '/api/private', { method: 'POST', body: 'unread' })
    await expect(shared.fetch(request)).rejects.toBe(denied)
    expect(route).not.toHaveBeenCalled()
    expect(authorizeFetch.mock.calls[0]?.[0]?.bodyUsed).toBe(false)
    const received: HostConnectionAccess[] = []
    h.ctx.connection.rpc.intercept('/api', endpoint => endpoint === 'granted/read', async (_endpoint, _payload, _signal, authority) => {
      received.push(authority)
      return { ok: true, value: 'allowed by Gateway owner' }
    })
    const rpc = () => shared.fetch(new Request(h.origin + '/api/granted/read', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'access-test', method: 'granted/read', payload: {} }),
    }))
    expect(await (await rpc()).json()).toMatchObject({ result: { ok: true } })
    expect(received).toEqual([access])
    expect(authorizeFetch).toHaveBeenCalledOnce()
    revoked.abort(new Error('delegation revoked'))
    await expect(rpc()).rejects.toBe(revoked.signal.reason)
    expect(received).toHaveLength(1)
  })

  it.each(['carrier', 'request'] as const)('cancels an admitted response producer when %s revokes access', async (source) => {
    const lifetime = new AbortController()
    const caller = new AbortController()
    const cancelled = Promise.withResolvers<unknown>()
    let delivered: Request | undefined
    let authority: HostConnectionAccess | undefined
    const h = await loadFixture([{ path: '/api/stream', methods: ['GET'], requestBody: 'streaming',
      fetch: async (request, access) => {
        delivered = request
        authority = access
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])) },
          cancel(reason) { cancelled.resolve(reason) },
        }))
      },
    }])
    const access: HostConnectionAccess = {
      kind: 'delegated', identity: {}, signal: lifetime.signal, authorizeFetch: () => {},
    }
    const shared = h.ctx.connection.createSharedFetchHandler('/api', access)
    const response = await shared.fetch(new Request(h.origin + '/api/stream', { signal: caller.signal }))
    const reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]))
    expect(authority).toBe(access)
    const pending = reader.read()
    const reason = new Error('explicit revocation')
    const rejected = expect(pending).rejects.toBe(reason)
    ;(source === 'carrier' ? lifetime : caller).abort(reason)
    await rejected
    expect(await cancelled.promise).toBe(reason)
    expect(delivered?.signal.aborted).toBe(true)
  })

  it('revokes an incomplete RPC upload before it can dispatch', async () => {
    const h = await loadFixture([])
    const lifetime = new AbortController()
    const access: HostConnectionAccess = { kind: 'delegated', identity: {}, signal: lifetime.signal, authorizeFetch: () => {} }
    const handler = vi.fn(async () => ({ ok: true as const, value: 'private' }))
    h.ctx.connection.rpc.intercept('/api', () => true, handler)
    const shared = h.ctx.connection.createSharedFetchHandler('/api', access)
    const reading = Promise.withResolvers<undefined>()
    const cancelled = Promise.withResolvers<unknown>()
    const body = new ReadableStream<Uint8Array>({
      pull() { reading.resolve(undefined) },
      cancel(reason) { cancelled.resolve(reason) },
    }, { highWaterMark: 0 })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half',
    }
    const pending = shared.fetch(new Request(h.origin + '/api/granted/read', init))
    await reading.promise
    const reason = new Error('revoked during upload')
    const rejected = expect(pending).rejects.toBe(reason)
    lifetime.abort(reason)
    await rejected
    expect(await cancelled.promise).toBe(reason)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses dispatch after revocation races an asynchronous raw-route authorizer', async () => {
    const admitted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const lifetime = new AbortController()
    const route = vi.fn(async () => new Response('private'))
    const h = await loadFixture([{ path: '/api/private', methods: ['GET'], requestBody: 'streaming', fetch: route }])
    const access: HostConnectionAccess = { kind: 'delegated', identity: {}, signal: lifetime.signal,
      authorizeFetch: async () => { admitted.resolve(undefined); await release.promise },
    }
    const shared = h.ctx.connection.createSharedFetchHandler('/api', access)
    const pending = shared.fetch(new Request(h.origin + '/api/private'))
    await admitted.promise
    lifetime.abort(new Error('revoked during authorization'))
    release.resolve(undefined)
    await expect(pending).rejects.toBe(lifetime.signal.reason)
    expect(route).not.toHaveBeenCalled()
  })

  it('authenticates prefix requests and preserves the Session path for relative resources', async () => {
    const basePath = '/api/sidebar/html/session-1//workspace/site/'
    const html = '<link href="styles/site.css"><img src="images/logo.svg"><script src="main.js"></script>'
    const contents = new Map([
      [basePath + 'index.html', html],
      [basePath + 'styles/site.css', 'body { color: blue }'],
      [basePath + 'images/logo.svg', '<svg></svg>'],
      [basePath + 'main.js', 'document.title = "preview"'],
    ])
    const handler = vi.fn(async (request: Request) => {
      const body = contents.get(new URL(request.url).pathname)
      return new Response(request.method === 'HEAD' ? null : body, { status: body === undefined ? 404 : 200 })
    })
    const h = await loadFixture([{
      path: '/api/sidebar/html/', match: 'prefix', methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: handler,
    }])
    const documentUrl = new URL(basePath + 'index.html', h.origin)
    for (const method of ['GET', 'HEAD', 'POST']) {
      const denied = await fetch(documentUrl, { method })
      expect(denied.status).toBe(401)
      await denied.text()
    }
    const rootDenied = await fetch(h.origin)
    expect(rootDenied.status).toBe(401)
    await rootDenied.text()
    const queryToken = new URL(documentUrl)
    queryToken.search = new URL(h.ctx.connection.authenticatedUrl(h.origin)).search
    const deniedToken = await fetch(queryToken)
    expect(deniedToken.status).toBe(401)
    await deniedToken.text()
    expect(handler).not.toHaveBeenCalled()
    const cookie = await h.cookie()
    const crossOrigin = await fetch(documentUrl, { headers: { cookie, origin: 'http://untrusted.invalid' } })
    expect(crossOrigin.status).toBe(403)
    await crossOrigin.text()
    expect(handler).not.toHaveBeenCalled()
    const document = await fetch(documentUrl, { headers: { cookie } })
    expect(document.status).toBe(200)
    expect(await document.text()).toBe(html)
    for (const resource of ['styles/site.css', 'images/logo.svg', 'main.js']) {
      const url = new URL(resource, documentUrl)
      const response = await fetch(url, { headers: { cookie } })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(contents.get(basePath + resource))
    }
    const head = await fetch(documentUrl, { method: 'HEAD', headers: { cookie } })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(handler).toHaveBeenCalledTimes(5)
    for (const path of ['/api/sidebar/htmlish/file', '/api/sidebar/html', '/api/sidebar/%68tml/file']) {
      const response = await fetch(h.origin + path, { headers: { cookie } })
      expect(response.status, path).toBe(404)
      await response.text()
    }
    const deniedMethod = await fetch(documentUrl, { method: 'POST', headers: { cookie } })
    expect(deniedMethod.status).toBe(404)
    await deniedMethod.text()
    expect(handler).toHaveBeenCalledTimes(5)
    await h.setEnabled(false)
    const withdrawn = await fetch(documentUrl, { headers: { cookie } })
    expect(withdrawn.status).toBe(404)
    await withdrawn.text()
    expect((await h.shared.fetch(new Request(documentUrl))).status).toBe(404)
    await h.setEnabled(true)
    const restored = await fetch(documentUrl, { headers: { cookie } })
    expect(restored.status).toBe(200)
    expect(await restored.text()).toBe(html)
  })

  it('uses the selected route body mode and keeps the buffered request cap', async () => {
    const streaming = vi.fn(async (request: Request) => new Response(await request.text()))
    const buffered = vi.fn(async () => new Response('buffered'))
    const h = await loadFixture([
      { path: '/api/upload/', match: 'prefix', methods: ['POST'], requestBody: 'streaming', fetch: streaming },
      { path: '/api/upload/buffered', methods: ['POST'], requestBody: 'buffered', fetch: buffered },
    ])
    const cookie = await h.cookie()
    const allowed = await fetch(h.origin + '/api/upload/file', { method: 'POST', headers: { cookie }, body: 'over cap' })
    expect(allowed.status).toBe(200)
    expect(await allowed.text()).toBe('over cap')
    expect(streaming).toHaveBeenCalledOnce()
    const denied = await fetch(h.origin + '/api/upload/buffered', { method: 'POST', headers: { cookie }, body: 'over cap' })
    expect(denied.status).toBe(413)
    await denied.text()
    expect(buffered).not.toHaveBeenCalled()
    expect(streaming).toHaveBeenCalledOnce()
  })

  it('cancels and settles a late prefix response when the authenticated client disconnects', async () => {
    const entered = Promise.withResolvers<AbortSignal>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const cancelled = Promise.withResolvers<undefined>()
    const client = new AbortController()
    let activeSignal: AbortSignal | undefined
    const h = await loadFixture([{
      path: '/api/late/', match: 'prefix', methods: ['GET'], requestBody: 'buffered',
      async fetch(request) {
        activeSignal = request.signal
        request.signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
        if (request.signal.aborted) aborted.resolve(undefined)
        entered.resolve(request.signal)
        await release.promise
        return new Response(new ReadableStream({ cancel() { cancelled.resolve(undefined) } }))
      },
    }])
    const cookie = await h.cookie()
    const pending = fetch(h.origin + '/api/late/file', { headers: { cookie }, signal: client.signal })
    const outcome = pending.catch((error: unknown) => error)
    onTestFinished(async () => {
      client.abort()
      await outcome
      if (activeSignal !== undefined) await aborted.promise
      release.resolve(undefined)
      if (activeSignal !== undefined) await cancelled.promise
    })
    const signal = await entered.promise
    await h.setEnabled(false)
    const withdrawn = await fetch(h.origin + '/api/late/file', { headers: { cookie } })
    expect(withdrawn.status).toBe(404)
    await withdrawn.text()
    client.abort()
    await aborted.promise
    expect(signal.aborted).toBe(true)
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    release.resolve(undefined)
    await cancelled.promise
  })
})
