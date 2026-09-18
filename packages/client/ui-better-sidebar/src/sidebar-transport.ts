/** Shared sidebar operations for authenticated Fetch and the fenced Web aliases. */
import { createReadStream } from 'node:fs'
import { STATUS_CODES } from 'node:http'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection'
import type { ResolvedSidebarConfig } from './config.ts'
import type { SidebarHttpRequest, SidebarHttpResponse, SidebarWebServer } from './context-types.ts'
import { writeWorkspaceUpload } from './fs-operations.ts'
import { isWithin, requireAbsolute } from './fs-tree.ts'
import { decodeHtmlUrl } from './html-route.ts'
import { readJsonBody, SidebarError } from './wire.ts'

/** Dependencies captured once by the Host plugin; the dispatcher remains the business owner. */
export interface SidebarTransportOptions {
  readonly api: Readonly<Record<string, (payload: unknown) => unknown>>
  readonly sessionCwd: (sessionId: string, clientCwd?: string) => string
  readonly mediaType: (path: string) => string
  readonly config: ResolvedSidebarConfig
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

async function respond(operation: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
  try {
    signal?.throwIfAborted()
    const response = await operation()
    signal?.throwIfAborted()
    return response
  } catch (error) {
    signal?.throwIfAborted()
    const failure = error instanceof SidebarError
      ? error
      : new SidebarError('internal', error instanceof Error ? error.message : String(error), 500)
    return json(failure.status, { ok: false, error: { code: failure.code, message: failure.message } })
  }
}

/**
 * Read Fetch bytes with backpressure and cancel the source on abort or early return.
 * @param request - carrier request owning the body and cancellation signal.
 * @returns raw chunks accepted by the existing JSON parser and upload writer.
 */
async function* sidebarRequestChunks(request: Request): AsyncGenerator<Uint8Array> {
  request.signal.throwIfAborted()
  if (request.body === null) return
  const reader = request.body.getReader()
  let cancellation: Promise<void> | undefined
  const cancel = (): void => {
    cancellation ??= reader.cancel(request.signal.reason)
    // The awaited cancellation below owns any source failure.
    void cancellation.catch(() => {})
  }
  request.signal.addEventListener('abort', cancel, { once: true })
  try {
    request.signal.throwIfAborted()
    while (true) {
      const next = await reader.read()
      request.signal.throwIfAborted()
      if (next.done) return
      yield next.value
    }
  } finally {
    request.signal.removeEventListener('abort', cancel)
    try { await (cancellation ?? reader.cancel()) }
    finally { reader.releaseLock() }
  }
}

/**
 * Bind byte operations to the existing dispatcher and resolved deployment limits.
 * @param options - business callbacks and current resolved sidebar configuration.
 * @returns operations shared by both physical transports.
 */
export function createSidebarOperations(options: SidebarTransportOptions) {
  const { api, sessionCwd, mediaType, config } = options
  async function file(path: string, cwd: string, html: boolean, signal?: AbortSignal): Promise<Response> {
    const absolute = requireAbsolute(path)
    if (!isWithin(cwd, absolute)) {
      throw new SidebarError('fs-error', (html ? 'html' : 'media') + ' path outside the session working directory', 403)
    }
    const info = await stat(absolute)
    if (!info.isFile() || info.size > config.mediaLimit) throw new SidebarError('fs-error', 'not a file or too large', 400)
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of createReadStream(absolute, { signal })) {
      const bytes = chunk as Buffer
      size += bytes.byteLength
      if (size > config.mediaLimit) throw new SidebarError('fs-error', 'not a file or too large', 400)
      chunks.push(bytes)
    }
    const headers: Record<string, string> = { 'content-type': mediaType(absolute), 'cache-control': 'no-cache' }
    if (html) {
      headers['x-content-type-options'] = 'nosniff'
      headers['referrer-policy'] = 'no-referrer'
      headers['content-security-policy'] = "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'"
    }
    return new Response(new Uint8Array(Buffer.concat(chunks)), { headers })
  }
  return {
    json(method: string | undefined, chunks: AsyncIterable<string | Uint8Array>, signal?: AbortSignal): Promise<Response> {
      return respond(async () => {
        const handler = method !== undefined && !method.includes('/') && Object.hasOwn(api, method) ? api[method] : undefined
        if (handler === undefined) throw new SidebarError('not-found', 'unknown sidebar API method', 404)
        const payload = await readJsonBody(chunks)
        signal?.throwIfAborted()
        return json(200, { ok: true, value: await handler(payload) })
      }, signal)
    },
    upload(url: URL, chunks: AsyncIterable<string | Uint8Array>, signal?: AbortSignal): Promise<Response> {
      return respond(async () => {
        const sessionId = url.searchParams.get('sessionId')
        const dir = url.searchParams.get('dir')
        const relativePath = url.searchParams.get('relativePath')
        if (sessionId === null || dir === null || relativePath === null || relativePath.trim() === '') {
          throw new SidebarError('bad-request', 'sessionId, dir, and relativePath are required')
        }
        const cwd = sessionCwd(sessionId, url.searchParams.get('cwd') ?? undefined)
        const value = await writeWorkspaceUpload({ cwd, dir, relativePath, chunks, limit: config.uploadLimit, signal })
        return json(200, { ok: true, value })
      }, signal)
    },
    media(url: URL, signal?: AbortSignal): Promise<Response> {
      return respond(async () => {
        const sessionId = url.searchParams.get('sessionId')
        const path = url.searchParams.get('path')
        if (sessionId === null || path === null) throw new SidebarError('bad-request', 'sessionId and path are required')
        const response = await file(path, sessionCwd(sessionId, url.searchParams.get('cwd') ?? undefined), false, signal)
        if (url.searchParams.get('download') === '1') {
          response.headers.set('content-disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(basename(path)))
        }
        return response
      }, signal)
    },
    html(url: URL, signal?: AbortSignal): Promise<Response> {
      return respond(async () => {
        const decoded = decodeHtmlUrl(url.pathname)
        if (!decoded.ok) throw new SidebarError('bad-request', decoded.message, decoded.status)
        const { sessionId, path } = decoded.ref
        return file(path, sessionCwd(sessionId), true, signal)
      }, signal)
    },
  }
}

/** Shared operation callbacks; neither transport owns another dispatcher. */
export type SidebarOperations = ReturnType<typeof createSidebarOperations>

/**
 * Register exact sidebar JSON, upload, and media requests with Connection.
 * @param fetch - authenticated Web/Desktop route registry.
 * @param operations - shared operations bound by the Host plugin.
 * @returns disposer removing every contribution.
 */
export function registerSidebarFetch(fetch: HostConnectionFetch, operations: SidebarOperations): () => Promise<void> {
  const dispose = [
    fetch.register({ path: '/api/sidebar.api', methods: ['POST'], requestBody: 'streaming',
      fetch: request => operations.json(new URL(request.url).searchParams.get('method') ?? undefined, sidebarRequestChunks(request), request.signal) }),
    fetch.register({ path: '/api/sidebar.upload', methods: ['POST'], requestBody: 'streaming',
      fetch: request => operations.upload(new URL(request.url), sidebarRequestChunks(request), request.signal) }),
    fetch.register({ path: '/api/sidebar.file', methods: ['GET'], requestBody: 'buffered',
      fetch: request => operations.media(new URL(request.url), request.signal) }),
    fetch.register({ path: '/api/sidebar/html/', match: 'prefix', methods: ['GET'], requestBody: 'buffered',
      fetch: request => operations.html(new URL(request.url), request.signal) }),
  ]
  return async () => { await Promise.all(dispose.map(remove => remove())) }
}

/**
 * Write a shared operation response to the existing Web response.
 * @param response - bounded response produced by a sidebar operation.
 * @param target - actual Web response supplied by webServer.
 */
async function writeSidebarResponse(response: Response, target: SidebarHttpResponse): Promise<void> {
  target.writeHead(response.status, Object.fromEntries(response.headers))
  target.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()))
}

