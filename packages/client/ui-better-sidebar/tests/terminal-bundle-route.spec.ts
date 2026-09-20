/** Exact terminal artifact delivery through real Desktop and authenticated Web Connection routes. */
import { createTrustedConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { registerTerminalBundleRoute } from '../src/bundle-route.ts'

const artifactPath = '/api/sidebar-terminal.bundle?name=terminal'
const artifact = 'globalThis.__terminalArtifactFixture = "terminal-only";\n'
const neighbor = 'globalThis.__otherArtifactFixture = "never-serve";\n'
const routePluginName = 'test-terminal-artifact-route'

async function loadFixture({ web = false, present = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-bundle-route-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  const chunkDir = join(root, 'artifacts')
  const terminalFile = join(chunkDir, 'client-terminal.js')
  await mkdir(chunkDir)
  await Promise.all([
    ...present ? [writeFile(terminalFile, artifact)] : [],
    writeFile(join(chunkDir, 'client-editor.js'), neighbor),
    writeFile(join(chunkDir, 'client-mermaid.js'), neighbor),
    writeFile(join(chunkDir, 'client-terminal.js.map'), neighbor),
    writeFile(join(root, 'private.js'), neighbor),
  ])
  const routePlugin = {
    inject: ['connection'],
    apply(scope: Context) {
      scope.effect(() => registerTerminalBundleRoute(scope.connection.fetch, chunkDir))
      scope.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => webCtx.webServer.register({
          kind: 'exact', path: '/',
          handler(request, response) {
            if (!webCtx.connection.authorizeIndex(request, response)) return
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end('<title>Terminal route fixture</title>')
          },
        }))
      })
    },
  }
  const rows = [
    ...web ? [{ name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } }] : [],
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: '@deepseek-ai/dsh-client-connection' },
    { name: routePluginName },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-client-connection', Connection],
    [routePluginName, routePlugin],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected Loader module: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const shared = ctx.connection.createSharedFetchHandler('/api', createTrustedConnectionAccess())
  const origin = web ? 'http://127.0.0.1:' + String(ctx.webServer.port) : undefined
  return {
    ctx, terminalFile, origin,
    desktop(path = artifactPath, init?: RequestInit) {
      return shared.fetch(new Request('dsh-app://app' + path, init))
    },
    async cookie(): Promise<string> {
      if (origin === undefined) throw new Error('Web listener required for a browser cookie.')
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
      if (entry === undefined) throw new Error('Terminal artifact Loader entry missing.')
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
  }
}

