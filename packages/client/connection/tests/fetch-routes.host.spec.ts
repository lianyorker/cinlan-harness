import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ConnectionFetchRoute } from '../src/rpc.ts'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { HostConnectionService } from '../src/rpc-host.ts'

async function mounted(): Promise<{
  readonly ctx: Context
  readonly connection: HostConnectionService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as BrowserAuth)
  })
  await fiber.await()
  return {
    ctx,
    connection: ctx.get('connection') as HostConnectionService,
    dispose: () => fiber.dispose(),
  }
}

describe('Connection Fetch routes', () => {
  it('dispatches owned methods and returns 404 for unclaimed requests', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const route = vi.fn(async (request: Request) =>
      Response.json({ query: new URL(request.url).searchParams.get('sessionId') }))
    const dispose = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET', 'HEAD', 'POST'],
      requestBody: 'streaming',
      fetch: route,
    })
    const shared = connection.createSharedFetchHandler('/api')

    const response = await shared.fetch(new Request(
      'http://host/api/session.export?sessionId=session-1',
    ))
    expect(shared.requestBodyMode({
      method: 'POST', url: new URL('http://host/api/session.export'),
    })).toBe('streaming')
    expect(shared.requestBodyMode({
      method: 'DELETE', url: new URL('http://host/api/session.export'),
    })).toBe('buffered')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ query: 'session-1' })
    expect(route).toHaveBeenCalledOnce()
    const post = await shared.fetch(new Request('http://host/api/session.export', { method: 'POST' }))
    expect(post.status).toBe(200)
    expect(route).toHaveBeenCalledTimes(2)
    for (const path of ['/api/session.export/child', '/api/session.export/', '/api/session.exports']) {
      expect((await shared.fetch(new Request('http://host' + path))).status, path).toBe(404)
    }
    expect(route).toHaveBeenCalledTimes(2)

    await dispose()
    const withdrawn = await shared.fetch(new Request('http://host/api/session.export'))
    expect(withdrawn.status).toBe(404)
    await disposeFiber()
  })

  it.each(['broad-first', 'specific-first'])('selects the longest prefix and then exact ownership: %s', async (order) => {
    const { connection } = await mounted()
    const routes: ConnectionFetchRoute[] = [
      { path: '/api/assets/', match: 'prefix', methods: ['GET', 'POST'], requestBody: 'streaming',
        fetch: async () => new Response('broad') },
      { path: '/api/assets/project/', match: 'prefix', methods: ['GET'], requestBody: 'buffered',
        fetch: async () => new Response('specific') },
      { path: '/api/assets/project/index.html', match: 'exact', methods: ['HEAD'], requestBody: 'streaming',
        fetch: async () => new Response('exact') },
    ]
    for (const route of order === 'broad-first' ? routes : routes.toReversed()) connection.fetch.register(route)
    const rpc = vi.fn(async () => ({ ok: true as const, value: 'rpc' }))
    connection.rpc.intercept('/api', () => true, rpc)
    const shared = connection.createSharedFetchHandler('/api')
    for (const [path, method, bodyMode, status, body] of [
      ['/api/assets/', 'GET', 'streaming', 200, 'broad'],
      ['/api/assets/site.css', 'GET', 'streaming', 200, 'broad'],
      ['/api/assets/project/', 'GET', 'buffered', 200, 'specific'],
      ['/api/assets/project/site.css', 'GET', 'buffered', 200, 'specific'],
      ['/api/assets/project/site.css', 'POST', 'buffered', 404, 'not found'],
      ['/api/assets/project/index.html', 'HEAD', 'streaming', 200, 'exact'],
      ['/api/assets/project/index.html', 'GET', 'buffered', 404, 'not found'],
      ['/api/assets/project/index.html', 'POST', 'buffered', 404, 'not found'],
    ] as const) {
      const url = new URL('http://host' + path)
      expect(shared.requestBodyMode({ method, url }), method + ' ' + path).toBe(bodyMode)
      const response = await shared.fetch(new Request(url, { method }))
      expect(response.status, method + ' ' + path).toBe(status)
      expect(await response.text(), method + ' ' + path).toBe(body)
    }
    expect(rpc).not.toHaveBeenCalled()
    const fallback = await shared.fetch(new Request('http://host/api/unclaimed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fallback', method: 'unclaimed', payload: {} }),
    }))
    expect(await fallback.json()).toMatchObject({ result: { ok: true, value: 'rpc' } })
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('matches literal URL pathnames without capturing lookalikes or decoding escapes', async () => {
    const { connection } = await mounted()
    const route = vi.fn(async (request: Request) => new Response(request.url))
    connection.fetch.register({
      path: '/api/sidebar/html/', match: 'prefix', methods: ['GET'], requestBody: 'buffered', fetch: route,
    })
    const shared = connection.createSharedFetchHandler('/api')
    const literal = 'dsh-app://app/api/sidebar/html/session-1/C:/site/a%252Fb%20c.html?raw=%252F'
    const response = await shared.fetch(new Request(literal))
    expect(await response.text()).toBe(literal)
    expect(route).toHaveBeenCalledOnce()
    for (const path of [
      '/api/sidebar/html', '/api/sidebar/htmlish/file', '/api/sidebar/html-extra/file',
      '/api/sidebar/html%2Fsession/file', '/api/sidebar/%68tml/session/file',
      '/api/sidebar/html%252Fsession/file', '/api2/sidebar/html/session/file',
      '/api//sidebar/html/session/file', '/API/sidebar/html/session/file',
      '/outside?path=/api/sidebar/html/file',
    ]) {
      const url = new URL('dsh-app://app' + path)
      expect((await shared.fetch(new Request(url))).status, path).toBe(404)
      expect(shared.requestBodyMode({ method: 'GET', url }), path).toBe('buffered')
    }
    expect(route).toHaveBeenCalledOnce()
  })

  it('requires a final slash and valid API namespace for prefix registrations', async () => {
    const { connection } = await mounted()
    const route = {
      match: 'prefix', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(),
    } as const
    expect(() => connection.fetch.register({ ...route, path: '/api/assets' })).toThrow('must end in /')
    for (const path of [
      '/', '/api/', '/api2/assets/', '/outside/assets/', 'api/assets/', '//api/assets/',
      '/api//assets/', '/api/assets//', '/api/./assets/', '/api/../assets/',
      '/api/assets/./', '/api/assets/../', '/api/%61ssets/', '/api/assets%2F/',
      '/api/assets?query/', '/api/assets#hash/', '/api/assets\\private/',
    ]) {
      expect(() => connection.fetch.register({ ...route, path }), path).toThrow('invalid prefix Fetch route')
    }
    for (const options of [{}, { match: 'exact' }] as const) {
      expect(() => connection.fetch.register({
        path: '/api/assets/', methods: ['GET'], requestBody: 'buffered', fetch: route.fetch, ...options,
      })).toThrow('invalid exact Fetch route')
    }
    expect(() => connection.fetch.register({ ...route, path: '/api/assets/', methods: [] })).toThrow('declares no methods')
    expect(() => connection.fetch.register({ ...route, path: '/api/assets/', methods: ['GET', 'GET'] })).toThrow('repeats a method')
    const dispose = connection.fetch.register({ ...route, path: '/api/assets/' })
    expect(() => connection.fetch.register({ ...route, path: '/api/assets/', methods: ['HEAD'] })).toThrow('already registered')
    await dispose()
    expect(() => connection.fetch.register({ ...route, path: '/api/assets/' })).not.toThrow()
  })

  it('withdraws a prefix and leaves an active request signal and response with their owners', async () => {
    const { ctx, connection } = await mounted()
    const entered = Promise.withResolvers<Request>()
    const finish = Promise.withResolvers<Response>()
    const responseCancelled = vi.fn()
    const controller = new AbortController()
    const unregister = connection.fetch.register({
      path: '/api/assets/', match: 'prefix', methods: ['GET'], requestBody: 'streaming',
      fetch(request) { entered.resolve(request); return finish.promise },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const request = new Request('http://host/api/assets/file', { signal: controller.signal })
    const pending = shared.fetch(request)
    onTestFinished(async () => {
      controller.abort()
      finish.resolve(new Response())
      await (await pending).body?.cancel()
    })
    expect(await entered.promise).toBe(request)
    await unregister()
    expect((await shared.fetch(new Request(request.url))).status).toBe(404)
    expect(shared.requestBodyMode({ method: 'GET', url: new URL(request.url) })).toBe('buffered')
    controller.abort()
    expect(request.signal.aborted).toBe(true)
    const response = new Response(new ReadableStream({ cancel: responseCancelled }))
    finish.resolve(response)
    expect(await pending).toBe(response)
    await response.body!.cancel()
    expect(responseCancelled).toHaveBeenCalledOnce()
    const contributor = ctx.plugin({
      inject: ['connection'],
      apply(scope: Context) {
        scope.connection.fetch.register({
          path: '/api/assets/', match: 'prefix', methods: ['GET'], requestBody: 'buffered',
          fetch: async () => new Response('replacement'),
        })
      },
    })
    await contributor.await()
    expect(await (await shared.fetch(new Request(request.url))).text()).toBe('replacement')
    await contributor.dispose()
    expect((await shared.fetch(new Request(request.url))).status).toBe(404)
  })

  it('rejects invalid and duplicate registrations', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const fetch = async (): Promise<Response> => new Response()

    expect(() => connection.fetch.register({ path: '/outside', methods: ['GET'], requestBody: 'buffered', fetch }))
      .toThrow('invalid exact Fetch route')
    expect(() => connection.fetch.register({ path: '/api/session.export', methods: [], requestBody: 'buffered', fetch }))
      .toThrow('declares no methods')
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['GET', 'GET'], fetch,
      requestBody: 'buffered',
    })).toThrow('repeats a method')
    const dispose = connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], fetch,
      requestBody: 'buffered',
    })
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
      requestBody: 'buffered',
    })).toThrow('already registered')
    await dispose()
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
      requestBody: 'buffered',
    })).not.toThrow()
    await disposeFiber()
  })
})
