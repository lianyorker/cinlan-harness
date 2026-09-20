/** Exact runtime assets and an isolated module graph for paired phone clients. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { bootInjections, orderByModuleGraph } from '@deepseek-ai/dsh-client-modules'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import type { WebBootEntry, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { renderIndexInjections } from '@deepseek-ai/dsh-host-webserver'
import type { RemoteAccessHost } from '@deepseek-ai/dsh-remote-access/types'

/** The paired client has no administration, filesystem, model selection, or plugin-management pages. */
const PHONE_MODULES = [
  '@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-file-upload', '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-keyboard', '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-tool', '@deepseek-ai/dsh-client-ui-approval',
  '@deepseek-ai/dsh-client-ui-user-questions',
] as const
const SHELL = '@deepseek-ai/dsh-client-ui-paired-shell'
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png',
}

interface ManifestRow {
  file: string
  imports: string[]
  dynamicImports: string[]
  css: string[]
  assets: string[]
}

function manifestRows(input: unknown): Map<string, ManifestRow> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('phone assets: invalid build manifest')
  const rows = new Map<string, ManifestRow>()
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('phone assets: invalid manifest row')
    const row = raw as Record<string, unknown>
    if (typeof row.file !== 'string') throw new Error('phone assets: manifest row has no file')
    const strings = (field: string): string[] => {
      const value = row[field]
      if (value === undefined) return []
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('phone assets: invalid asset list')
      return value as string[]
    }
    rows.set(key, { file: row.file, imports: strings('imports'), dynamicImports: strings('dynamicImports'),
      css: strings('css'), assets: strings('assets') })
  }
  return rows
}

function artifactPath(root: string, file: string): string {
  if (!file.startsWith('assets/') || !/^[A-Za-z0-9_./-]+$/.test(file) || file.split('/').some(part => part === '.' || part === '..')
    || file.endsWith('.map')) throw new Error('phone assets: unexpected runtime artifact path')
  const path = resolve(root, file)
  if (!path.startsWith(root + sep)) throw new Error('phone assets: artifact escaped build directory')
  return path
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function restrictedGraph(graph: WebBootGraph, shell: WebBootEntry): WebBootGraph {
  const ids = new Set<string>([...PHONE_MODULES, SHELL])
  const rows = new Map(graph.entries.map(row => [row.id, row]))
  rows.set(SHELL, shell)
  const entries = orderByModuleGraph([...ids].map((id) => {
    const row = rows.get(id)
    if (row === undefined) throw new Error('phone assets: missing required client ' + id)
    for (const external of row.external ?? []) {
      const dependency = external.endsWith('/client') ? external.slice(0, -7) : external
      if (!ids.has(dependency)) throw new Error('phone assets: excluded client dependency ' + dependency)
    }
    return { ...row, inject: (row.inject ?? []).filter(dependency => ids.has(dependency)) }
  }))
  const batches = entries.map(row => ({ phase: row.id === PHONE_MODULES[0] ? 'bootstrap' as const : 'application' as const,
    url: row.url, rev: row.rev, entries: [row.id] }))
  return { rev: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), entries, batches }
}

/**
 * Create a paired asset reader without evaluating the local Web index or its injections.
 * @param modules - current Host module registry supplying exact selected bundle URLs.
 * @param projectDir - installed Desktop project used for package resolution.
 * @returns authenticated asset handler with no wildcard or SPA fallback.
 */
export function createPairedAssetHandler(
  modules: Pick<ClientModuleRegistry, 'graph' | 'fetchBundle'>,
  projectDir: string,
): RemoteAccessHost['fetchAssets'] {
  const require = createRequire(join(projectDir, 'package.json'))
  const distIndex = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  let prepared: ReturnType<typeof prepare> | undefined
  async function prepare() {
    const root = await realpath(dirname(distIndex))
    const manifest = manifestRows(JSON.parse(await readFile(join(root, 'phone-runtime-manifest.json'), 'utf8')) as unknown)
    const entry = manifest.get('index.html')
    if (entry === undefined) throw new Error('phone assets: build manifest has no Web runtime entry')
    const files = new Set<string>()
    const styles = new Set<string>()
    const visited = new Set<string>()
    const visit = (key: string): void => {
      if (visited.has(key)) return
      visited.add(key)
      const row = manifest.get(key)
      if (row === undefined) throw new Error('phone assets: unresolved runtime dependency ' + key)
      files.add(row.file)
      for (const file of [...row.css, ...row.assets]) files.add(file)
      for (const file of row.css) styles.add(file)
      for (const dependency of [...row.imports, ...row.dynamicImports]) visit(dependency)
    }
    visit('index.html')
    const paths = new Map<string, string>()
    for (const file of files) {
      const path = await realpath(artifactPath(root, file))
      if (!path.startsWith(root + sep)) throw new Error('phone assets: runtime artifact escaped build directory')
      paths.set('/' + file, path)
    }
    const shellBytes = await readFile(require.resolve(SHELL + '/client'))
    const rev = createHash('sha256').update(shellBytes).digest('hex')
    const shell: WebBootEntry = { id: SHELL, url: '/phone-shell.js?rev=' + rev, rev }
    const styleTags = [...styles].map(file => '<link rel="stylesheet" href="/' + escapeAttribute(file) + '">').join('')
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
      + 'content="width=device-width, initial-scale=1"><title>DSH</title>' + styleTags
      + '</head><body><div id="root"></div><script type="module" src="/' + escapeAttribute(entry.file) + '"></script></body></html>'
    return { paths, shell, shellBytes, html }
  }
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const url = new URL(request.url)
    if (url.protocol !== 'https:') return new Response(null, { status: 400 })
    const data = await (prepared ??= prepare())
    const graph = restrictedGraph(modules.graph(), data.shell)
    const target = url.pathname + url.search
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
    if (target === '/') {
      const body = renderIndexInjections(data.html, [
        { kind: 'script', placement: 'head', text: PAIRED_TRANSPORT_SCRIPT }, ...bootInjections(graph),
      ])
      return new Response(request.method === 'HEAD' ? null : body, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
    }
    if (target === data.shell.url) {
      return new Response(request.method === 'HEAD' ? null : Uint8Array.from(data.shellBytes), {
        headers: { ...headers, 'content-type': 'text/javascript; charset=utf-8' },
      })
    }
    if (graph.entries.some(row => row.id !== SHELL && row.url === target)) return modules.fetchBundle(request)
    const file = data.paths.get(target)
    if (file === undefined) return new Response(null, { status: 404 })
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(await readFile(file)), {
      headers: { ...headers, 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' },
    })
  }
}

const PAIRED_TRANSPORT_SCRIPT = [
  '(()=>{const origin=location.origin;',
  'window.__DSH_TRANSPORT__={ownsHost:false,authority:"paired",pairingProtocolVersion:1,fetch:(input,init)=>{',
  'const url=new URL(input);',
  'if(url.origin!==origin||url.protocol!=="https:")return Promise.reject(new Error("paired transport: cross-origin request refused"));',
  'const headers=new Headers(init?.headers);headers.set("x-dsh-pairing-version","1");',
  'return fetch(url,{...init,headers,credentials:"same-origin",redirect:"error"});',
  '}};})()',
].join('')
