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
  return { id, identifier: 'DSH-1', title: 'Linear issue', description: 'details', url, state: { name: 'Started', type: 'started' }, labels: { nodes: [{ name: 'feature' }] }, assignee: { name: 'bob' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', team: { name: 'Engineering' } }
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
    calls.length = 0
    const projectWriter = new LinearWorkItemsProvider(context('fixture-token'), resolveLinearWorkItemsConfig({ team: 'team-1', project: 'project-1', allowWrites: true })).writer!
    const mode = { update: 'success' as 'success' | 'fail' | 'mismatch' }
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      const request = JSON.parse(init?.body as string) as { query: string }
      if (request.query.includes('workflowState')) return response({ data: { workflowState: { id: 'state-1', team: { id: 'team-1' } } } })
      if (request.query.startsWith('query')) return response({ data: { issue: { id: 'issue-1', url: 'https://linear.app/acme/issue/ONE-1', team: { id: 'team-1' }, project: null } } })
      if (request.query.includes('issueCreate')) return response({ data: { issueCreate: { success: false } } })
      if (request.query.includes('commentCreate')) return response({ data: { commentCreate: { success: false } } })
      if (mode.update === 'mismatch') return response({ data: { issueUpdate: { success: true, issue: { id: 'issue-9' } } } })
      return response({ data: { issueUpdate: { success: mode.update === 'success' } } })
    }))
    await expect(writer.execute({ kind: 'create', source: 'linear', title: 'Title', body: 'Body' })).rejects.toMatchObject({ code: 'write-rejected' })
    await expect(writer.execute({ kind: 'comment', id: WorkItemId('linear:issue-1'), body: 'Review' })).rejects.toMatchObject({ code: 'write-rejected' })
    mode.update = 'fail'
    await expect(writer.execute({ kind: 'state', id: WorkItemId('linear:issue-1'), state: 'state-1' })).rejects.toMatchObject({ code: 'write-rejected' })
    mode.update = 'mismatch'
    await expect(writer.execute({ kind: 'assign', id: WorkItemId('linear:issue-1'), assignees: ['00000000-0000-0000-0000-000000000001'] })).rejects.toMatchObject({ code: 'invalid-response' })
    calls.length = 0
    await expect(projectWriter.execute({ kind: 'create', source: 'linear', title: 'T', body: 'B' })).rejects.toMatchObject({ code: 'write-rejected' })
    const projectCreate = calls.map(call => JSON.parse(call.init?.body as string) as { query: string; variables: { input?: Record<string, unknown> } }).find(call => call.query.includes('issueCreate'))
    expect(projectCreate?.variables.input).toMatchObject({ projectId: 'project-1' })
    await expect(writer.execute({ kind: 'create', source: 'github', title: 'T', body: 'B' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(new LinearWorkItemsProvider(context('fixture-token'), resolveLinearWorkItemsConfig({ project: 'project-1', allowWrites: true })).writer!.execute({ kind: 'create', source: 'linear', title: 'T', body: 'B' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(writer.execute({ kind: 'assign', id: WorkItemId('linear:issue-1'), assignees: ['not-a-uuid'] })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(writer.execute({ kind: 'assign', id: WorkItemId('linear:issue-1'), assignees: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'] })).rejects.toMatchObject({ code: 'invalid-request' })
    const projectScoped = new LinearWorkItemsProvider(context('fixture-token'), resolveLinearWorkItemsConfig({ project: 'project-1', allowWrites: true })).writer!
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { id: 'issue-1', url: 'https://linear.app/acme/issue/ONE-1', team: { id: 'team-1' }, project: { id: 'other-project' } }, workflowState: { id: 'state-1', team: { id: 'other' } } } })))
    await expect(projectScoped.execute({ kind: 'comment', id: WorkItemId('linear:issue-1'), body: 'B' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(writer.execute({ kind: 'state', id: WorkItemId('linear:issue-1'), state: 'state-1' })).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('maps GraphQL issue nodes and sends a fixed credentialed request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { record(input instanceof Request ? input.url : String(input), init); return new Response(JSON.stringify({ data: { issues: { nodes: [linearIssue()], pageInfo: { hasNextPage: true, endCursor: 'cursor-2' } } } }), { status: 200 }) }))
    const result = await provider().list({ source: 'linear', limit: 2 })
    expect(result).toMatchObject({ items: [{ id: 'linear:issue-1', key: 'DSH-1', assignees: ['bob'], repository: 'Engineering' }], nextCursor: 'cursor-2' })
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
    const commentedIssue = {
      ...linearIssue('issue-get'),
      comments: {
        nodes: [
          { user: { name: 'Frank' }, body: 'first note', createdAt: '2026-01-03T00:00:00Z' },
          { user: null, body: 'second note', createdAt: '2026-01-04T00:00:00Z', updatedAt: '2026-01-05T00:00:00Z' },
        ],
      },
      attachments: {
        nodes: [
          { title: 'spec.pdf', url: 'https://files.example.com/spec.pdf', createdAt: '2026-01-06T00:00:00Z' },
        ],
      },
      cycle: { name: 'Sprint 14', number: 14, startsAt: '2026-01-10T00:00:00Z', endsAt: '2026-01-24T00:00:00Z', isActive: true, isPast: false },
      priority: 1,
      dueDate: '2026-02-15',
      estimate: 5,
      project: { name: 'Checkout' },
      parent: { id: 'issue-parent' },
      relations: { nodes: [
        { type: 'blocks', relatedIssue: { id: 'issue-blocked' } },
        { type: 'related', relatedIssue: { id: 'issue-related' } },
        { type: 'duplicate', relatedIssue: null },
        { type: null, relatedIssue: { id: 'issue-x' } },
      ] },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      return response({ data: { issue: commentedIssue } })
    }))
    const detail = await provider().get({ id: WorkItemId('linear:issue-get') })
    expect(detail).toMatchObject({ id: 'linear:issue-get' })
    expect(detail.comments).toHaveLength(2)
    expect(detail.comments?.[0]).toMatchObject({ author: 'Frank', body: 'first note', createdAt: '2026-01-03T00:00:00Z' })
    expect(detail.comments?.[1]).toMatchObject({ body: 'second note', updatedAt: '2026-01-05T00:00:00Z' })
    expect(detail.comments?.[1]).not.toHaveProperty('author')
    expect(detail.attachments).toHaveLength(1)
    expect(detail.attachments?.[0]).toMatchObject({ name: 'spec.pdf', url: 'https://files.example.com/spec.pdf', createdAt: '2026-01-06T00:00:00Z' })
    expect(detail.iteration).toMatchObject({ title: 'Sprint 14', state: 'active', startsAt: '2026-01-10T00:00:00Z', endsAt: '2026-01-24T00:00:00Z' })
    expect(detail.priority).toBe('urgent')
    expect(detail.dueAt).toBe('2026-02-15')
    expect(detail.repository).toBe('Checkout')
    expect(detail.estimate).toEqual({ points: 5 })
    expect(detail.parentId).toBe('linear:issue-parent')
    expect(detail.links).toEqual([
      { type: 'blocks', itemId: 'linear:issue-blocked' },
      { type: 'related', itemId: 'linear:issue-related' },
    ])
    expect(JSON.parse(requestBody())).toMatchObject({ query: expect.stringContaining('comments(last: 20)') as unknown, variables: { id: 'issue-get' } })
    expect(JSON.parse(requestBody())).toMatchObject({ query: expect.stringContaining('attachments(last: 20)') as unknown })
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

  it('maps team workflow states into board columns and honors the board selector', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init)
      const request = JSON.parse(init?.body as string) as {
        query: string
        variables: { filter?: { team?: unknown; project?: unknown; state?: { name?: { eq?: string }; type?: { eq?: string } } } }
      }
      if (request.query.includes('team(id:')) {
        return response({ data: { team: { name: 'Engineering', states: { nodes: [{ name: 'Done', position: 4 }, { name: 'Backlog', position: 0 }, { name: 'In Progress', position: 2 }] } } } })
      }
      if (request.query.includes('project(id:')) {
        return response({ data: { project: { name: 'Roadmap' } } })
      }
      if (request.query.includes('issues(')) {
        const nodes = request.variables.filter?.team !== undefined
          ? [
            { id: 'issue-b1', state: { name: 'Backlog', type: 'backlog' } },
            { id: 'issue-b2', state: { name: 'Backlog', type: 'backlog' } },
            { id: 'issue-p1', state: { name: 'In Progress', type: 'started' } },
          ]
          : [{ id: 'issue-s1', state: { name: 'Doing', type: 'started' } }]
        return response({ data: { issues: { nodes } } })
      }
      throw new Error('unexpected query')
    }))
    const boards = await provider().boards({ source: 'linear' })
    expect(boards).toHaveLength(1)
    expect(boards[0]?.id).toBe('team-1')
    expect(boards[0]?.title).toBe('Engineering')
    expect(boards[0]?.columns.map(column => column.title)).toEqual(['Backlog', 'In Progress', 'Done'])
    expect(boards[0]?.columns[0]?.itemIds).toEqual(['linear:issue-b1', 'linear:issue-b2'])
    expect(boards[0]?.columns[1]?.itemIds).toEqual(['linear:issue-p1'])
    expect(boards[0]?.columns[2]?.itemIds).toEqual([])
    expect(calls).toHaveLength(2)
    calls.length = 0
    await expect(provider().boards({ board: 'Engineering' })).resolves.toHaveLength(1)
    await expect(provider().boards({ board: 'other' })).resolves.toEqual([])
    await expect(provider().boards({ board: ' ' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(provider().boards({ source: 'gitlab' })).rejects.toMatchObject({ code: 'invalid-request' })
    calls.length = 0
    const projectOnly = new LinearWorkItemsProvider(context('secret'), resolveLinearWorkItemsConfig({ project: 'project-1' }))
    const projectBoards = await projectOnly.boards({})
    expect(projectBoards).toHaveLength(1)
    expect(projectBoards[0]?.id).toBe('project-1')
    expect(projectBoards[0]?.title).toBe('Roadmap')
    expect(projectBoards[0]?.columns.map(column => column.title)).toEqual(['Backlog', 'Unstarted', 'Started', 'Completed', 'Canceled'])
    expect(projectBoards[0]?.columns[2]?.itemIds).toEqual(['linear:issue-s1'])
    expect(calls).toHaveLength(2)
    await expect(provider().boards({ board: 'Roadmap' })).resolves.toEqual([])
    await expect(provider().boards({ board: 'Engineering' })).resolves.toHaveLength(1)
    await expect(projectOnly.boards({ board: 'project-1' })).resolves.toHaveLength(1)
    await expect(projectOnly.boards({ board: 'Roadmap' })).resolves.toHaveLength(1)
    projectOnly.dispose()
  })

  it('rejects malformed board rows and caps buckets at the request limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { query: string }
      if (request.query.includes('team(id:')) {
        return response({ data: { team: { name: 'Engineering', states: { nodes: [{ name: 'Backlog', position: 0 }, { name: 'Doing', position: 1 }, { name: 'Done', position: 2 }] } } } })
      }
      return response({ data: { issues: { nodes: 'bad' } } })
    }))
    await expect(provider().boards({})).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { query: string }
      if (request.query.includes('team(id:')) {
        return response({ data: { team: { name: 'Engineering', states: { nodes: [{ name: 'Backlog', position: 0 }, { name: 'Doing', position: 1 }, { name: 'Done', position: 2 }] } } } })
      }
      return response({ data: { issues: { nodes: [
        { id: 'issue-a', state: { name: 'Backlog', type: 'backlog' } },
        { id: 'issue-b', state: { name: 'Backlog', type: 'backlog' } },
        { id: 'issue-c', state: { name: 'Backlog', type: 'backlog' } },
      ] } } })
    }))
    const capped = await provider().boards({ limit: 1 })
    expect(capped[0]?.columns[0]?.itemIds).toEqual(['linear:issue-a'])
  })

  it('classifies GraphQL error codes, body read failures, and malformed boards', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ errors: [{ message: 'bad input', extensions: { code: 'BAD_USER_INPUT' } }] })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'write-rejected' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken json', { status: 200 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start: (controller) => { controller.enqueue(new TextEncoder().encode('{')); controller.error(new Error('stream died')) } }), { status: 200 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'provider-failed' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { team: { name: 'Engineering', states: { nodes: 'bad' } } } })))
    await expect(provider().boards({})).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { query: string }
      if (request.query.includes('team(id:')) {
        return response({ data: { team: { name: 'Engineering', states: { nodes: [{ name: 'NoPos' }, { name: 'First', position: -1 }] } } } })
      }
      return response({ data: { issues: { nodes: [] } } })
    }))
    const board = await provider().boards({})
    expect(board[0]?.columns.map(column => column.title)).toEqual(['First', 'NoPos'])
    const projectOnly = new LinearWorkItemsProvider(context('secret'), resolveLinearWorkItemsConfig({ project: 'project-1' }))
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { project: null } })))
    await expect(projectOnly.boards({})).rejects.toMatchObject({ code: 'not-found' })
    await expect(projectOnly.boards({ board: 'zzz' })).rejects.toMatchObject({ code: 'not-found' })
    projectOnly.dispose()
  })

  it('rejects foreign ids and missing issues on scoped mutations', async () => {
    const writer = new LinearWorkItemsProvider(context('fixture-token'), resolveLinearWorkItemsConfig({ team: 'team-1', allowWrites: true })).writer!
    await expect(writer.execute({ kind: 'comment', id: WorkItemId('github:acme/repo#1'), body: 'B' })).rejects.toMatchObject({ code: 'invalid-request' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: null } })))
    await expect(writer.execute({ kind: 'comment', id: WorkItemId('linear:missing'), body: 'B' })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('reports a missing team as not-found on the board read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { team: null } })))
    await expect(provider().boards({})).rejects.toMatchObject({ code: 'not-found' })
  })

  it('covers writer validation, attachment bounds, and the team-name selector', async () => {
    const writer = new LinearWorkItemsProvider(context('fixture-token'), resolveLinearWorkItemsConfig({ team: 'team-1', allowWrites: true })).writer!
    await expect(writer.validate({ kind: 'comment', id: WorkItemId('github:acme/repo#1'), body: 'B' })).rejects.toMatchObject({ code: 'invalid-request' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), attachments: { nodes: 'bad' } } } })))
    await expect(provider().get({ id: WorkItemId('linear:issue-1') })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), attachments: { nodes: [{ url: 'https://x.test/a' }] } } } })))
    const got = await provider().get({ id: WorkItemId('linear:issue-1') })
    expect(got.attachments).toEqual([{ url: 'https://x.test/a' }])
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), comments: { nodes: 'bad' } } } })))
    await expect(provider().get({ id: WorkItemId('linear:issue-1') })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), comments: { nodes: [{}] } } } })))
    const sparse = await provider().get({ id: WorkItemId('linear:issue-1') })
    expect(sparse.comments).toEqual([{ body: '' }])
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), comments: { nodes: [{ user: {}, body: 'hi' }] }, cycle: { isActive: false, isPast: true, startsAt: '2026-01-01T00:00:00Z' } } } })))
    const cycled = await provider().get({ id: WorkItemId('linear:issue-1') })
    expect(cycled.comments).toEqual([{ author: '', body: 'hi' }])
    expect(cycled.iteration).toEqual({ title: 'Cycle ', state: 'completed', startsAt: '2026-01-01T00:00:00Z' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), cycle: { number: 7, name: 'Sprint 7', isActive: true } } } })))
    const active = await provider().get({ id: WorkItemId('linear:issue-1') })
    expect(active.iteration).toEqual({ title: 'Sprint 7', state: 'active' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), cycle: { number: 7 } } } })))
    const numbered = await provider().get({ id: WorkItemId('linear:issue-1') })
    expect(numbered.iteration).toEqual({ title: 'Cycle 7', state: 'upcoming' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), parent: { id: '' }, priority: 0, team: null } } })))
    const barren = await provider().get({ id: WorkItemId('linear:issue-1') })
    expect(barren).not.toHaveProperty('parentId')
    expect(barren).not.toHaveProperty('priority')
    expect(barren).not.toHaveProperty('repository')
    for (const [priority, label] of [[2, 'high'], [3, 'medium'], [4, 'low']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), priority } } })))
      const prioritized = await provider().get({ id: WorkItemId('linear:issue-1') })
      expect(prioritized.priority).toBe(label)
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 400 })))
    await expect(provider().list({ source: 'linear' })).rejects.toMatchObject({ code: 'write-rejected' })
    const namedProject = new LinearWorkItemsProvider(context('secret'), resolveLinearWorkItemsConfig({ project: 'project-1' }))
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { project: { name: 'Roadmap' } } })))
    await expect(namedProject.boards({ board: 'zzz' })).resolves.toEqual([])
    namedProject.dispose()
    expect(() => resolveLinearWorkItemsConfig({ allowWrites: 'yes' } as never)).toThrow(/allowWrites must be boolean/)
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), relations: { nodes: 'bad' } } } })))
    await expect(provider().get({ id: WorkItemId('linear:issue-1') })).rejects.toMatchObject({ code: 'invalid-response' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { issue: { ...linearIssue(), project: {} } } })))
    const scoped = await provider().get({ id: WorkItemId('linear:issue-1') })
    expect(scoped.repository).toBe('Engineering')
    vi.stubGlobal('fetch', vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const request = JSON.parse(init?.body as string) as { query: string }
      if (request.query.includes('team(id:')) {
        return response({ data: { team: { name: 'Engineering', states: { nodes: [{ name: 'Todo', position: 0 }] } } } })
      }
      return response({ data: { issues: { nodes: [] } } })
    }))
    await expect(provider().boards({ board: 'Engineering' })).resolves.toHaveLength(1)
  })
})
