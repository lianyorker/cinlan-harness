import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as JiraPlugin from '../src/index.ts'
import { JiraWorkItemsProvider, resolveJiraWorkItemsConfig } from '../src/index.ts'
import WorkItemsRuntime, { WorkItemId, WorkItemsError } from '@deepseek-ai/dsh-work-items'

const calls: { url: string; init?: RequestInit }[] = []
function record(url: string, init: RequestInit | undefined): void { calls.push({ url, ...(init === undefined ? {} : { init }) }) }
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0 })
function contextWithResolver(resolve: () => Promise<unknown>): Context {
  const ctx = new Context()
  ctx.provide('credentials', { resolve: vi.fn(resolve) } as never)
  return ctx
}
function context(value?: string): Context {
  return contextWithResolver(async () => value === undefined ? undefined : { value, source: 'fixture' })
}
function credential(): string { return 'ci@example.com:api-token' }
function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
function adf(text: string): Record<string, unknown> {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
function issue(key: string): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: 'Issue ' + key,
      description: adf('body'),
      status: { name: 'In Progress' },
      labels: ['bug'],
      assignee: { displayName: 'Alice Doe' },
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-02T00:00:00Z',
    },
  }
}
const ORIGIN = 'https://jira.fixture.invalid'
function configured(extra: Record<string, unknown> = {}) {
  return resolveJiraWorkItemsConfig({ project: 'ENG', origin: ORIGIN, ...extra })
}
function provider(ctx = context(credential())): JiraWorkItemsProvider {
  return new JiraWorkItemsProvider(ctx, configured({ maxItems: 20 }))
}

