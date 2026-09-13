import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as GitHubPlugin from '../src/index.ts'
import { GitHubWorkItemsProvider, GITHUB_API_ORIGIN, resolveGitHubWorkItemsConfig } from '../src/index.ts'
import WorkItemsRuntime, { WorkItemId, WorkItemsError } from '@deepseek-ai/dsh-work-items'

const calls: { url: string; init?: RequestInit }[] = []
function record(url: string, init: RequestInit | undefined): void { calls.push({ url, ...(init === undefined ? {} : { init }) }) }
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0 })
function contextWithResolver(resolve: () => Promise<unknown>): Context {
  const ctx = new Context()
  ctx.provide('credentials', { resolve: vi.fn(resolve) } as never)
  return ctx
}
function context(token?: string): Context {
  return contextWithResolver(async () => token === undefined ? undefined : { value: token, source: 'fixture' })
}
function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
function issue(number: number, pullRequest = false, url = 'https://github.com/acme/repo/issues/' + String(number)): Record<string, unknown> {
  return { number, title: 'Issue ' + String(number), body: 'body', state: 'open', html_url: url, labels: [{ name: 'bug' }], assignees: [{ login: 'alice' }], user: { login: 'author' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', ...(pullRequest ? { pull_request: { url: 'https://api.github.com/pulls/' + String(number) } } : {}) }
}
function provider(ctx = context('secret')): GitHubWorkItemsProvider { return new GitHubWorkItemsProvider(ctx, resolveGitHubWorkItemsConfig({ owner: 'acme', repository: 'repo', maxItems: 20 })) }

describe('GitHubWorkItemsProvider', () => {
  it('keeps writes opt-in and maps create/comment/state/assignment to bounded REST mutations', async () => {
    expect(provider().writer).toBeUndefined()
    const p = new GitHubWorkItemsProvider(context('fixture-token'), resolveGitHubWorkItemsConfig({ owner: 'acme', repository: 'repo', allowWrites: true }))
    const writer = p.writer!
    expect(writer.scope).not.toContain('GITHUB_TOKEN')
    expect(writer.scope).toContain('sha256:')
    expect(new GitHubWorkItemsProvider(context('fixture-token'), resolveGitHubWorkItemsConfig({ owner: 'acme', repository: 'repo', allowWrites: true, credentialRef: 'OTHER_TOKEN' })).writer?.scope).not.toBe(writer.scope)
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response(calls.at(-1)?.url.endsWith('/comments') ? { id: 12 } : issue(7))
    }))
    await writer.validate({ kind: 'comment', id: WorkItemId('github:acme/repo#7'), body: 'Review' })
    expect(calls).toHaveLength(0)
    await writer.execute({ kind: 'create', source: 'github', title: 'New issue', body: 'Details' })
    await writer.execute({ kind: 'comment', id: WorkItemId('github:acme/repo#7'), body: 'Review' })
    await writer.execute({ kind: 'state', id: WorkItemId('github:acme/repo#7'), state: 'closed' })
    await writer.execute({ kind: 'assign', id: WorkItemId('github:acme/repo#7'), assignees: ['alice'] })
    expect(calls.map(call => call.init?.method)).toEqual(['POST', 'POST', 'PATCH', 'PATCH'])
    expect(calls.map(call => JSON.parse(call.init?.body as string) as unknown)).toEqual([
      { title: 'New issue', body: 'Details' }, { body: 'Review' }, { state: 'closed' }, { assignees: ['alice'] },
    ])
    await expect(writer.execute({ kind: 'state', id: WorkItemId('github:other/repo#7'), state: 'closed' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(writer.validate({ kind: 'state', id: WorkItemId('github:acme/repo#7'), state: 'unknown' })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(calls).toHaveLength(4)
  })

  it('maps issues, excludes pull requests, and uses the fixed credentialed endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { record(input instanceof Request ? input.url : String(input), init); return new Response(JSON.stringify([issue(7), issue(8, true)]), { status: 200 }) }))
    const result = await provider().list({ source: 'github', state: 'all', limit: 2 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'github:acme/repo#7', source: 'github', key: '#7', assignees: ['alice'] })
    expect(calls[0]?.url).toContain(GITHUB_API_ORIGIN + '/repos/acme/repo/issues?')
    expect(calls[0]?.url).toContain('state=all')
    expect(calls[0]?.init).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer secret' } })
  })

  it('fails closed when credentials are absent and never performs fetch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(provider(context()).list({ source: 'github' })).rejects.toMatchObject({ code: 'authentication-required' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps HTTP failures, malformed responses, redirects, and cancellation safely', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'authentication-required' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'forbidden' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
    const redirectFetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => { expect(init?.redirect).toBe('error'); throw new TypeError('redirect disallowed') })
    vi.stubGlobal('fetch', redirectFetch)
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'provider-failed' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([issue(9, false, 'https://github.com:8443/acme/repo/issues/9')]), { status: 200 })))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(2_000_001), { status: 200 })))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
    const controller = new AbortController(); controller.abort()
    await expect(provider().list({ source: 'github' }, controller.signal)).rejects.toMatchObject({ code: 'aborted' })
  })

  it('validates deployment config, availability, scopes, and list bounds', async () => {
    const defaults = new GitHubWorkItemsProvider(context('secret'), resolveGitHubWorkItemsConfig())
    expect(defaults.available()).toBe(false)
    expect(resolveGitHubWorkItemsConfig({ owner: 'acme', repository: 'repo', credentialRef: 'TOKEN', timeoutMs: 1, maxItems: 1 })).toMatchObject({ owner: 'acme', repository: 'repo', timeoutMs: 1, maxItems: 1 })
    for (const config of [
      { owner: '' },
      { owner: ' untrimmed' },
      { owner: 'x'.repeat(501) },
      { repository: '' },
      { timeoutMs: Number.NaN },
      { timeoutMs: 0 },
      { timeoutMs: 120_001 },
      { maxItems: Number.NaN },
      { maxItems: 0 },
      { maxItems: 101 },
    ]) expect(() => resolveGitHubWorkItemsConfig(config)).toThrow()

    const p = provider()
    const invalidRequests = [
      { source: 'linear' },
      { source: 'github', scope: { source: 'linear' } },
      { source: 'github', scope: { source: 'github', owner: 'other', repository: 'repo' } },
      { source: 'github', scope: { source: 'github', owner: 'acme', repository: 'other' } },
      { source: 'github', query: 'x'.repeat(501) },
      { source: 'github', cursor: 'x'.repeat(501) },
      { source: 'github', cursor: '0' },
      { source: 'github', cursor: 'not-a-page' },
      { source: 'github', limit: 0 },
      { source: 'github', limit: 21 },
      { source: 'github', limit: Number.NaN },
    ]
    for (const request of invalidRequests) {
      await expect(p.list(request as never)).rejects.toMatchObject({ code: 'invalid-request' })
    }
  })

  it('maps sparse results, query filters, pagination, and get responses', async () => {
    const sparse = { ...issue(2), body: null, created_at: null, updated_at: undefined, labels: [], assignees: [] }
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      record(input instanceof Request ? input.url : String(input), undefined)
      return response([sparse, { ...sparse, number: 3, title: 'Other', body: undefined }])
    }))
    const filtered = await provider().list({ source: 'github', cursor: '2', query: 'issue 2' })
    expect(filtered.items).toEqual([expect.objectContaining({ id: 'github:acme/repo#2', labels: [], assignees: [] })])
    expect(filtered.items[0]).not.toHaveProperty('body')
    expect(calls[0]?.url).toContain('page=2')

    vi.stubGlobal('fetch', vi.fn(async () => response(issue(7))))
    await expect(provider().get({ id: WorkItemId('github:acme/repo#7') })).resolves.toMatchObject({ id: 'github:acme/repo#7' })
    vi.stubGlobal('fetch', vi.fn(async () => response(issue(7, true))))
    await expect(provider().get({ id: WorkItemId('github:acme/repo#7') })).rejects.toMatchObject({ code: 'not-found' })
    await expect(provider().get({ id: WorkItemId('github:acme/other#7') })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(provider().get({ id: WorkItemId('invalid') })).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('rejects malformed GitHub Issue fields and URLs', async () => {
    const malformed: unknown[] = [
      'issue',
      null,
      [],
      { ...issue(1), number: '1' },
      { ...issue(1), number: 1.5 },
      { ...issue(1), number: 0 },
      { ...issue(1), title: 1 },
      { ...issue(1), title: '' },
      { ...issue(1), title: 'x'.repeat(20_001) },
      { ...issue(1), body: 1 },
      { ...issue(1), body: 'x'.repeat(20_001) },
      { ...issue(1), created_at: 1 },
      { ...issue(1), created_at: 'not-a-time' },
      { ...issue(1), html_url: 'http://github.com/acme/repo/issues/1' },
      { ...issue(1), html_url: 'https://example.com/acme/repo/issues/1' },
      { ...issue(1), html_url: 'https://github.com:8443/acme/repo/issues/1' },
      { ...issue(1), html_url: 'https://user@github.com/acme/repo/issues/1' },
      { ...issue(1), html_url: 'https://:secret@github.com/acme/repo/issues/1' },
      { ...issue(1), html_url: 'https://github.com/acme/repo/issues/1?q=1' },
      { ...issue(1), html_url: 'https://github.com/acme/repo/issues/1#hash' },
      { ...issue(1), labels: null },
      { ...issue(1), labels: Array.from({ length: 101 }, () => ({ name: 'x' })) },
      { ...issue(1), labels: ['label'] },
      { ...issue(1), labels: [{ name: '' }] },
      { ...issue(1), assignees: null },
      { ...issue(1), assignees: Array.from({ length: 101 }, () => ({ login: 'x' })) },
      { ...issue(1), assignees: ['assignee'] },
      { ...issue(1), assignees: [{ login: '' }] },
    ]
    for (const candidate of malformed) {
      vi.stubGlobal('fetch', vi.fn(async () => response([candidate])))
      await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
    }

    vi.stubGlobal('fetch', vi.fn(async () => response([issue(1)])))
    const longOwner = new GitHubWorkItemsProvider(context('secret'), resolveGitHubWorkItemsConfig({ owner: 'x'.repeat(500), repository: 'r' }))
    await expect(longOwner.list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('classifies credential, HTTP, timeout, body, and list failures', async () => {
    const noCredentials = new GitHubWorkItemsProvider(new Context(), resolveGitHubWorkItemsConfig({ owner: 'acme', repository: 'repo' }))
    await expect(noCredentials.list({ source: 'github' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => ({ value: '', source: 'fixture' }))).list({ source: 'github' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new Error('resolver failed') })).list({ source: 'github' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new WorkItemsError('forbidden', 'safe') })).list({ source: 'github' })).rejects.toMatchObject({ code: 'forbidden' })

    const abort = new AbortController()
    const aborting = provider(contextWithResolver(async () => {
      abort.abort('credential cancelled')
      return { value: 'secret', source: 'fixture' }
    }))
    await expect(aborting.list({ source: 'github' }, abort.signal)).rejects.toMatchObject({ code: 'aborted' })

    for (const [status, code] of [[404, 'not-found'], [429, 'rate-limited'], [500, 'provider-failed']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
      await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code })
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ not: 'a list' })))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response(Array.from({ length: 21 }, () => issue(1)))))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull() { throw new Error('read failed') } }))))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'provider-failed' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(2_000_001)) },
      cancel() { throw new Error('cleanup failed') },
    }))))
    await expect(provider().list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })

    const bodyAbort = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        bodyAbort.abort('body cancelled')
        controller.enqueue(new TextEncoder().encode('[]'))
        controller.close()
      },
    }))))
    await expect(provider().list({ source: 'github' }, bodyAbort.signal)).rejects.toMatchObject({ code: 'aborted' })

    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true })
    })))
    const timed = new GitHubWorkItemsProvider(context('secret'), resolveGitHubWorkItemsConfig({ owner: 'acme', repository: 'repo', timeoutMs: 1 }))
    await expect(timed.list({ source: 'github' })).rejects.toMatchObject({ code: 'provider-failed', message: expect.stringContaining('timed out') as unknown })
  })

  it('aborts an in-flight request when disposed', async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true }))
    }))
    const p = provider()
    const pending = p.list({ source: 'github' })
    await vi.waitFor(() =>{  expect(requestSignal).toBeDefined() })
    p.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('removes its provider registration when the plugin fiber unloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([issue(1)]), { status: 200 })))
    const ctx = context('secret')
    await ctx.plugin(WorkItemsRuntime)
    const fiber = ctx.plugin(GitHubPlugin, { owner: 'acme', repository: 'repo' })
    await fiber.await()
    await expect(ctx.workItems.list({ source: 'github' })).resolves.toMatchObject({ items: [{ source: 'github' }] })
    await fiber.dispose()
    await expect(ctx.workItems.list({ source: 'github' })).rejects.toMatchObject({ code: 'configured-missing' })
    await ctx.fiber.dispose()
  })

  it('validates item identity, bounds, and disposal', async () => {
    expect(() => resolveGitHubWorkItemsConfig({ maxItems: 101 })).toThrow(/no greater than/)
    expect(() => resolveGitHubWorkItemsConfig({ bad: true } as never)).toThrow(/unsupported config key/)
    const p = provider()
    await expect(p.get({ id: WorkItemId('github:other/repo#1') })).rejects.toMatchObject({ code: 'invalid-request' })
    p.dispose()
    await expect(p.list({ source: 'github' })).rejects.toMatchObject({ code: 'unavailable' })
    await expect(p.get({ id: WorkItemId('github:acme/repo#1') })).rejects.toMatchObject({ code: 'unavailable' })
    p.dispose()
  })
})
