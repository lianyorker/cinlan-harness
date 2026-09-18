/** Host trust checks through the real Loader composition. */
import { describe, expect, it } from 'vitest'
import { load } from './sidebar-fetch-loader.spec.ts'

function request(h: Awaited<ReturnType<typeof load>>, host: string, origin?: string, site = 'same-origin'): Request {
  const headers = new Headers({ host, 'sec-fetch-site': site })
  if (origin !== undefined) headers.set('origin', origin)
  headers.set('cookie', h.cookie)
  return new Request(h.origin + '/api/sidebar.api?method=fs.tree', { method: 'POST', headers })
}

describe('remote-access trust through Loader Connection', () => {
  it('accepts a loopback request with the authenticated cookie', async () => {
    const h = await load({ web: true })
    expect(h.ctx.connection.requestRejection(request(h, new URL(h.origin).host))).toBeUndefined()
  })

  it('rejects an untrusted reverse-proxy domain', async () => {
    const h = await load({ web: true })
    expect(h.ctx.connection.requestRejection(request(h, 'example.com', 'https://example.com'))).toBe(403)
  })

  it('rejects cross-site browser markers before route dispatch', async () => {
    const h = await load({ web: true })
    expect(h.ctx.connection.requestRejection(request(h, new URL(h.origin).host, h.origin, 'cross-site'))).toBe(403)
  })

  it('rejects a mismatched Origin even with an authenticated cookie', async () => {
    const h = await load({ web: true })
    expect(h.ctx.connection.requestRejection(request(h, new URL(h.origin).host, 'https://untrusted.invalid'))).toBe(403)
  })

  it('evaluates the request headers through the live Connection owner', async () => {
    const h = await load({ web: true })
    const first = request(h, 'example.com', 'https://example.com')
    expect(h.ctx.connection.requestRejection(first)).toBe(403)
    const second = request(h, new URL(h.origin).host)
    expect(h.ctx.connection.requestRejection(second)).toBeUndefined()
  })
})
