import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as GitLabPlugin from '../src/index.ts'
import { GitLabWorkItemsProvider, GITLAB_API_ORIGIN, resolveGitLabWorkItemsConfig } from '../src/index.ts'
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
function issue(iid: number, url = 'https://gitlab.com/acme/repo/-/issues/' + String(iid)): Record<string, unknown> {
  return { iid, title: 'Issue ' + String(iid), description: 'body', state: 'opened', web_url: url, labels: [{ name: 'bug' }], assignees: [{ username: 'alice' }], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }
}
function provider(ctx = context('secret')): GitLabWorkItemsProvider { return new GitLabWorkItemsProvider(ctx, resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', maxItems: 20 })) }

describe('GitLabWorkItemsProvider', () => {
  it('keeps writes opt-in and maps create/comment/state/assignment to bounded REST mutations', async () => {
    expect(provider().writer).toBeUndefined()
    const p = new GitLabWorkItemsProvider(context('fixture-token'), resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', allowWrites: true }))
    const writer = p.writer!
    expect(writer.scope).not.toContain('GITLAB_TOKEN')
    expect(writer.scope).toContain('sha256:')
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response(calls.at(-1)?.url.includes('/notes') ? { id: 12 } : issue(7))
    }))
    await writer.validate({ kind: 'comment', id: WorkItemId('gitlab:acme/repo#7'), body: 'Review' })
    expect(calls).toHaveLength(0)
    await writer.execute({ kind: 'create', source: 'gitlab', title: 'New issue', body: 'Details' })
    await writer.execute({ kind: 'comment', id: WorkItemId('gitlab:acme/repo#7'), body: 'Review' })
    await writer.execute({ kind: 'state', id: WorkItemId('gitlab:acme/repo#7'), state: 'closed' })
    await writer.execute({ kind: 'assign', id: WorkItemId('gitlab:acme/repo#7'), assignees: [] })
    expect(calls.map(call => call.init?.method)).toEqual(['POST', 'POST', 'PUT', 'PUT'])
    expect(calls.map(call => JSON.parse(call.init?.body as string) as unknown)).toEqual([
      { title: 'New issue', description: 'Details' }, { body: 'Review' }, { state_event: 'close' }, { assignee_ids: [] },
    ])
    await expect(writer.execute({ kind: 'state', id: WorkItemId('gitlab:other/repo#7'), state: 'closed' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(writer.validate({ kind: 'state', id: WorkItemId('gitlab:acme/repo#7'), state: 'unknown' })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(calls).toHaveLength(4)
  })

  it('resolves every requested username before assigning exact GitLab user ids', async () => {
    const p = new GitLabWorkItemsProvider(context('fixture-token'), resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', origin: 'https://gitlab.example.com', allowWrites: true }))
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      record(url.href, init)
      if (url.pathname === '/api/v4/users') {
        const username = url.searchParams.get('username')
        expect(url.searchParams.get('per_page')).toBe('2')
        return response([{ id: username === 'Alice' ? 41 : 72, username: username?.toLowerCase() }])
      }
      return response(issue(7, 'https://gitlab.example.com/acme/repo/-/issues/7'))
    }))
    try {
      await p.writer!.execute({ kind: 'assign', id: WorkItemId('gitlab:acme/repo#7'), assignees: ['Alice', 'bob'] })
      expect(calls.map(call => call.init?.method)).toEqual(['GET', 'GET', 'PUT'])
      expect(calls.every(call => call.url.startsWith('https://gitlab.example.com/'))).toBe(true)
      expect(calls.every(call => (call.init?.headers as Record<string, string>)['PRIVATE-TOKEN'] === 'fixture-token')).toBe(true)
      expect(JSON.parse(calls[2]!.init!.body as string)).toEqual({ assignee_ids: [41, 72] })
    } finally { p.dispose() }
  })

  it.each([
    ['missing', [], 'write-rejected'],
    ['ambiguous', [{ id: 1, username: 'alice' }, { id: 2, username: 'Alice' }], 'write-rejected'],
    ['different username', [{ id: 1, username: 'someone-else' }], 'write-rejected'],
    ['invalid id', [{ id: 0, username: 'alice' }], 'invalid-response'],
    ['invalid response', { id: 1, username: 'alice' }, 'invalid-response'],
  ])('rejects a %s assignee lookup without changing the issue', async (_name, users, code) => {
    const p = new GitLabWorkItemsProvider(context('fixture-token'), resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', allowWrites: true }))
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response(users)
    }))
    const mutation = { kind: 'assign' as const, id: WorkItemId('gitlab:acme/repo#7'), assignees: ['alice'] }
    try {
      await expect(p.writer!.validate(mutation)).rejects.toMatchObject({ code })
      await expect(p.writer!.execute(mutation)).rejects.toMatchObject({ code })
      expect(calls.map(call => call.init?.method)).toEqual(['GET', 'GET'])
    } finally { p.dispose() }
  })

  it('keeps assignments intact when a later username lookup is unavailable or canceled', async () => {
    const p = new GitLabWorkItemsProvider(context('fixture-token'), resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', allowWrites: true }))
    const mutation = { kind: 'assign' as const, id: WorkItemId('gitlab:acme/repo#7'), assignees: ['alice', 'bob'] }
    const controller = new AbortController()
    let cancel = false
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      record(url.href, init)
      if (url.searchParams.get('username') === 'alice') return response([{ id: 41, username: 'alice' }])
      if (cancel) { controller.abort(); throw new Error('canceled lookup') }
      return response({}, 503)
    }))
    try {
      await expect(p.writer!.execute(mutation)).rejects.toMatchObject({ code: 'provider-failed' })
      cancel = true
      await expect(p.writer!.execute(mutation, controller.signal)).rejects.toMatchObject({ code: 'aborted' })
      expect(calls).toHaveLength(4)
      expect(calls.every(call => call.init?.method === 'GET')).toBe(true)
    } finally { p.dispose() }
  })

  it('maps issues and uses the fixed credentialed endpoint with PRIVATE-TOKEN header', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { record(input instanceof Request ? input.url : String(input), init); return new Response(JSON.stringify([issue(7)]), { status: 200 }) }))
    const result = await provider().list({ source: 'gitlab', state: 'all', limit: 2 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'gitlab:acme/repo#7', source: 'gitlab', key: '#7', assignees: ['alice'] })
    expect(calls[0]?.url).toContain(GITLAB_API_ORIGIN + '/api/v4/projects/acme%2Frepo/issues?')
    expect(calls[0]?.url).toContain('state=all')
    expect(calls[0]?.init).toMatchObject({ redirect: 'error', headers: { 'PRIVATE-TOKEN': 'secret' } })
  })

  it('fails closed when credentials are absent and never performs fetch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(provider(context()).list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'authentication-required' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps HTTP failures, malformed responses, and cancellation safely', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'authentication-required' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'forbidden' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => { expect(init?.redirect).toBe('error'); throw new TypeError('redirect disallowed') }))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'provider-failed' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([issue(9, 'https://evil.com/acme/repo/-/issues/9')]), { status: 200 })))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'invalid-response' })
    const controller = new AbortController(); controller.abort()
    await expect(provider().list({ source: 'gitlab' }, controller.signal)).rejects.toMatchObject({ code: 'aborted' })
  })

  it('validates deployment config, availability, scopes, and list bounds', async () => {
    const defaults = new GitLabWorkItemsProvider(context('secret'), resolveGitLabWorkItemsConfig())
    expect(defaults.available()).toBe(false)
    expect(resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', credentialRef: 'TOKEN', timeoutMs: 1, maxItems: 1 })).toMatchObject({ owner: 'acme', repository: 'repo', timeoutMs: 1, maxItems: 1 })
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
    ]) expect(() => resolveGitLabWorkItemsConfig(config)).toThrow()

    const p = provider()
    const invalidRequests = [
      { source: 'linear' },
      { source: 'gitlab', scope: { source: 'linear' } },
      { source: 'gitlab', scope: { source: 'gitlab', owner: 'other', repository: 'repo' } },
      { source: 'gitlab', scope: { source: 'gitlab', owner: 'acme', repository: 'other' } },
      { source: 'gitlab', query: 'x'.repeat(501) },
      { source: 'gitlab', cursor: 'x'.repeat(501) },
      { source: 'gitlab', cursor: '0' },
      { source: 'gitlab', cursor: 'not-a-page' },
      { source: 'gitlab', limit: 0 },
      { source: 'gitlab', limit: 21 },
      { source: 'gitlab', limit: Number.NaN },
    ]
    for (const request of invalidRequests) {
      await expect(p.list(request as never)).rejects.toMatchObject({ code: 'invalid-request' })
    }
  })

  it('maps sparse results, query filters, pagination, and get responses', async () => {
    const sparse = { ...issue(2), description: null, created_at: null, updated_at: undefined, labels: [], assignees: [] }
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      record(input instanceof Request ? input.url : String(input), undefined)
      return response([sparse, { ...sparse, iid: 3, title: 'Other', description: undefined }])
    }))
    const filtered = await provider().list({ source: 'gitlab', cursor: '2', query: 'issue 2' })
    expect(filtered.items).toEqual([expect.objectContaining({ id: 'gitlab:acme/repo#2', labels: [], assignees: [] })])
    expect(filtered.items[0]).not.toHaveProperty('body')
    expect(calls[0]?.url).toContain('page=2')

    vi.stubGlobal('fetch', vi.fn(async () => response(issue(7))))
    await expect(provider().get({ id: WorkItemId('gitlab:acme/repo#7') })).resolves.toMatchObject({ id: 'gitlab:acme/repo#7' })
    await expect(provider().get({ id: WorkItemId('gitlab:acme/other#7') })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(provider().get({ id: WorkItemId('invalid') })).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('classifies credential, HTTP, timeout, and list failures', async () => {
    const noCredentials = new GitLabWorkItemsProvider(new Context(), resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo' }))
    await expect(noCredentials.list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => ({ value: '', source: 'fixture' }))).list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new Error('resolver failed') })).list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new WorkItemsError('forbidden', 'safe') })).list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'forbidden' })

    for (const [status, code] of [[404, 'not-found'], [429, 'rate-limited'], [500, 'provider-failed']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
      await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code })
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ not: 'a list' })))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response(Array.from({ length: 21 }, () => issue(1)))))
    await expect(provider().list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'invalid-response' })

    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true })
    })))
    const timed = new GitLabWorkItemsProvider(context('secret'), resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', timeoutMs: 1 }))
    await expect(timed.list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'provider-failed', message: expect.stringContaining('timed out') as unknown })
  })

  it('aborts an in-flight request when disposed', async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true }))
    }))
    const p = provider()
    const pending = p.list({ source: 'gitlab' })
    await vi.waitFor(() =>{  expect(requestSignal).toBeDefined() })
    p.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('removes its provider registration when the plugin fiber unloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([issue(1)]), { status: 200 })))
    const ctx = context('secret')
    await ctx.plugin(WorkItemsRuntime)
    const fiber = ctx.plugin(GitLabPlugin, { owner: 'acme', repository: 'repo' })
    await fiber.await()
    await expect(ctx.workItems.list({ source: 'gitlab' })).resolves.toMatchObject({ items: [{ source: 'gitlab' }] })
    await fiber.dispose()
    await expect(ctx.workItems.list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'configured-missing' })
    await ctx.fiber.dispose()
  })

  it('validates item identity, bounds, and disposal', async () => {
    expect(() => resolveGitLabWorkItemsConfig({ maxItems: 101 })).toThrow(/no greater than/)
    expect(() => resolveGitLabWorkItemsConfig({ bad: true } as never)).toThrow(/unsupported config key/)
    const p = provider()
    await expect(p.get({ id: WorkItemId('gitlab:other/repo#1') })).rejects.toMatchObject({ code: 'invalid-request' })
    p.dispose()
    await expect(p.list({ source: 'gitlab' })).rejects.toMatchObject({ code: 'unavailable' })
    await expect(p.get({ id: WorkItemId('gitlab:acme/repo#1') })).rejects.toMatchObject({ code: 'unavailable' })
    p.dispose()
  })

  it('supports self-hosted GitLab origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { record(input instanceof Request ? input.url : String(input), init); return new Response(JSON.stringify([issue(1, 'https://gitlab.example.com/acme/repo/-/issues/1')]), { status: 200 }) }))
    const p = new GitLabWorkItemsProvider(context('secret'), resolveGitLabWorkItemsConfig({ owner: 'acme', repository: 'repo', origin: 'https://gitlab.example.com' }))
    const result = await p.list({ source: 'gitlab' })
    expect(result.items).toHaveLength(1)
    expect(calls[0]?.url).toContain('https://gitlab.example.com/api/v4/projects/acme%2Frepo/issues')
  })
})
