import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createPairedAssetHandler } from '../../desktop-host/src/phone-assets.ts'

const modules = [
  'client-modules', 'client-connection', 'api-remotes', 'typert-registry', 'api-gateway', 'api-session-controller',
  'client-file-upload', 'client-ui-settings', 'client-locale', 'client-keyboard', 'client-ui-theme',
  'client-ui-renderer', 'client-ui-session', 'client-ui-conversation', 'client-ui-chat', 'client-ui-tool',
  'client-ui-approval', 'client-ui-user-questions',
].map(name => '@deepseek-ai/dsh-' + name)
const excluded = '@deepseek-ai/dsh-client-ui-settings-security'
const shell = '@deepseek-ai/dsh-client-ui-paired-shell'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-phone-assets-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  async function put(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  for (const id of [...modules, excluded, shell]) {
    const path = join(root, 'node_modules', id)
    await put(join(path, 'package.json'), JSON.stringify({ name: id, type: 'module',
      exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
      dsh: { client: { platform: 'web', inject: id === modules[0] ? [] : [excluded] } },
    }))
    await put(join(path, 'index.js'), 'export function apply() {}')
    await put(join(path, 'client.js'), 'window.__ModuleLoader__.load({id:' + JSON.stringify(id) + ',factory:()=>({apply(){}})});')
  }
  const web = join(root, 'node_modules/@deepseek-ai/dsh-web-frontend')
  const dist = join(web, 'dist')
  await put(join(web, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-web-frontend', exports: { './dist/*': './dist/*' } }))
  await put(join(dist, 'index.html'), '<html><head>LOCAL_SECRET</head><body>ADMIN_INDEX</body></html>')
  await put(join(dist, 'assets/main.js'), 'export const boot = true')
  await put(join(dist, 'assets/grammar.js'), 'export const grammar = true')
  await put(join(dist, 'assets/main.css'), 'body{}')
  await put(join(dist, 'assets/font.woff2'), 'font')
  await put(join(dist, 'preview/worker.js'), 'PRIVATE_WORKER')
  const manifest = {
    'index.html': { file: 'assets/main.js', css: ['assets/main.css'], imports: [], dynamicImports: ['grammar'], assets: ['assets/font.woff2'] },
    grammar: { file: 'assets/grammar.js' },
    'src/preview.ts': { file: 'preview/worker.js' },
  }
  await put(join(dist, 'phone-runtime-manifest.json'), JSON.stringify(manifest))
  const config = join(root, 'cordis.json')
  await put(config, JSON.stringify([...modules, excluded].map((name, index) => ({ id: String(index), name }))))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const registry = new ClientModuleRegistry(ctx)
  const inject = vi.fn()
  ctx.on('webserver/index-inject', inject)
  const fetch = createPairedAssetHandler(registry, root)
  return { root, dist, ctx, registry, fetch, inject, manifest }
}

function bootGraph(html: string): WebBootGraph {
  const sandbox = { window: {}, globalThis: {}, location: { origin: 'https://phone.example' }, Promise }
  // Evaluate only inline bootstrap scripts; plugin sources are independently fetched below.
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) runInNewContext(match[1]!, sandbox)
  return (sandbox.globalThis as { __DSH_BOOT__?: WebBootGraph }).__DSH_BOOT__!
}

describe('paired phone assets through Loader composition', () => {
  it('serves a closed module roster and runtime manifest without local index injections', async () => {
    const b = await fixture()
    const response = await b.fetch(new Request('https://phone.example/'))
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).not.toContain('LOCAL_SECRET')
    expect(html).not.toContain('ADMIN_INDEX')
    expect(html).not.toContain(excluded)
    expect(b.inject).not.toHaveBeenCalled()
    expect(html).toContain('authority:"paired"')
    expect(html).toContain('ownsHost:false')
    expect(html).toContain('pairingProtocolVersion:1')
    const graph = bootGraph(html)
    expect(graph.entries.map(row => row.id).sort()).toEqual([...modules, shell].sort())
    expect(graph.batches.every(batch => batch.entries.length === 1)).toBe(true)
    for (const row of graph.entries) {
      const bundle = await b.fetch(new Request('https://phone.example' + row.url))
      expect(bundle.status).toBe(200)
      expect(await bundle.text()).toContain(row.id)
    }
    for (const path of ['/assets/main.js', '/assets/grammar.js', '/assets/main.css', '/assets/font.woff2']) {
      expect((await b.fetch(new Request('https://phone.example' + path))).status).toBe(200)
      expect((await b.fetch(new Request('https://phone.example' + path, { method: 'HEAD' }))).body).toBeNull()
    }
    for (const path of ['/preview/worker.js', '/preview.html', '/index.html', '/assets/main.js.map',
      '/phone-runtime-manifest.json', '/assets/main.js?extra=true', '/missing', '/plugins/anything']) {
      expect((await b.fetch(new Request('https://phone.example' + path))).status).toBe(404)
    }
    const forbidden = b.registry.graph().entries.find(row => row.id === excluded)!
    expect((await b.fetch(new Request('https://phone.example' + forbidden.url))).status).toBe(404)
    const fullBatch = b.registry.graph().batches.find(batch => batch.entries.includes(excluded))!
    expect((await b.fetch(new Request('https://phone.example' + fullBatch.url))).status).toBe(404)
    expect((await b.fetch(new Request('https://phone.example/', { method: 'POST' }))).status).toBe(405)
    expect((await b.fetch(new Request('http://phone.example/'))).status).toBe(400)
  })

  it('adds pairing headers only to same-origin HTTPS requests without replacing global fetch', async () => {
    const b = await fixture()
    const html = await (await b.fetch(new Request('https://phone.example/'))).text()
    const send = vi.fn<(input: URL, init: RequestInit & { headers: Headers }) => Promise<Response>>()
      .mockResolvedValue(new Response())
    const target = { window: {}, globalThis: {}, location: { origin: 'https://phone.example' }, Promise, URL, Headers, fetch: send }
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) runInNewContext(match[1]!, target)
    const transport = (target.window as { __DSH_TRANSPORT__: { fetch: typeof fetch } }).__DSH_TRANSPORT__
    await transport.fetch(new URL('https://phone.example/api/remote/test'), { method: 'POST', headers: { 'x-request': 'test' } })
    expect(send).toHaveBeenCalledTimes(1)
    const [, options] = send.mock.calls[0]!
    expect(options.headers.get('x-dsh-pairing-version')).toBe('1')
    expect(options.headers.get('x-request')).toBe('test')
    expect(options).toMatchObject({ credentials: 'same-origin', redirect: 'error' })
    await expect(transport.fetch(new URL('https://other.example/api'), {})).rejects.toThrow('cross-origin')
    await expect(transport.fetch(new URL('http://phone.example/api'), {})).rejects.toThrow('cross-origin')
    expect(send).toHaveBeenCalledTimes(1)
    expect(target.fetch).toBe(send)
  })

  it('fails closed when the build manifest points outside the runtime or a required module disappears', async () => {
    const b = await fixture()
    await writeFile(join(b.dist, 'phone-runtime-manifest.json'), JSON.stringify({
      ...b.manifest, 'index.html': { file: '../secret.js' },
    }))
    await expect(b.fetch(new Request('https://phone.example/'))).rejects.toThrow('unexpected runtime artifact path')
    await writeFile(join(b.dist, 'phone-runtime-manifest.json'), JSON.stringify(b.manifest))
    const graph = b.registry.graph()
    const absent = createPairedAssetHandler({ graph: () => ({ ...graph, entries: graph.entries.slice(1) }),
      fetchBundle: request => b.registry.fetchBundle(request) }, b.root)
    await expect(absent(new Request('https://phone.example/'))).rejects.toThrow('missing required client')
    const external = createPairedAssetHandler({ graph: () => ({ ...graph, entries: graph.entries.map((row, index) =>
      index === 0 ? { ...row, external: [excluded + '/client'] } : row) }),
    fetchBundle: request => b.registry.fetchBundle(request) }, b.root)
    await expect(external(new Request('https://phone.example/'))).rejects.toThrow('excluded client dependency')
    expect(await readFile(join(b.dist, 'index.html'), 'utf8')).toContain('LOCAL_SECRET')
  })
})
