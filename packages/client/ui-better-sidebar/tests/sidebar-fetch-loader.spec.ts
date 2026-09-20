/** Real sidebar Loader composition over authenticated Connection Fetch and fenced Web aliases. */
import { createTrustedConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as sidebar from '../src/index.ts'
import { encodeHtmlUrl } from '../src/html-route.ts'
import type { SidebarConfig } from '../src/config.ts'

const artifacts = vi.hoisted(() => ({ directory: '' }))
// Artifact location is an external deployment input; dispatch, reads, ETags, and auth stay real.
vi.mock('../src/bundle-route.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/bundle-route.ts')>()
  return { ...actual, registerSidebarBundleRoute: (fetch: Connection.HostConnectionFetch) =>
    actual.registerSidebarBundleRoute(fetch, artifacts.directory) }
})

const packageName = '@deepseek-ai/dsh-client-ui-better-sidebar'
const apiPath = (method: string): string => '/api/sidebar.api?method=' + encodeURIComponent(method)

export async function load({ web = false, config = {} }: { web?: boolean; config?: SidebarConfig } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sidebar-fetch-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  const cwd = join(root, 'workspace')
  artifacts.directory = join(root, 'artifacts')
  await mkdir(cwd)
  await mkdir(artifacts.directory)
  const settingsPath = join(root, 'settings.yaml')
  await Promise.all([
    writeFile(settingsPath, 'dsh-better-sidebar:\n  agentTerminalTools: false\n'),
    writeFile(join(cwd, 'hello.txt'), 'initial fixture'),
    writeFile(join(artifacts.directory, 'client-editor.js'), 'globalThis.__editorFixture = true;\n'),
    writeFile(join(artifacts.directory, 'client-mermaid.js'), 'globalThis.__mermaidFixture = true;\n'),
    writeFile(join(artifacts.directory, 'client-private.js'), 'private artifact'),
  ])
  const fixture = { inject: ['connection'], apply(scope: Context) {
    if (!web) return
    scope.provide('webRuntime', { trustedHosts: [] } as never)
    scope.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: '/', handler(request, response) {
        if (!webCtx.connection.authorizeIndex(request, response)) return
        response.writeHead(200)
        response.end('fixture')
      } }))
    })
  } }
  const rows = [
    { name: '@deepseek-ai/dsh-session' },
    { name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath } },
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: '@deepseek-ai/dsh-client-connection' },
    ...web ? [{ name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } }] : [],
    { name: 'sidebar-fetch-fixture' },
    { name: packageName, config },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore], ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials], ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-host-webserver', WebServer], ['sidebar-fetch-fixture', fixture], [packageName, sidebar],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected Loader module: ' + specifier)
    return modules.get(specifier)
  } } as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const session = ctx.sessions.create(undefined, { meta: { cwd } })
  const scope = { sessionId: session.id, cwd }
  const shared = ctx.connection.createSharedFetchHandler('/api', createTrustedConnectionAccess())
  const origin = web ? 'http://127.0.0.1:' + String(ctx.webServer.port) : 'http://localhost'
  let cookie = ''
  if (web) {
    const login = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
    expect(login.status).toBe(303)
    cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
    await login.text()
  } else {
    // The index-auth response interface captures a real cookie without a Web listener.
    ctx.connection.authorizeIndex(new Request(ctx.connection.authenticatedUrl(origin), { headers: { host: 'localhost' } }), {
      writeHead(status, headers) { expect(status).toBe(303); cookie = headers?.['set-cookie']?.split(';', 1)[0] ?? '' },
      end() {},
    })
  }
  expect(cookie).not.toBe('')
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set('host', new URL(origin).host)
    headers.set('cookie', cookie)
    const req = new Request(origin + path, { ...init, headers })
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) throw new Error('Fixture authentication rejected: ' + String(rejection))
    return shared.fetch(req)
  }
  return {
    ctx, root, cwd, scope, settingsPath, shared, origin, cookie, request,
    call(method: string, payload: unknown = {}) {
      return request(apiPath(method), { method: 'POST', body: JSON.stringify(payload) })
    },
    uploadPath(relativePath: string) {
      return '/api/sidebar.upload?' + new URLSearchParams({ ...scope, dir: cwd, relativePath }).toString()
    },
    mediaPath(path: string, download = false) {
      return '/api/sidebar.file?' + new URLSearchParams({ ...scope, path, ...download ? { download: '1' } : {} }).toString()
    },
    async setEnabled(enabled: boolean) {
      const entry = [...ctx.loader.entries()].find(item => item.options.name === packageName)
      if (entry === undefined) throw new Error('Sidebar Loader entry missing')
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
  }
}

