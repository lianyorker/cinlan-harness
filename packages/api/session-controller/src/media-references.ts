/**
 * Authenticated GET/HEAD /api/file reads bounded file responses through
 * the composed filesystem provider. Paths and MIME types do not restrict access;
 * the connection service authenticates requests before this handler.
 * @module @deepseek-ai/dsh-api-session-controller/media-references
 */

import { posix, win32 } from 'node:path'
import type {} from '@deepseek-ai/dsh-execution-binding'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-attachment'
import { FsError } from '@deepseek-ai/dsh-fs'
import mime from 'mime-types'

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  // HTML and SVG files may be opened directly on the authenticated API origin.
  'Content-Security-Policy': "sandbox; default-src 'none'",
}

async function serveFile(request: Request, lease: ExecutionLease, maxBytes: number): Promise<Response> {
  const fs = lease.ctx.get('fs')
  if (fs === undefined) return new Response(request.method === 'HEAD' ? null : 'Execution filesystem unavailable', { status: 503, headers: BASE_HEADERS })
  const paths = lease.platform === 'win32' ? win32 : posix
  const signal = AbortSignal.any([request.signal, lease.signal])
  const fail = (status: number, text: string): Response =>
    new Response(request.method === 'HEAD' ? null : text, { status, headers: BASE_HEADERS })
  const path = new URL(request.url).searchParams.get('path')
  if (path === null || path.length === 0) return fail(400, 'missing path')
  if (path.includes('\0') || !paths.isAbsolute(path)) return fail(400, 'absolute path required')
  try {
    const target = await fs.resolve(path, { cwd: lease.cwd, signal })
    const mediaType = mime.lookup(target.displayPath) || 'application/octet-stream'
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'Content-Type': mediaType,
    }
    if (request.method === 'HEAD') {
      const info = await fs.stat(target, signal)
      if (info === undefined) return fail(404, 'not found')
      if (info.type !== 'file') return fail(403, 'not a regular file')
      if (info.size !== undefined) {
        if (info.size > maxBytes) return fail(413, 'file exceeds byte limit')
        headers['Content-Length'] = String(info.size)
      }
      return new Response(null, { headers })
    }
    const bytes = await fs.readBytes(target, signal, maxBytes)
    headers['Content-Length'] = String(bytes.byteLength)
    return new Response(bytes.slice(), { headers })
  } catch (error: unknown) {
    if (!(error instanceof FsError)) throw error
    const statuses: Partial<Record<FsError['code'], number>> = {
      FS_NOT_FOUND: 404,
      FS_NOT_REGULAR_FILE: 403,
      FS_PERMISSION_DENIED: 403,
      FS_SANDBOX_DENIED: 403,
      FS_TOO_LARGE: 413,
      FS_ABORTED: 499,
    }
    return fail(statuses[error.code] ?? 500, error.code)
  }
}

/**
 * File-display contribution. The connection service supplies authentication;
 * `ctx.fs` supplies the execution world's paths, reads, and access policy.
 */
export const SessionMediaReferences = {
  inject: ['connection', 'executionBindings', 'attachments'],
  apply(ctx: Context): void {
    const maxBytes = ctx.attachments.imageLimits.maxImageBytes
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/file',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (!sessionId) return new Response(request.method === 'HEAD' ? null : 'sessionId required', { status: 400, headers: BASE_HEADERS })
        let lease: ExecutionLease | undefined
        try {
          lease = await ctx.executionBindings.forSession(sessionId as SessionId, request.signal)
          lease.assertCurrent()
          const response = await serveFile(request, lease, maxBytes)
          lease.assertCurrent()
          return response
        } catch (error) {
          if (lease !== undefined && !request.signal.aborted && !lease.signal.aborted) throw error
          return new Response(request.method === 'HEAD' ? null : request.signal.aborted ? 'Aborted' : 'Execution unavailable',
            { status: request.signal.aborted ? 499 : 503, headers: BASE_HEADERS })
        } finally { await lease?.release() }
      },
    }), 'session-controller: /api/file')
  },
}