/**
 * Retain the original Web aliases and their live Host/Origin fence.
 * @param server - optional Web route registry.
 * @param fence - existing sidebar browser-trust check.
 * @param operations - the same operations used by Connection.
 * @returns disposer for all aliases.
 */
export function registerSidebarWebAliases(
  server: SidebarWebServer, fence: (request: SidebarHttpRequest) => boolean, operations: SidebarOperations,
): () => void {
  const routes = [
    { kind: 'prefix' as const, path: '/sidebar/api', method: 'POST', json: true,
      run: (request: SidebarHttpRequest, url: URL) => operations.json(
        url.pathname.startsWith('/sidebar/api/') ? url.pathname.slice('/sidebar/api/'.length) : undefined, request,
      ) },
    { kind: 'exact' as const, path: '/sidebar/upload', method: 'POST', json: true,
      run: (request: SidebarHttpRequest, url: URL) => operations.upload(url, request) },
    { kind: 'prefix' as const, path: '/sidebar/file', method: 'GET', json: false,
      run: (_request: SidebarHttpRequest, url: URL) => operations.media(url) },
    { kind: 'prefix' as const, path: '/sidebar/html', method: 'GET', json: false,
      run: (_request: SidebarHttpRequest, url: URL) => operations.html(url) },
  ]
  const dispose = routes.map(route => server.register({ kind: route.kind, path: route.path, async handler(request, response) {
    const allowed = fence(request)
    if (!allowed || request.method !== route.method) {
      const status: 403 | 405 = allowed ? 405 : 403
      const code = allowed ? 'method-error' : 'forbidden'
      const reason = STATUS_CODES[status]
      if (reason === undefined) throw new Error('missing HTTP status reason')
      const wireDetail = reason.toLowerCase()
      await writeSidebarResponse(route.json
        ? json(status, { ok: false, error: { code, message: wireDetail } })
        : new Response(allowed ? null : 'forbidden', { status }), response)
      return
    }
    await writeSidebarResponse(await route.run(request, new URL(request.url ?? '/', 'http://dsh.internal')), response)
  } }))
  return () => { for (const remove of dispose) remove() }
}
