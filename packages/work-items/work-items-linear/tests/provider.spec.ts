import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as LinearPlugin from '../src/index.ts'
import { LinearWorkItemsProvider, LINEAR_API_ORIGIN, resolveLinearWorkItemsConfig } from '../src/index.ts'
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
function requestBody(): string {
  const body = calls[0]?.init?.body
  if (typeof body !== 'string') throw new Error('Expected JSON request text')
  return body
}
function listResponse(nodes: unknown[], pageInfo: Record<string, unknown> = { hasNextPage: false, endCursor: null }): Response {
  return response({ data: { issues: { nodes, pageInfo } } })
}
function linearIssue(id = 'issue-1', url = 'https://linear.app/acme/issue/DSH-1/linear-issue'): Record<string, unknown> {
  return { id, identifier: 'DSH-1', title: 'Linear issue', description: 'details', url, state: { name: 'Started', type: 'started' }, labels: { nodes: [{ name: 'feature' }] }, assignee: { name: 'bob' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }
}
function provider(ctx = context('secret')): LinearWorkItemsProvider { return new LinearWorkItemsProvider(ctx, resolveLinearWorkItemsConfig({ team: 'team-1', maxItems: 20 })) }

describe('LinearWorkItemsProvider', () => {
  it('keeps writes opt-in and validates team ownership before each GraphQL mutation', async () => {
    expect(provider().writer).toBeUndefined()
    const p = new LinearWorkItemsProvider(context('fixture-token'), resolveLinearWorkItemsConfig({ team: 'team-1', allowWrites: true }))
    const writer = p.writer!
    expect(writer.scope).not.toContain('LINEAR_API_KEY')
    expect(writer.scope).toContain('sha256:')
    expect(new LinearWorkItemsProvider(context('fixture-token'), resolveLinearWorkItemsConfig({ team: 'team-1', allowWrites: true, credentialRef: 'OTHER_TOKEN' })).writer?.scope).not.toBe(writer.scope)
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      const request = JSON.parse(init?.body as string) as { query: string }
      if (request.query.includes('workflowState')) return response({ data: { workflowState: { id: 'state-1', team: { id: 'team-1' } } } })
      if (request.query.startsWith('query')) return response({ data: { issue: { id: 'issue-1', url: 'https://linear.app/acme/issue/ONE-1', team: { id: 'team-1' }, project: null } } })
      if (request.query.includes('issueCreate')) return response({ data: { issueCreate: { success: true, issue: { id: 'issue-2', url: 'https://linear.app/acme/issue/ONE-2' } } } })
      if (request.query.includes('commentCreate')) return response({ data: { commentCreate: { success: true, comment: { id: 'comment-1' } } } })
      return response({ data: { issueUpdate: { success: true, issue: { id: 'issue-1' } } } })
    }))
    await writer.execute({ kind: 'create', source: 'linear', title: 'Title', body: 'Body' })
    await writer.execute({ kind: 'comment', id: WorkItemId('linear:issue-1'), body: 'Review' })
    await writer.execute({ kind: 'state', id: WorkItemId('linear:issue-1'), state: 'state-1' })
    await writer.execute({ kind: 'assign', id: WorkItemId('linear:issue-1'), assignees: [] })
    const mutations = calls.map(call => JSON.parse(call.init?.body as string) as { query: string; variables: unknown }).filter(call => call.query.startsWith('mutation'))
    expect(mutations.map(call => call.variables)).toEqual([
      { input: { teamId: 'team-1', title: 'Title', description: 'Body' } },
      { input: { issueId: 'issue-1', body: 'Review' } },
      { id: 'issue-1', input: { stateId: 'state-1' } },
      { id: 'issue-1', input: { assigneeId: null } },
    ])
    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response({ data: { issue: { id: 'issue-1', url: 'https://linear.app/acme/issue/ONE-1', team: { id: 'other-team' }, project: null } } })
    }))
    await expect(writer.execute({ kind: 'comment', id: WorkItemId('linear:issue-1'), body: 'Review' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toHaveLength(1)
    expect((JSON.parse(calls[0]?.init?.body as string) as { query: string }).query.startsWith('query')).toBe(true)
  })

  it('maps GraphQL issue nodes and sends a fixed credentialed request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { record(input instanceof Request ? input.url : String(input), init); return new Response(JSON.stringify({ data: { issues: { nodes: [linearIssue()], pageInfo: { hasNextPage: true, endCursor: 'cursor-2' } } } }), { status: 200 }) }))
    const result = await provider().list({ source: 'linear', limit: 2 })
    expect(result).toMatchObject({ items: [{ id: 'linear:issue-1', key: 'DSH-1', assignees: ['bob'] }], nextCursor: 'cursor-2' })
    expect(calls[0]?.url).toBe(LINEAR_API_ORIGIN + '/graphql')
    expect(calls[0]?.init).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: 'secret' } })
    const body = JSON.parse(requestBody()) as { query: string; variables: Record<string, unknown> }
    expect(body.query).toContain('query($first: Int!, $after: String, $filter: IssueFilter)')
    expect(body.variables).toMatchObject({ filter: { team: { id: { eq: 'team-1' } }, state: { type: { nin: ['completed', 'canceled'] } } } })
  })

  it('maps GraphQL auth and malformed responses without exposing response data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'secret', extensions: { code: 'AUTHENTICATION_ERROR' } }] }), { status: 200 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'authentication-required' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { issue: null } }), { status: 200 })))
    await expect(provider().get({ id: WorkItemId('linear:missing') })).rejects.toMatchObject({ code: 'not-found' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'rate-limited' })
  })

  it('validates deployment config, availability, scopes, and list bounds', async () => {
    const defaults = new LinearWorkItemsProvider(context('secret'), resolveLinearWorkItemsConfig())
    expect(defaults.available()).toBe(false)
    await expect(defaults.list({ source: 'linear' })).rejects.toMatchObject({ code: 'unavailable' })
    await expect(defaults.get({ id: WorkItemId('linear:one') })).rejects.toMatchObject({ code: 'unavailable' })
    expect(resolveLinearWorkItemsConfig({ team: 'team', project: 'project', credentialRef: 'TOKEN', timeoutMs: 1, maxItems: 1 })).toMatchObject({ team: 'team', project: 'project', timeoutMs: 1, maxItems: 1 })
    for (const config of [
      { team: '' },
      { team: ' untrimmed' },
      { team: 'x'.repeat(501) },
      { project: '' },
      { timeoutMs: Number.NaN },
      { timeoutMs: 0 },
      { timeoutMs: 120_001 },
      { maxItems: Number.NaN },
      { maxItems: 0 },
      { maxItems: 101 },
    ]) expect(() => resolveLinearWorkItemsConfig(config)).toThrow()

    const p = provider()
    const invalidRequests = [
      { source: 'github' },
      { source: 'linear', scope: { source: 'github' } },
      { source: 'linear', scope: { source: 'linear', team: 'other' } },
      { source: 'linear', scope: { source: 'linear', project: 'other' } },
      { source: 'linear', query: 'x'.repeat(501) },
      { source: 'linear', cursor: 'x'.repeat(501) },
      { source: 'linear', limit: 0 },
      { source: 'linear', limit: 21 },
      { source: 'linear', limit: Number.NaN },
    ]
    for (const request of invalidRequests) {
      await expect(p.list(request as never)).rejects.toMatchObject({ code: 'invalid-request' })
    }
  })

  it('builds team/project/state filters and maps sparse list and get results', async () => {
    const sparse = { ...linearIssue('issue-2'), title: 'Needle', description: null, assignee: null, createdAt: null, updatedAt: undefined, labels: { nodes: [] } }
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return listResponse([sparse, { ...sparse, id: 'issue-3', title: 'Other', description: undefined, assignee: undefined }])
    }))
    const both = new LinearWorkItemsProvider(context('secret'), resolveLinearWorkItemsConfig({ team: 'team-1', project: 'project-1', maxItems: 20 }))
    const filtered = await both.list({ source: 'linear', state: 'closed', cursor: 'cursor-1', query: 'needle' })
    expect(filtered.items).toEqual([expect.objectContaining({ id: 'linear:issue-2', labels: [], assignees: [] })])
    expect(filtered.items[0]).not.toHaveProperty('body')
    const body = JSON.parse(requestBody()) as { query: string; variables: Record<string, unknown> }
    expect(body.variables).toMatchObject({ after: 'cursor-1', filter: {
      team: { id: { eq: 'team-1' } }, project: { id: { eq: 'project-1' } },
      state: { type: { in: ['completed', 'canceled'] } },
    } })

    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { record(input instanceof Request ? input.url : String(input), init); return listResponse([]) }))
    const projectOnly = new LinearWorkItemsProvider(context('secret'), resolveLinearWorkItemsConfig({ project: 'project-1' }))
    await projectOnly.list({ source: 'linear', state: 'all', query: '' })
    const projectBody = JSON.parse(requestBody()) as { query: string; variables: Record<string, unknown> }
    expect(projectBody.query).toContain('query($first: Int!, $after: String, $filter: IssueFilter)')
    expect(projectBody.variables).toEqual({ first: 50, after: null, filter: { project: { id: { eq: 'project-1' } } } })

    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response({ data: { issue: linearIssue('issue-get') } })
    }))
    await expect(provider().get({ id: WorkItemId('linear:issue-get') })).resolves.toMatchObject({ id: 'linear:issue-get' })
    expect(JSON.parse(requestBody())).toMatchObject({ query: expect.stringContaining('query($id: String!)') as unknown, variables: { id: 'issue-get' } })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: {} })))
    await expect(provider().get({ id: WorkItemId('linear:missing') })).rejects.toMatchObject({ code: 'not-found' })
    for (const id of ['github:one', 'linear:', 'linear:' + 'x'.repeat(501)]) {
      await expect(provider().get({ id: id as never })).rejects.toMatchObject({ code: 'invalid-request' })
    }
  })

  it('rejects malformed Linear issue fields and URLs', async () => {
    const malformed: unknown[] = [
      'issue',
      null,
      [],
      { ...linearIssue(), state: null },
      { ...linearIssue(), labels: null },
      { ...linearIssue(), labels: { nodes: null } },
      { ...linearIssue(), labels: { nodes: Array.from({ length: 101 }, () => ({ name: 'x' })) } },
      { ...linearIssue(), labels: { nodes: ['label'] } },
      { ...linearIssue(), labels: { nodes: [{ name: '' }] } },
      { ...linearIssue(), assignee: 'bob' },
      { ...linearIssue(), assignee: { name: '' } },
      { ...linearIssue(), id: 1 },
      { ...linearIssue(), id: '' },
      { ...linearIssue(), identifier: 1 },
      { ...linearIssue(), title: 1 },
      { ...linearIssue(), title: 'x'.repeat(20_001) },
      { ...linearIssue(), description: 1 },
      { ...linearIssue(), description: 'x'.repeat(20_001) },
      { ...linearIssue(), createdAt: 1 },
      { ...linearIssue(), createdAt: 'not-a-time' },
      { ...linearIssue(), state: { name: '' } },
      { ...linearIssue(), url: 'http://linear.app/acme/issue/DSH-1/x' },
      { ...linearIssue(), url: 'https://example.com/acme/issue/DSH-1/x' },
      { ...linearIssue(), url: 'https://linear.app:8443/acme/issue/DSH-1/x' },
      { ...linearIssue(), url: 'https://user@linear.app/acme/issue/DSH-1/x' },
      { ...linearIssue(), url: 'https://:secret@linear.app/acme/issue/DSH-1/x' },
      { ...linearIssue(), url: 'https://linear.app/acme/issue/DSH-1/x?q=1' },
      { ...linearIssue(), url: 'https://linear.app/acme/issue/DSH-1/x#hash' },
    ]
    for (const candidate of malformed) {
      vi.stubGlobal('fetch', vi.fn(async () => listResponse([candidate])))
      await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
    }

    vi.stubGlobal('fetch', vi.fn(async () => listResponse([linearIssue('x'.repeat(500))])))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('classifies GraphQL, credential, HTTP, body, and pagination failures', async () => {
    const noCredentials = new LinearWorkItemsProvider(new Context(), resolveLinearWorkItemsConfig({ team: 'team-1' }))
    await expect(noCredentials.list({ source: 'linear' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => ({ value: '', source: 'fixture' }))).list({ source: 'linear' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new Error('resolver failed') })).list({ source: 'linear' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new WorkItemsError('forbidden', 'safe') })).list({ source: 'linear' })).rejects.toMatchObject({ code: 'forbidden' })

    const abort = new AbortController()
    const aborting = provider(contextWithResolver(async () => {
      abort.abort('credential cancelled')
      return { value: 'secret', source: 'fixture' }
    }))
    await expect(aborting.list({ source: 'linear' }, abort.signal)).rejects.toMatchObject({ code: 'aborted' })

    for (const [status, code] of [[401, 'authentication-required'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limited'], [500, 'provider-failed']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
      await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code })
    }
    for (const errors of [
      [{ extensions: { code: 'FORBIDDEN' } }],
      [{ extensions: { code: 'OTHER' } }],
      ['error'],
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response({ errors })))
      await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: errors[0] && typeof errors[0] === 'object' && (errors[0] as { extensions?: { code?: string } }).extensions?.code === 'FORBIDDEN' ? 'forbidden' : 'provider-failed' })
    }

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
    for (const data of [null, [], 'data', {}, { issues: null }, { issues: { nodes: null, pageInfo: {} } }, { issues: { nodes: Array.from({ length: 21 }, () => linearIssue()), pageInfo: {} } }, { issues: { nodes: [], pageInfo: null } }]) {
      vi.stubGlobal('fetch', vi.fn(async () => response({ data })))
      await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
    }
    vi.stubGlobal('fetch', vi.fn(async () => listResponse([], { hasNextPage: true, endCursor: null })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull() { throw new Error('read failed') } }))))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'provider-failed' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(2_000_001)) },
      cancel() { throw new Error('cleanup failed') },
    }))))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })

    const bodyAbort = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        bodyAbort.abort('body cancelled')
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
    }))))
    await expect(provider().list({ source: 'linear' }, bodyAbort.signal)).rejects.toMatchObject({ code: 'aborted' })

    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true })
    })))
    const timed = new LinearWorkItemsProvider(context('secret'), resolveLinearWorkItemsConfig({ team: 'team-1', timeoutMs: 1 }))
    await expect(timed.list({ source: 'linear' })).rejects.toMatchObject({ code: 'provider-failed', message: expect.stringContaining('timed out') as unknown })
  })

  it('aborts an in-flight request when disposed', async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true }))
    }))
    const p = provider()
    const pending = p.list({ source: 'linear' })
    await vi.waitFor(() =>{  expect(requestSignal).toBeDefined() })
    p.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('removes its provider registration when the plugin fiber unloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { issues: { nodes: [linearIssue()], pageInfo: { hasNextPage: false, endCursor: null } } } }), { status: 200 })))
    const ctx = context('secret')
    await ctx.plugin(WorkItemsRuntime)
    const fiber = ctx.plugin(LinearPlugin, { team: 'team-1' })
    await fiber.await()
    await expect(ctx.workItems.list({ source: 'linear' })).resolves.toMatchObject({ items: [{ source: 'linear' }] })
    await fiber.dispose()
    await expect(ctx.workItems.list({ source: 'linear' })).rejects.toMatchObject({ code: 'configured-missing' })
    await ctx.fiber.dispose()
  })

  it('rejects wrong scope, missing credentials, redirects, invalid config, and disposal', async () => {
    expect(() => resolveLinearWorkItemsConfig({ maxItems: 101 })).toThrow(/no greater than/)
    expect(() => resolveLinearWorkItemsConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(provider(context()).list({ source: 'linear' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider().list({ source: 'linear', scope: { source: 'linear', team: 'other' } })).rejects.toMatchObject({ code: 'invalid-request' })
    const redirectFetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => { expect(init?.redirect).toBe('error'); throw new TypeError('redirect disallowed') })
    vi.stubGlobal('fetch', redirectFetch)
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'provider-failed' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { issues: { nodes: [linearIssue('issue-2', 'https://linear.app:8443/acme/issue/DSH-2/unsafe')], pageInfo: { hasNextPage: false, endCursor: null } } } }), { status: 200 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(2_000_001), { status: 200 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
    const p = provider(); p.dispose(); await expect(p.list({ source: 'linear' })).rejects.toMatchObject({ code: 'unavailable' }); p.dispose()
  })
})
