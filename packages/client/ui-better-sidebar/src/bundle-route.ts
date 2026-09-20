/**
 * Lazy chunk route: serves the client bundle's chunk scripts
 * (/sidebar/bundle/<name>.js). The official /plugins/<id>/client.js route
 * cannot serve arbitrary file names, so the plugin serves its own split
 * bundles (lib/client-<name>.js) here; the client injects the script on
 * first use of the feature that needs it (see src/client/chunk-loader.ts).
 *
 * Caching contract: every response carries `cache-control: no-cache` plus an
 * ETag (content hash, memoized per file by mtime/size) and honors
 * If-None-Match — the browser revalidates each fetch, but a 304 avoids
 * re-downloading multi-MB chunks that did not change (page refresh, HMR
 * re-activation). Same browser-trust fence as every other /sidebar route;
 * only allowlisted chunk names are servable (no path traversal).
 */
import { createHash } from 'node:crypto'
import { stat, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, SidebarHttpRequest, SidebarHttpResponse } from './context-types.ts'
import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection/types'

/** The chunk names the client may request (mirror of src/client/chunk-loader.ts). */
export const CHUNK_NAMES = ['terminal', 'editor', 'mermaid'] as const
export type ChunkName = (typeof CHUNK_NAMES)[number]

/** Published lazy chunks are rooted at this package's manifest in every compilation face. */
const LIB_DIR = join(dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-ui-better-sidebar/package.json'))), 'lib')

/** sha1 content hash shortened to 12 hex chars (same shape as the client-modules rev). */
function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

interface ChunkEtag {
  mtimeMs: number
  size: number
  etag: string
}

/** ETag memo: recompute the content hash only when the file's stat changed. */
const etags = new Map<string, ChunkEtag>()

/**
 * The chunk file's ETag (quoted hash), or undefined when the file is
 * missing. Hash is recomputed only when mtime/size changed (hashing a
 * multi-MB chunk per request is wasteful).
 */
async function etagOf(name: ChunkName, chunkDir: string, signal?: AbortSignal): Promise<string | undefined> {
  const path = join(chunkDir, `client-${name}.js`)
  const key = `${chunkDir}:${name}`
  try {
    const info = await stat(path)
    const memo = etags.get(key)
    if (memo !== undefined && memo.mtimeMs === info.mtimeMs && memo.size === info.size) {
      return memo.etag
    }
    const etag = `"${shortHash(await readFile(path, { signal }))}"`
    etags.set(key, { mtimeMs: info.mtimeMs, size: info.size, etag })
    return etag
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
}

/**
 * Build the /sidebar/bundle route handler. `fence` is the shared browser-
 * trust check every /sidebar route applies; `chunkDir` is the directory the
 * chunk scripts live in (overridable for tests).
 */
export function createBundleRouteHandler(
  fence: (req: SidebarHttpRequest) => boolean,
  chunkDir: string = LIB_DIR,
): (req: SidebarHttpRequest, res: SidebarHttpResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!fence(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const match = /^\/sidebar\/bundle\/([a-z0-9-]+)\.js$/.exec(pathname)
    const name = match?.[1] as ChunkName | undefined
    if (name === undefined || !(CHUNK_NAMES as readonly string[]).includes(name)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const response = await chunkResponse(name, req.method, req.headers['if-none-match'], chunkDir)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()))
  }
}

async function chunkResponse(
  name: ChunkName, method: string, ifNoneMatch: string | string[] | null | undefined, chunkDir: string, signal?: AbortSignal,
): Promise<Response> {
  signal?.throwIfAborted()
  const etag = await etagOf(name, chunkDir, signal)
  signal?.throwIfAborted()
  if (etag === undefined) return new Response('not found', { status: 404 })
  const headers = { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', etag }
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers })
  try {
    const body = method === 'HEAD' ? null : await readFile(join(chunkDir, 'client-' + name + '.js'), { encoding: 'utf8', signal })
    signal?.throwIfAborted()
    return new Response(body, { headers })
  } catch {
    signal?.throwIfAborted()
    // A chunk can disappear during a rebuild after its ETag was read.
    return new Response('not found', { status: 404 })
  }
}

/**
 * Register the exact editor and Mermaid artifacts on authenticated Connection Fetch.
 * @param fetch - shared Web/Desktop route owner.
 * @param chunkDir - published artifacts; tests supply a private fixture directory.
 * @returns route disposer.
 */
export function registerSidebarBundleRoute(
  fetch: HostConnectionFetch, chunkDir: string = LIB_DIR,
): ReturnType<HostConnectionFetch['register']> {
  return fetch.register({
    path: '/api/sidebar.bundle', methods: ['GET', 'HEAD'], requestBody: 'buffered',
    async fetch(request) {
      const url = new URL(request.url)
      const name = url.searchParams.get('name')
      if ((name !== 'editor' && name !== 'mermaid') || url.search !== '?name=' + name) {
        return new Response('not found', { status: 404 })
      }
      return chunkResponse(name, request.method, request.headers.get('if-none-match'), chunkDir, request.signal)
    },
  })
}

/** Register the /sidebar/bundle route (disposed with the fiber). */
export function registerBundleRoute(ctx: Context, fence: (req: SidebarHttpRequest) => boolean): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/bundle',
    handler: createBundleRouteHandler(fence),
  })
}

/**
 * Register the exact terminal artifact on the authenticated Web/Desktop Fetch facility.
 * @param fetch - shared Connection route owner.
 * @param chunkDir - published artifact directory; tests supply an isolated artifact fixture.
 * @returns route disposer.
 */
export function registerTerminalBundleRoute(
  fetch: HostConnectionFetch, chunkDir: string = LIB_DIR,
): ReturnType<HostConnectionFetch['register']> {
  return fetch.register({
    path: '/api/sidebar-terminal.bundle', methods: ['GET', 'HEAD'], requestBody: 'buffered',
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== '/api/sidebar-terminal.bundle' || url.search !== '?name=terminal') {
        return new Response('Unknown terminal artifact.', { status: 404 })
      }
      const etag = await etagOf('terminal', chunkDir)
      if (etag === undefined) return new Response('Terminal artifact unavailable.', { status: 404 })
      const headers = { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache', etag }
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
      const body = request.method === 'HEAD' ? null : await readFile(join(chunkDir, 'client-terminal.js'), 'utf8')
      return new Response(body, { headers })
    },
  })
}
