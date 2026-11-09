import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GiteeWorkItemsProvider, GITEE_API_ORIGIN, resolveGiteeWorkItemsConfig } from '../src/index.ts'
import { WorkItemId } from '@cinlan/work-items'

const calls: { url: string; init?: RequestInit }[] = []
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0 })

function context(token = 'fixture-token'): Context {
  const ctx = new Context()
  ctx.provide('credentials', { resolve: vi.fn(async () => ({ value: token, source: 'fixture' })) } as never)
  return ctx
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function issue(number: number, url = GITEE_API_ORIGIN + '/acme/repo/issues/' + String(number)): Record<string, unknown> {
  return { number, title: 'Issue ' + String(number), body: 'details', state: 'open', html_url: url, labels: ['bug'], assignees: [{ login: 'alice' }], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }
}

function provider(ctx = context()): GiteeWorkItemsProvider {
  return new GiteeWorkItemsProvider(ctx, resolveGiteeWorkItemsConfig({ owner: 'acme', repository: 'repo', maxItems: 2 }))
}

describe('GiteeWorkItemsProvider', () => {
  it('maps issues and requests the fixed credentialed endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : String(input), ...(init === undefined ? {} : { init }) })
      return response([issue(7)])
    }))
    const result = await provider().list({ source: 'gitee', state: 'all', limit: 2 })
    expect(result.items[0]).toMatchObject({ id: 'gitee:acme/repo#7', source: 'gitee', key: '#7', assignees: ['alice'], labels: ['bug'] })
    expect(calls[0]?.url).toContain(GITEE_API_ORIGIN + '/api/v5/repos/acme/repo/issues?')
    expect(calls[0]?.url).toContain('state=all')
    expect(calls[0]?.init).toMatchObject({ redirect: 'error', headers: { authorization: 'token fixture-token' } })
  })

  it('filters one page, returns a next page cursor, and reads an issue by id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      calls.push({ url, ...(init === undefined ? {} : { init }) })
      return url.includes('/issues/7') ? response(issue(7)) : response([issue(7), issue(8)])
    }))
    const result = await provider().list({ source: 'gitee', query: 'issue 7', limit: 2 })
    expect(result).toEqual({ items: [expect.objectContaining({ id: 'gitee:acme/repo#7' })], truncated: true, nextCursor: '2' })
    expect(await provider().get({ id: WorkItemId('gitee:acme/repo#7') })).toMatchObject({ id: 'gitee:acme/repo#7' })
    await expect(provider().get({ id: WorkItemId('gitee:acme/other#7') })).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('rejects invalid configuration, scopes, cursors, and limits before fetch', async () => {
    for (const config of [{ owner: '' }, { owner: 'acme/repo' }, { repository: 'repo/name' }, { timeoutMs: 0 }, { timeoutMs: 120_001 }, { maxItems: 101 }]) {
      expect(() => resolveGiteeWorkItemsConfig(config)).toThrow()
    }
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const p = provider()
    for (const request of [
      { source: 'gitlab' }, { scope: { source: 'gitee', owner: 'other', repository: 'repo' } },
      { cursor: '0' }, { cursor: 'not-a-page' }, { query: 'x'.repeat(501) }, { limit: 0 }, { limit: 3 },
    ]) await expect(p.list(request as never)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails closed for absent credentials and classifies HTTP and malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(provider(context('')).list({ source: 'gitee' })).rejects.toMatchObject({ code: 'authentication-required' })
    for (const [status, code] of [[401, 'authentication-required'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limited'], [500, 'provider-failed']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
      await expect(provider().list({ source: 'gitee' })).rejects.toMatchObject({ code })
    }
    vi.stubGlobal('fetch', vi.fn(async () => response([issue(7, 'https://evil.example/acme/repo/issues/7')])))
    await expect(provider().list({ source: 'gitee' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))
    await expect(provider().list({ source: 'gitee' })).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('rejects redirects, propagates cancellation, and stops after disposal', async () => {
    const p = provider()
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      throw new TypeError('redirect disallowed')
    }))
    await expect(p.list({ source: 'gitee' })).rejects.toMatchObject({ code: 'provider-failed' })
    const controller = new AbortController()
    controller.abort()
    await expect(p.list({ source: 'gitee' }, controller.signal)).rejects.toMatchObject({ code: 'aborted' })
    p.dispose()
    await expect(p.list({ source: 'gitee' })).rejects.toMatchObject({ code: 'unavailable' })
  })
})