describe('JiraWorkItemsProvider', () => {
  it('keeps writes opt-in and maps create/comment/state/assignment to bounded REST mutations', async () => {
    expect(provider().writer).toBeUndefined()
    const p = new JiraWorkItemsProvider(context(credential()), configured({ allowWrites: true }))
    const writer = p.writer!
    expect(writer.scope).not.toContain('api-token')
    expect(writer.scope).toContain('sha256:')
    expect(writer.scope).toContain('jira.fixture.invalid')
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      record(url, init)
      if (url.includes('/transitions') && (init?.method ?? 'GET') === 'GET') {
        return response({ transitions: [{ id: '11', to: { statusCategory: { key: 'done' } } }, { id: '12', to: { statusCategory: { key: 'new' } } }] })
      }
      if (url.endsWith('/issue') && init?.method === 'POST') return response({ id: '10001', key: 'ENG-9' })
      return response({})
    }))
    await writer.validate({ kind: 'comment', id: WorkItemId('jira:ENG-7'), body: 'Review' })
    expect(calls).toHaveLength(0)
    await writer.execute({ kind: 'create', source: 'jira', title: 'New issue', body: 'Details' })
    await writer.execute({ kind: 'comment', id: WorkItemId('jira:ENG-7'), body: 'Review' })
    await writer.execute({ kind: 'state', id: WorkItemId('jira:ENG-7'), state: 'closed' })
    await writer.execute({ kind: 'assign', id: WorkItemId('jira:ENG-7'), assignees: [] })
    expect(calls.map(call => call.init?.method)).toEqual(['POST', 'POST', 'GET', 'POST', 'PUT'])
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({
      fields: {
        project: { key: 'ENG' }, summary: 'New issue', issuetype: { name: 'Task' },
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details' }] }] },
      },
    })
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ body: adf('Review') })
    expect(calls[2]!.url).toBe(ORIGIN + '/rest/api/3/issue/ENG-7/transitions')
    expect(JSON.parse(calls[3]!.init!.body as string)).toEqual({ transition: { id: '11' } })
    expect(calls[4]!.url).toBe(ORIGIN + '/rest/api/3/issue/ENG-7/assignee')
    expect(JSON.parse(calls[4]!.init!.body as string)).toEqual({ accountId: null })
    await expect(writer.execute({ kind: 'state', id: WorkItemId('jira:OPS-7'), state: 'closed' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(writer.execute({ kind: 'create', source: 'github', title: 'x', body: 'y' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(writer.validate({ kind: 'state', id: WorkItemId('jira:ENG-7'), state: 'review' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(writer.validate({ kind: 'assign', id: WorkItemId('jira:ENG-7'), assignees: ['a', 'b'] })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(calls).toHaveLength(5)
  })

  it('resolves the open transition to a non-done status category', async () => {
    const p = new JiraWorkItemsProvider(context(credential()), configured({ allowWrites: true }))
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      record(url, init)
      if ((init?.method ?? 'GET') === 'GET') {
        return response({ transitions: [
          { id: '20', to: { statusCategory: { key: 'done' } } },
          { id: '21', to: { statusCategory: { key: 'indeterminate' } } },
        ] })
      }
      return response({})
    }))
    try {
      await p.writer!.execute({ kind: 'state', id: WorkItemId('jira:ENG-7'), state: 'open' })
      expect(JSON.parse(calls.at(-1)!.init!.body as string)).toEqual({ transition: { id: '21' } })
    } finally { p.dispose() }
  })

  it('rejects a state write when the workflow has no matching transition', async () => {
    const p = new JiraWorkItemsProvider(context(credential()), configured({ allowWrites: true }))
    vi.stubGlobal('fetch', vi.fn(async () => response({ transitions: [{ id: '30', to: { statusCategory: { key: 'new' } } }] })))
    try {
      await expect(p.writer!.execute({ kind: 'state', id: WorkItemId('jira:ENG-7'), state: 'closed' })).rejects.toMatchObject({ code: 'write-rejected' })
      expect(calls.every(call => (call.init?.method ?? 'GET') === 'GET')).toBe(true)
    } finally { p.dispose() }
  })

  it('resolves one Jira display name or email to exactly one atlassian account id', async () => {
    const p = new JiraWorkItemsProvider(context(credential()), configured({ allowWrites: true }))
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      record(url.href, init)
      if (url.pathname === '/rest/api/3/user/search') {
        expect(url.searchParams.get('query')).toBe('Alice Doe')
        return response([
          { accountId: 'acc-1', accountType: 'atlassian', displayName: 'Alice Doe' },
          { accountId: 'acc-2', accountType: 'app', displayName: 'Alice Doe' },
        ])
      }
      return response({})
    }))
    try {
      await p.writer!.execute({ kind: 'assign', id: WorkItemId('jira:ENG-7'), assignees: ['Alice Doe'] })
      expect(calls.map(call => call.init?.method)).toEqual(['GET', 'PUT'])
      expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ accountId: 'acc-1' })
      const authorization = (calls[0]!.init!.headers as Record<string, string>).authorization
      expect(authorization).toBe('Basic ' + btoa('ci@example.com:api-token'))
    } finally { p.dispose() }
  })

  it.each([
    ['missing', [], 'write-rejected'],
    ['ambiguous', [
      { accountId: 'a', accountType: 'atlassian', displayName: 'Alice' },
      { accountId: 'b', accountType: 'atlassian', displayName: 'Alice' },
    ], 'write-rejected'],
    ['missing accountId', [{ accountType: 'atlassian', displayName: 'Alice' }], 'invalid-response'],
  ])('rejects a %s assignee lookup without changing the issue', async (_name, users, code) => {
    const p = new JiraWorkItemsProvider(context(credential()), configured({ allowWrites: true }))
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response(users)
    }))
    const mutation = { kind: 'assign' as const, id: WorkItemId('jira:ENG-7'), assignees: ['Alice'] }
    try {
      await expect(p.writer!.validate(mutation)).rejects.toMatchObject({ code })
      await expect(p.writer!.execute(mutation)).rejects.toMatchObject({ code })
      expect(calls.map(call => call.init?.method)).toEqual(['GET', 'GET'])
    } finally { p.dispose() }
  })

  it('maps issues through JQL search with Basic auth and token cursor pagination', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response({ issues: [issue('ENG-7')], isLast: false, nextPageToken: 'token-2' })
    }))
    const result = await provider().list({ source: 'jira', state: 'all', limit: 2 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'jira:ENG-7', source: 'jira', externalId: 'ENG-7', key: 'ENG-7',
      state: 'In Progress', url: ORIGIN + '/browse/ENG-7', repository: 'ENG',
      labels: ['bug'], assignees: ['Alice Doe'],
    })
    expect(result.nextCursor).toBe('token-2')
    expect(calls[0]?.url).toBe(ORIGIN + '/rest/api/3/search/jql')
    const body = JSON.parse(calls[0]!.init!.body as string) as Record<string, unknown>
    expect(body.jql).toBe('project = ENG ORDER BY updated DESC')
    expect(body.maxResults).toBe(2)
    expect(body.nextPageToken).toBeUndefined()
    expect(calls[0]?.init).toMatchObject({ redirect: 'error', method: 'POST', headers: { authorization: 'Basic ' + btoa('ci@example.com:api-token') } })
  })

  it('builds the state JQL, forwards cursors, and filters query matches client-side', async () => {
    const seen: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      seen.push(JSON.parse(init!.body as string) as Record<string, unknown>)
      const other = { ...issue('ENG-3'), fields: { ...(issue('ENG-3').fields as Record<string, unknown>), summary: 'Other', description: null, assignee: null } }
      return response({ issues: [issue('ENG-2'), other], isLast: true })
    }))
    const open = await provider().list({ source: 'jira', query: 'issue eng-2' })
    expect(seen.at(-1)?.jql).toBe('project = ENG AND statusCategory != done ORDER BY updated DESC')
    expect(open.items).toHaveLength(1)
    expect(open.items[0]?.id).toBe('jira:ENG-2')
    await provider().list({ source: 'jira', state: 'closed', cursor: 'token-2' })
    expect(seen.at(-1)?.jql).toBe('project = ENG AND statusCategory = done ORDER BY updated DESC')
    expect(seen.at(-1)?.nextPageToken).toBe('token-2')
    const sparse = await provider().list({ source: 'jira' })
    expect(sparse.items[1]).not.toHaveProperty('body')
    expect(sparse.items[1]?.assignees).toEqual([])
  })

  it('appends the configured JQL clause and sends Bearer auth for Data Center PATs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response({ issues: [], isLast: true })
    }))
    const p = new JiraWorkItemsProvider(context('pat-token'), configured({ authScheme: 'bearer', jql: 'priority = High' }))
    await p.list({ source: 'jira' })
    const body = JSON.parse(calls[0]!.init!.body as string) as Record<string, unknown>
    expect(body.jql).toBe('project = ENG AND statusCategory != done AND (priority = High) ORDER BY updated DESC')
    expect(calls[0]?.init).toMatchObject({ headers: { authorization: 'Bearer pat-token' } })
  })

  it('fails closed when credentials are absent or malformed and never performs fetch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(provider(context()).list({ source: 'jira' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(context('no-colon')).list({ source: 'jira' })).rejects.toMatchObject({ code: 'authentication-required' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps HTTP failures, malformed responses, and cancellation safely', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(provider().list({ source: 'jira' })).rejects.toMatchObject({ code: 'authentication-required' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    await expect(provider().list({ source: 'jira' })).rejects.toMatchObject({ code: 'forbidden' })
    for (const [status, code] of [[404, 'not-found'], [429, 'rate-limited'], [500, 'provider-failed']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
      await expect(provider().list({ source: 'jira' })).rejects.toMatchObject({ code })
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))
    await expect(provider().list({ source: 'jira' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ issues: 'not-a-list' })))
    await expect(provider().list({ source: 'jira' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ issues: Array.from({ length: 21 }, (_, index) => issue('ENG-' + String(index + 1))) })))
    await expect(provider().list({ source: 'jira' })).rejects.toMatchObject({ code: 'invalid-response' })
    const controller = new AbortController(); controller.abort()
    await expect(provider().list({ source: 'jira' }, controller.signal)).rejects.toMatchObject({ code: 'aborted' })
  })

  it('validates deployment config, availability, scopes, and list bounds', async () => {
    expect(new JiraWorkItemsProvider(context(credential()), resolveJiraWorkItemsConfig()).available()).toBe(false)
    expect(new JiraWorkItemsProvider(context(credential()), resolveJiraWorkItemsConfig({ origin: ORIGIN })).available()).toBe(false)
    expect(configured({ credentialRef: 'TOKEN', timeoutMs: 1, maxItems: 1 })).toMatchObject({ project: 'ENG', timeoutMs: 1, maxItems: 1 })
    for (const config of [
      { project: '' },
      { project: 'lower' },
      { project: ' untrimmed' },
      { project: 'X'.repeat(257) },
      { origin: '' },
      { origin: 'http://insecure.example.com' },
      { origin: 'https://u:p@example.com' },
      { timeoutMs: Number.NaN },
      { timeoutMs: 0 },
      { timeoutMs: 120_001 },
      { maxItems: Number.NaN },
      { maxItems: 0 },
      { maxItems: 101 },
      { jql: '' },
      { jql: ' untrimmed' },
      { jql: 'x'.repeat(501) },
    ]) expect(() => resolveJiraWorkItemsConfig(config)).toThrow()

    const p = provider()
    const invalidRequests = [
      { source: 'gitlab' },
      { source: 'jira', scope: { source: 'gitlab', owner: 'acme', repository: 'repo' } },
      { source: 'jira', scope: { source: 'jira', project: 'OPS' } },
      { source: 'jira', query: 'x'.repeat(501) },
      { source: 'jira', cursor: 'x'.repeat(501) },
      { source: 'jira', limit: 0 },
      { source: 'jira', limit: 21 },
      { source: 'jira', limit: Number.NaN },
    ]
    for (const request of invalidRequests) {
      await expect(p.list(request as never)).rejects.toMatchObject({ code: 'invalid-request' })
    }
  })

  it('maps bounded comment history to plain text and keeps issues without comments clean', async () => {
    const commented = {
      ...issue('ENG-9'),
      fields: {
        ...(issue('ENG-9').fields as Record<string, unknown>),
        comment: {
          comments: [
            { author: { displayName: 'Bob' }, body: adf('first note'), created: '2026-01-03T00:00:00Z' },
            { body: adf('anonymous follow-up'), created: '2026-01-04T00:00:00Z', updated: '2026-01-05T00:00:00Z' },
          ],
        },
        attachment: [
          { filename: 'trace.log', content: 'https://jira.example.com/rest/api/3/attachment/content/101', size: 4096, mimeType: 'text/plain', created: '2026-01-06T00:00:00Z' },
          { filename: 'shot.png', content: 'https://jira.example.com/rest/api/3/attachment/content/102' },
        ],
        priority: { name: 'High' },
        duedate: '2026-02-15',
        timeoriginalestimate: 7200,
      },
    }
    vi.stubGlobal('fetch', vi.fn(async () => response(commented)))
    const item = await provider().get({ id: 'jira:ENG-9' as never })
    expect(item.comments).toHaveLength(2)
    expect(item.comments?.[0]).toMatchObject({ author: 'Bob', body: 'first note', createdAt: '2026-01-03T00:00:00Z' })
    expect(item.comments?.[1]).toMatchObject({ body: 'anonymous follow-up', updatedAt: '2026-01-05T00:00:00Z' })
    expect(item.comments?.[1]).not.toHaveProperty('author')
    expect(item.attachments).toHaveLength(2)
    expect(item.attachments?.[0]).toMatchObject({ name: 'trace.log', url: 'https://jira.example.com/rest/api/3/attachment/content/101', size: 4096, mimeType: 'text/plain', createdAt: '2026-01-06T00:00:00Z' })
    expect(item.attachments?.[1]).toMatchObject({ name: 'shot.png' })
    expect(item.attachments?.[1]).not.toHaveProperty('size')
    expect(item.priority).toBe('High')
    expect(item.dueAt).toBe('2026-02-15')
    expect(item.estimate).toEqual({ seconds: 7200 })
    vi.stubGlobal('fetch', vi.fn(async () => response(issue('ENG-9'))))
    const plain = await provider().get({ id: 'jira:ENG-9' as never })
    expect(plain).not.toHaveProperty('comments')
    expect(plain).not.toHaveProperty('attachments')
    expect(plain).not.toHaveProperty('priority')
    expect(plain).not.toHaveProperty('dueAt')
    expect(plain).not.toHaveProperty('estimate')
  })

  it('maps agile boards with status-mapped columns and bounded item ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/rest/agile/1.0/board?')) return response({ values: [{ id: 3, name: 'Delivery' }] })
      if (url.includes('/rest/agile/1.0/board/3/configuration')) {
        return response({ columnConfig: { columns: [
          { name: 'Backlog', statuses: [{ id: '10000' }] },
          { name: 'Doing', statuses: [{ id: '10001' }, { id: '10002' }] },
          { name: 'Done', statuses: [{ id: '10003' }] },
        ] } })
      }
      return response({ issues: [
        { key: 'ENG-7', fields: { status: { id: '10001' } } },
        { key: 'ENG-8', fields: { status: { id: '10000' } } },
        { key: 'ENG-9', fields: { status: { id: '10001' } } },
        { key: 'ENG-10', fields: { status: { id: '19999' } } },
      ] })
    }))
    const boards = await provider().boards({ source: 'jira' })
    expect(boards).toEqual([{
      id: '3', title: 'Delivery', url: ORIGIN + '/secure/RapidBoard.jspa?rapidView=3',
      columns: [
        { title: 'Backlog', itemIds: ['jira:ENG-8'] },
        { title: 'Doing', itemIds: ['jira:ENG-7', 'jira:ENG-9'] },
        { title: 'Done', itemIds: [] },
      ],
    }])
    expect(calls[0]?.url).toContain('/rest/agile/1.0/board?projectKeyOrId=ENG&maxResults=5')
    expect(calls[1]?.url).toContain('/rest/agile/1.0/board/3/configuration')
    expect(calls[2]?.url).toContain('/rest/agile/1.0/board/3/issue?maxResults=500&fields=status')

    const selected = await provider().boards({ board: '3', limit: 1 })
    expect(selected[0]?.columns[1]?.itemIds).toEqual(['jira:ENG-7'])
    await expect(provider().boards({ source: 'github' as never })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(provider().boards({ board: ' ' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(provider().boards({ limit: 0 })).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('maps get responses and rejects ids outside the configured project', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response(issue('ENG-7'))
    }))
    await expect(provider().get({ id: WorkItemId('jira:ENG-7') })).resolves.toMatchObject({ id: 'jira:ENG-7' })
    expect(calls[0]?.url).toBe(ORIGIN + '/rest/api/3/issue/ENG-7?fields=summary,description,status,labels,assignee,priority,duedate,timeoriginalestimate,created,updated,comment,attachment')
    await expect(provider().get({ id: WorkItemId('jira:OPS-7') })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(provider().get({ id: WorkItemId('invalid') })).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('classifies credential failures and provider timeouts', async () => {
    const noCredentials = new JiraWorkItemsProvider(new Context(), configured())
    await expect(noCredentials.list({ source: 'jira' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => ({ value: '', source: 'fixture' }))).list({ source: 'jira' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new Error('resolver failed') })).list({ source: 'jira' })).rejects.toMatchObject({ code: 'authentication-required' })
    await expect(provider(contextWithResolver(async () => { throw new WorkItemsError('forbidden', 'safe') })).list({ source: 'jira' })).rejects.toMatchObject({ code: 'forbidden' })

    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true })
    })))
    const timed = new JiraWorkItemsProvider(context(credential()), configured({ timeoutMs: 1 }))
    await expect(timed.list({ source: 'jira' })).rejects.toMatchObject({ code: 'provider-failed', message: expect.stringContaining('timed out') as unknown })
  })

  it('aborts an in-flight request when disposed', async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true }))
    }))
    const p = provider()
    const pending = p.list({ source: 'jira' })
    await vi.waitFor(() => { expect(requestSignal).toBeDefined() })
    p.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('removes its provider registration when the plugin fiber unloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ issues: [issue('ENG-1')], isLast: true })))
    const ctx = context(credential())
    await ctx.plugin(WorkItemsRuntime)
    const fiber = ctx.plugin(JiraPlugin, { project: 'ENG', origin: ORIGIN })
    await fiber.await()
    await expect(ctx.workItems.list({ source: 'jira' })).resolves.toMatchObject({ items: [{ source: 'jira' }] })
    await fiber.dispose()
    await expect(ctx.workItems.list({ source: 'jira' })).rejects.toMatchObject({ code: 'configured-missing' })
    await ctx.fiber.dispose()
  })

  it('validates item identity, bounds, and disposal', async () => {
    expect(() => resolveJiraWorkItemsConfig({ maxItems: 101 })).toThrow(/no greater than/)
    expect(() => resolveJiraWorkItemsConfig({ bad: true } as never)).toThrow(/unsupported config key/)
    const p = provider()
    await expect(p.get({ id: WorkItemId('jira:OPS-1') })).rejects.toMatchObject({ code: 'invalid-request' })
    p.dispose()
    await expect(p.list({ source: 'jira' })).rejects.toMatchObject({ code: 'unavailable' })
    await expect(p.get({ id: WorkItemId('jira:ENG-1') })).rejects.toMatchObject({ code: 'unavailable' })
    p.dispose()
  })
})
