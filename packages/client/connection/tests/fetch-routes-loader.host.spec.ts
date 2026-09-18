/** Fetch route registration through Loader, browser authentication, and the real HTTP bridge. */
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
import type { ConnectionFetchRoute } from '../src/rpc.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

const routePluginName = 'test-fetch-routes'

async function loadFixture(routes: readonly ConnectionFetchRoute[]) {
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
    { name: '@deepseek-ai/dsh-client-connection', config: { maxRequestBodyBytes: 4 } },
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
  const shared = ctx.connection.createSharedFetchHandler('/api')
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