function expectArtifactHeaders(response: Response, etag?: string): string {
  expect(response.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
  expect(response.headers.get('cache-control')).toBe('no-cache')
  const actual = response.headers.get('etag')
  expect(actual).toMatch(/^"[a-f0-9]+"$/)
  if (actual === null) throw new Error('Terminal artifact ETag missing.')
  if (etag !== undefined) expect(actual).toBe(etag)
  return actual
}

describe('terminal artifact Connection route', () => {
  it('serves only GET and HEAD to admitted Desktop Shared Fetch without a Web service', async () => {
    const h = await loadFixture()
    expect(h.ctx.get('webServer')).toBeUndefined()
    expect(h.ctx.get('webRuntime')).toBeUndefined()
    const get = await h.desktop()
    expect(get.status).toBe(200)
    expect(await get.text()).toBe(artifact)
    const etag = expectArtifactHeaders(get)
    const head = await h.desktop(artifactPath, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expectArtifactHeaders(head, etag)
    expect(await head.text()).toBe('')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const rejected = await h.desktop(artifactPath, { method })
      expect(rejected.status).toBe(404)
      expect(await rejected.text()).not.toContain('terminal-only')
      expect(rejected.headers.get('etag')).toBeNull()
    }
  })

  it('denies other chunk names, extra queries, encoded aliases, and traversal paths', async () => {
    const h = await loadFixture()
    const rejectedPaths = [
      '/api/sidebar-terminal.bundle',
      '/api/sidebar-terminal.bundle?name=',
      '/api/sidebar-terminal.bundle?name=Terminal',
      '/api/sidebar-terminal.bundle?name=editor',
      '/api/sidebar-terminal.bundle?name=mermaid',
      '/api/sidebar-terminal.bundle?name=client-terminal.js',
      '/api/sidebar-terminal.bundle?name=terminal.js.map',
      '/api/sidebar-terminal.bundle?name=%74erminal',
      '/api/sidebar-terminal.bundle?name=terminal&',
      '/api/sidebar-terminal.bundle?name=terminal&extra=1',
      '/api/sidebar-terminal.bundle?extra=1&name=terminal',
      '/api/sidebar-terminal.bundle?name=terminal&name=terminal',
      '/api/sidebar-terminal.bundle?name=../private',
      '/api/sidebar-terminal.bundle?name=..%2Fprivate',
      '/api/sidebar-terminal.bundle?name=..%5Cprivate',
      '/api/sidebar-terminal.bundle?name=terminal%00',
      '/api/sidebar-terminal.bundle/?name=terminal',
      '/api/sidebar-terminal.bundle/../private.js?name=terminal',
      '/api/sidebar-terminal.bundle%2F..%2Fprivate.js?name=terminal',
      '/api/%73idebar-terminal.bundle?name=terminal',
      '/api/../private.js?name=terminal',
      '/api//sidebar-terminal.bundle?name=terminal',
      '/api/client-terminal.js?name=terminal',
      '/sidebar/bundle/terminal.js',
    ]
    for (const path of rejectedPaths) {
      const response = await h.desktop(path)
      expect(response.status, path).toBe(404)
      expect(await response.text(), path).not.toMatch(/terminal-only|never-serve/)
      expect(response.headers.get('etag'), path).toBeNull()
    }
    const exact = await h.desktop()
    expect(exact.status).toBe(200)
    expect(await exact.text()).toBe(artifact)
  })

  it('revalidates GET and HEAD with ETags and serves changed artifact bytes', async () => {
    const h = await loadFixture()
    const initial = await h.desktop()
    expect(await initial.text()).toBe(artifact)
    const etag = expectArtifactHeaders(initial)
    for (const method of ['GET', 'HEAD']) {
      const cached = await h.desktop(artifactPath, { method, headers: { 'if-none-match': etag } })
      expect(cached.status).toBe(304)
      expectArtifactHeaders(cached, etag)
      expect(await cached.text()).toBe('')
    }
    const changed = artifact + 'globalThis.__terminalArtifactRevision = 2;\n'
    await writeFile(h.terminalFile, changed)
    const refreshed = await h.desktop(artifactPath, { headers: { 'if-none-match': etag } })
    expect(refreshed.status).toBe(200)
    expect(await refreshed.text()).toBe(changed)
    const nextEtag = expectArtifactHeaders(refreshed)
    expect(nextEtag).not.toBe(etag)
    const staleHead = await h.desktop(artifactPath, { method: 'HEAD', headers: { 'if-none-match': etag } })
    expect(staleHead.status).toBe(200)
    expectArtifactHeaders(staleHead, nextEtag)
    expect(await staleHead.text()).toBe('')
  })

  it('returns 404 for missing or removed artifacts even with a previously valid ETag', async () => {
    const h = await loadFixture({ present: false })
    const missing = await h.desktop()
    expect(missing.status).toBe(404)
    expect(missing.headers.get('etag')).toBeNull()
    expect(await missing.text()).not.toContain('terminal-only')
    await writeFile(h.terminalFile, artifact)
    const available = await h.desktop()
    expect(available.status).toBe(200)
    expect(await available.text()).toBe(artifact)
    const etag = expectArtifactHeaders(available)
    await unlink(h.terminalFile)
    const removed = await h.desktop(artifactPath, { headers: { 'if-none-match': etag } })
    expect(removed.status).toBe(404)
    expect(removed.headers.get('etag')).toBeNull()
    expect(await removed.text()).not.toContain('terminal-only')
  })

  it('unregisters the exact artifact with its Loader owner and permits reactivation', async () => {
    const h = await loadFixture()
    expect(await (await h.desktop()).text()).toBe(artifact)
    await h.setEnabled(false)
    const removed = await h.desktop()
    expect(removed.status).toBe(404)
    expect(await removed.text()).not.toContain('terminal-only')
    await h.setEnabled(true)
    const restored = await h.desktop()
    expect(restored.status).toBe(200)
    expect(await restored.text()).toBe(artifact)
  })

  it('serves authenticated Web requests and refuses missing credentials or a wrong origin before artifact delivery', async () => {
    const h = await loadFixture({ web: true })
    if (h.origin === undefined) throw new Error('Web listener missing.')
    const url = h.origin + artifactPath
    const cookie = await h.cookie()
    const allowed = { cookie, origin: h.origin, 'sec-fetch-site': 'same-origin' }
    const get = await fetch(url, { headers: allowed })
    expect(get.status).toBe(200)
    expect(await get.text()).toBe(artifact)
    const etag = expectArtifactHeaders(get)
    const head = await fetch(url, { method: 'HEAD', headers: allowed })
    expect(head.status).toBe(200)
    expectArtifactHeaders(head, etag)
    expect(await head.text()).toBe('')
    const cached = await fetch(url, { headers: { ...allowed, 'if-none-match': etag } })
    expect(cached.status).toBe(304)
    expectArtifactHeaders(cached, etag)
    expect(await cached.text()).toBe('')
    const refused: Array<{ headers: Record<string, string>; status: number; body: string }> = [
      { headers: {}, status: 401, body: 'unauthorized' },
      { headers: { cookie: cookie + 'tampered' }, status: 401, body: 'unauthorized' },
      { headers: { cookie, origin: 'https://unrelated.example' }, status: 403, body: 'forbidden' },
      { headers: { cookie, origin: 'null' }, status: 403, body: 'forbidden' },
    ]
    for (const expected of refused) {
      const response = await fetch(url, { headers: expected.headers })
      expect(response.status).toBe(expected.status)
      expect(await response.text()).toBe(expected.body)
      expect(response.headers.get('etag')).toBeNull()
    }
    const otherChunk = await fetch(h.origin + '/api/sidebar-terminal.bundle?name=editor', { headers: allowed })
    expect(otherChunk.status).toBe(404)
    expect(await otherChunk.text()).not.toContain('never-serve')
    await unlink(h.terminalFile)
    const missing = await fetch(url, { headers: allowed })
    expect(missing.status).toBe(404)
    await missing.text()
    for (const expected of refused) {
      const response = await fetch(url, { headers: expected.headers })
      expect(response.status).toBe(expected.status)
      expect(await response.text()).toBe(expected.body)
    }
  })
})
