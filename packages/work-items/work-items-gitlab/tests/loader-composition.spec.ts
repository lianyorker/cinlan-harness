import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import WorkItemsRuntime, { WorkItemId } from '@deepseek-ai/dsh-work-items'
import WorkItemsController from '@deepseek-ai/dsh-api-work-items-controller'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, expect, it, vi } from 'vitest'
import * as GitLab from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function boot(root: string): Promise<Context> {
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { name: 'fixture-credentials' },
    { name: '@deepseek-ai/dsh-storage' },
    { name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'domains') } },
    { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    { name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: '@deepseek-ai/dsh-workspace' },
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-work-items', config: { provider: 'gitlab' } },
    { name: '@deepseek-ai/dsh-work-items-gitlab', config: { owner: 'acme', repository: 'repo', origin: 'https://gitlab.fixture.invalid', allowWrites: true } },
    { name: '@deepseek-ai/dsh-api-work-items-controller' },
  ], null, 2) + '\n')
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['fixture-credentials', { apply(owner: Context) {
      owner.provide('credentials', { resolve: async () => ({ value: 'fixture-token', source: 'fixture' }) } as never)
    } }],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session-persistence-jsonl', SessionPersistenceJsonl],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-work-items', WorkItemsRuntime],
    ['@deepseek-ai/dsh-work-items-gitlab', GitLab],
    ['@deepseek-ai/dsh-api-work-items-controller', WorkItemsController],
  ])
  ctx.loader.internal = {
    version: 'v2',
    get loadCache(): never { throw new Error('Fixture imports do not expose the native module cache') },
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected fixture import: ' + specifier)
      return modules.get(specifier)
    },
    register() { throw new Error('Fixture imports do not register native loader hooks') },
    getOrCreateModuleJob() { return Promise.reject(new Error('Fixture imports do not create native module jobs')) },
    resolveSync() { throw new Error('Fixture imports do not resolve native module jobs') },
    load() { return Promise.reject(new Error('Fixture imports do not load native module sources')) },
  } satisfies ModuleLoaderV2
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
  expect(unloaded.map(entry => entry.options.name)).toEqual([])
  return ctx
}

it('previews, confirms, and restores exact GitLab assignments through Loader and the Host API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gitlab-approval-'))
  roots.push(root)
  const calls: { url: URL; method: string; body: unknown }[] = []
  let lookup: 'resolved' | 'missing' | 'ambiguous' | 'unavailable' = 'resolved'
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    expect(url.origin).toBe('https://gitlab.fixture.invalid')
    expect(init?.headers).toMatchObject({ 'PRIVATE-TOKEN': 'fixture-token' })
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined })
    if (url.pathname === '/api/v4/users') {
      expect(method).toBe('GET')
      const username = url.searchParams.get('username')
      const user = { id: username === 'alice' ? 41 : 72, username }
      return new Response(JSON.stringify(lookup === 'missing' ? [] : lookup === 'ambiguous' ? [user, user] : [user]), { status: lookup === 'unavailable' ? 503 : 200 })
    }
    expect(url.pathname).toBe('/api/v4/projects/acme%2Frepo/issues/7')
    return new Response(JSON.stringify({
      iid: 7, title: 'Review assignment', description: 'Provider fixture', state: 'opened',
      web_url: 'https://gitlab.fixture.invalid/acme/repo/-/issues/7', labels: [], assignees: [],
      updated_at: '2026-09-01T00:00:00Z',
    }))
  }))
  const ctx = await boot(root)
  const api = ctx.workItemsController
  const signal = new AbortController().signal
  const mutation = { kind: 'assign' as const, id: WorkItemId('gitlab:acme/repo#7'), assignees: ['alice', 'bob'] }
  const prepared = (await api.prepareWrite({ mutation }, signal)).operation
  expect(prepared).toMatchObject({ source: 'gitlab', status: 'prepared', mutation })
  expect(calls.every(call => call.method === 'GET')).toBe(true)
  const confirmed = await api.confirmWrite({ operationId: prepared.operationId }, signal)
  expect(confirmed.operation.status).toBe('succeeded')
  expect(calls.filter(call => call.method === 'PUT').map(call => call.body)).toEqual([{ assignee_ids: [41, 72] }])
  const dispatched = calls.length
  expect(await api.confirmWrite({ operationId: prepared.operationId }, signal)).toEqual(confirmed)
  expect(calls).toHaveLength(dispatched)

  for (const failure of ['missing', 'ambiguous', 'unavailable'] as const) {
    lookup = failure
    await expect(api.prepareWrite({ mutation }, signal)).rejects.toMatchObject({ code: 'work-items/operation-failed' })
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1)
  }
  lookup = 'resolved'
  const unresolvedAtConfirmation = await api.prepareWrite({ mutation }, signal)
  lookup = 'missing'
  expect((await api.confirmWrite({ operationId: unresolvedAtConfirmation.operation.operationId }, signal)).operation).toMatchObject({ status: 'failed', errorCode: 'write-rejected' })
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1)

  const lookupsBeforeClear = calls.filter(call => call.url.pathname === '/api/v4/users').length
  const clear = await api.prepareWrite({ mutation: { ...mutation, assignees: [] } }, signal)
  expect((await api.confirmWrite({ operationId: clear.operation.operationId }, signal)).operation.status).toBe('succeeded')
  expect(calls.filter(call => call.url.pathname === '/api/v4/users')).toHaveLength(lookupsBeforeClear)
  expect(calls.filter(call => call.method === 'PUT').map(call => call.body)).toEqual([{ assignee_ids: [41, 72] }, { assignee_ids: [] }])
  const completedCalls = calls.length
  await ctx.fiber.dispose()
  const restarted = await boot(root)
  const history = await restarted.workItemsController.listWrites({ source: 'gitlab', limit: 20 }, signal)
  expect(history.operations).toEqual(expect.arrayContaining([confirmed.operation]))
  expect(await restarted.workItemsController.confirmWrite({ operationId: prepared.operationId }, signal)).toEqual(confirmed)
  expect(calls).toHaveLength(completedCalls)
})
