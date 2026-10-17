/** Public phone assets, separate from the authenticated operator application. */
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

/** Serve only Vite's flat asset directory and index, never arbitrary filesystem paths.
 * @param root - Built mobile dist directory, not the operator frontend.
 * @param request - Public HTTP request without application credentials.
 * @param response - Caller-owned response.
 * @returns Whether a mobile asset path was handled.
 */
export async function serveMobile(root: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const path = new URL(request.url ?? '/', 'http://mobile').pathname
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const file = path === '/' || path === '/index.html' ? 'index.html' : /^\/assets\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(path) || /^\/[A-Za-z0-9_-]+\.(svg|png|ico)$/.test(path) ? path.slice(1) : undefined
  if (!file || !types[extname(file)]) return false
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('cache-control', file === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable')
  try {
    const body = await readFile(join(root, file))
    response.setHeader('content-type', types[extname(file)]!)
    response.setHeader('content-length', body.length)
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (_assetUnavailable) { response.writeHead(404); response.end() }
  return true
}