async function value<T>(response: Response): Promise<T> {
  const body = await response.json() as { ok: boolean; value: T }
  expect(response.status, JSON.stringify(body)).toBe(200)
  expect(body.ok).toBe(true)
  return body.value
}

function streaming(body: ReadableStream<Uint8Array>, signal?: AbortSignal): RequestInit {
  return { method: 'POST', body, signal, duplex: 'half' } as RequestInit & { duplex: 'half' }
}

function bytes(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    controller.close()
  } })
}

describe('sidebar authenticated Shared Fetch through Loader', () => {
  it('lists the default Files home, reads and saves a fixture, and persists revision-guarded settings without Web', async () => {
    const h = await load()
    expect(h.ctx.get('webServer')).toBeUndefined()
    expect(h.ctx.get('webRuntime')).toBeUndefined()
    const listing = await value<{ path: string; entries: Array<{ name: string }> }>(await h.call('fs.tree', h.scope))
    expect(listing.path).toBe(h.cwd)
    expect(listing.entries.map(entry => entry.name)).toEqual(['hello.txt'])
    const path = join(h.cwd, 'hello.txt')
    expect(await value(await h.call('fs.read', { ...h.scope, path }))).toMatchObject({ content: 'initial fixture' })
    await value(await h.call('fs.write', { ...h.scope, path, content: 'saved fixture' }))
    expect(await readFile(path, 'utf8')).toBe('saved fixture')
    const settings = await value<{ revision: number }>(await h.call('settings.get'))
    const saved = await value<{ revision: number; value: { editorExplorer: boolean } }>(await h.call('settings.update', {
      patch: { editorExplorer: true }, expectedRevision: settings.revision,
    }))
    expect(saved.value.editorExplorer).toBe(true)
    expect(saved.revision).toBeGreaterThan(settings.revision)
    expect(await readFile(h.settingsPath, 'utf8')).toContain('editorExplorer: true')
    expect((await h.call('settings.update', { patch: { editorExplorer: false }, expectedRevision: settings.revision })).status).toBe(409)
    const missingAuth = new Request(h.origin + apiPath('fs.tree'), { headers: { host: 'localhost' } })
    expect(h.ctx.connection.requestRejection(missingAuth)).toBe(401)
    const foreignOrigin = new Request(h.origin + apiPath('fs.tree'), { headers: { host: 'localhost', cookie: h.cookie, origin: 'https://untrusted.invalid' } })
    expect(h.ctx.connection.requestRejection(foreignOrigin)).toBe(403)
  })

  it('retains the JSON byte bound and error envelope, and rejects unknown own-property names', async () => {
    const h = await load()
    for (const method of ['missing', 'constructor', '__proto__', 'fs/tree']) {
      const response = await h.call(method)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not-found' } })
    }
    const malformed = await h.request(apiPath('fs.tree'), { method: 'POST', body: '{' })
    expect(await malformed.json()).toMatchObject({ ok: false, error: { code: 'bad-request', message: 'request body is not valid JSON' } })
    const body = JSON.stringify(h.scope)
    const exact = body + ' '.repeat((1 << 20) - new TextEncoder().encode(body).byteLength)
    expect((await h.request(apiPath('fs.tree'), { method: 'POST', body: exact })).status).toBe(200)
    const oversized = await h.request(apiPath('fs.tree'), { method: 'POST', body: exact + 'é' })
    expect(oversized.status).toBe(400)
    expect(await oversized.json()).toMatchObject({ ok: false, error: { message: 'request body too large' } })
  })

  it('streams uploads at the configured cap and cleans failed, cancelled, and oversized temporary files', async () => {
    const h = await load({ config: { uploadLimit: 6 } })
    const target = join(h.cwd, 'upload.txt')
    expect(h.shared.requestBodyMode({ method: 'POST', url: new URL(h.origin + h.uploadPath('upload.txt')) })).toBe('streaming')
    expect(await value(await h.request(h.uploadPath('upload.txt'), streaming(bytes('abc', 'def'))))).toEqual({ path: target, size: 6 })
    expect(await readFile(target, 'utf8')).toBe('abcdef')
    const oversized = await h.request(h.uploadPath('upload.txt'), streaming(bytes('abc', 'defg')))
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toMatchObject({ ok: false, error: { code: 'too-large' } })
    expect(await readFile(target, 'utf8')).toBe('abcdef')
    const lifetime = new AbortController()
    let markCancelled = (): void => {}
    const cancelled = new Promise<undefined>((resolve) => { markCancelled = () => { resolve(undefined) } })
    const waiting = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('x')) }, cancel() { markCancelled() } })
    const pending = h.request(h.uploadPath('cancel.txt'), streaming(waiting, lifetime.signal))
    const settled = pending.then(() => 'resolved', (error: unknown) => error)
    onTestFinished(async () => { lifetime.abort(); await settled })
    await vi.waitFor(async () => { expect((await readdir(h.cwd)).some(name => name.startsWith('.cancel.txt.dsh-upload-'))).toBe(true) })
    lifetime.abort()
    await cancelled
    expect(await settled).toMatchObject({ name: 'AbortError' })
    expect(await readdir(h.cwd)).toEqual(expect.arrayContaining(['hello.txt', 'upload.txt']))
    expect((await readdir(h.cwd)).filter(name => name.includes('.dsh-upload-') || name === 'cancel.txt')).toEqual([])
    const escaped = await h.request(h.uploadPath('../escape.txt'), streaming(bytes('x')))
    expect(escaped.status).toBe(400)
    const outside = '/api/sidebar.upload?' + new URLSearchParams({ ...h.scope, dir: h.root, relativePath: 'escape.txt' }).toString()
    expect((await h.request(outside, streaming(bytes('x')))).status).toBe(403)
  })

  it('serves bounded media and scoped HTML assets with opaque-origin CSP and download headers', async () => {
    const h = await load({ config: { mediaLimit: 128 } })
    const html = join(h.cwd, 'index.html')
    const image = join(h.cwd, 'pixel.png')
    const outside = join(h.root, 'outside.html')
    await Promise.all([
      writeFile(html, '<img src="./pixel.png"><script>window.fixture=true</script>'),
      writeFile(image, new Uint8Array([137, 80, 78, 71])), writeFile(outside, 'outside'),
      writeFile(join(h.cwd, 'style.css'), 'body { color: green }'),
      writeFile(join(h.cwd, 'script.js'), 'globalThis.fixture = true'),
      writeFile(join(h.cwd, 'module.mjs'), 'export const fixture = true'),
      writeFile(join(h.cwd, 'large.png'), new Uint8Array(129)),
    ])
    const media = await h.request(h.mediaPath(image, true))
    expect(media.headers.get('content-type')).toBe('image/png')
    expect(media.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''pixel.png")
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
    const documentPath = encodeHtmlUrl(h.scope.sessionId, html)
    const page = await h.request(documentPath)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toBe("sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'")
    expect(page.headers.get('content-security-policy')).not.toContain('allow-same-origin')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await page.text()).toContain('./pixel.png')
    const relative = new URL('./pixel.png', h.origin + documentPath).pathname
    expect((await h.request(relative)).headers.get('content-type')).toBe('image/png')
    for (const [asset, type] of [['style.css', 'text/css; charset=utf-8'], ['script.js', 'text/javascript; charset=utf-8'], ['module.mjs', 'text/javascript; charset=utf-8']]) {
      const response = await h.request(new URL('./' + asset, h.origin + documentPath).pathname)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(type)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-security-policy')).not.toContain('allow-same-origin')
    }
    expect((await h.request(h.mediaPath(outside))).status).toBe(403)
    expect((await h.request(encodeHtmlUrl(h.scope.sessionId, outside))).status).toBe(403)
    expect((await h.request(h.mediaPath(join(h.cwd, 'large.png')))).status).toBe(400)
  })

  it('serves only exact editor and Mermaid artifacts with HEAD, ETag, cancellation, and owner disposal', async () => {
    const h = await load()
    for (const name of ['editor', 'mermaid']) {
      const path = '/api/sidebar.bundle?name=' + name
      const response = await h.request(path)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('__' + name + 'Fixture')
      const etag = response.headers.get('etag')!
      expect(etag).toMatch(/^"[0-9a-f]{12}"$/)
      const head = await h.request(path, { method: 'HEAD' })
      expect(head.headers.get('etag')).toBe(etag)
      expect(await head.text()).toBe('')
      const unchanged = await h.request(path, { headers: { 'if-none-match': etag } })
      expect(unchanged.status).toBe(304)
      expect(await unchanged.text()).toBe('')
    }
    for (const query of ['name=terminal', 'name=private', 'name=../private', 'name=editor&extra=1', 'name=editor&name=mermaid']) {
      expect((await h.request('/api/sidebar.bundle?' + query)).status).toBe(404)
    }
    const lifetime = new AbortController()
    lifetime.abort()
    await expect(h.request('/api/sidebar.bundle?name=editor', { signal: lifetime.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await h.setEnabled(false)
    expect((await h.call('fs.tree', h.scope)).status).toBe(404)
    expect((await h.request('/api/sidebar.bundle?name=editor')).status).toBe(404)
    await h.setEnabled(true)
    expect((await h.call('fs.tree', h.scope)).status).toBe(200)
  })

  it('uses Web authentication on canonical routes and preserves the original alias fence', async () => {
    const h = await load({ web: true })
    const init = { method: 'POST', body: JSON.stringify(h.scope) }
    expect((await fetch(h.origin + apiPath('fs.tree'), init)).status).toBe(401)
    const authenticated = await fetch(h.origin + apiPath('fs.tree'), { ...init, headers: { cookie: h.cookie } })
    expect(await value(authenticated)).toMatchObject({ path: h.cwd })
    const forbidden = await fetch(h.origin + apiPath('fs.tree'), { ...init, headers: { cookie: h.cookie, origin: 'https://untrusted.invalid' } })
    expect(forbidden.status).toBe(403)
    const legacy = await fetch(h.origin + '/sidebar/api/fs.tree', init)
    expect(await value(legacy)).toMatchObject({ path: h.cwd })
    expect((await fetch(h.origin + '/sidebar/api/fs.tree', { ...init, headers: { origin: 'https://untrusted.invalid' } })).status).toBe(403)
    const html = join(h.cwd, 'index.html')
    await writeFile(html, '<p>alias fixture</p>')
    const path = encodeHtmlUrl(h.scope.sessionId, html)
    const canonical = await fetch(h.origin + path, { headers: { cookie: h.cookie } })
    const alias = await fetch(h.origin + path.replace('/api/sidebar/html/', '/sidebar/html/'))
    expect(await canonical.text()).toBe(await alias.text())
    expect(canonical.headers.get('content-security-policy')).toBe(alias.headers.get('content-security-policy'))
  })
})
