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
import * as Jira from '../src/index.ts'

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
    { name: '@deepseek-ai/dsh-work-items', config: { provider: 'jira' } },
    { name: '@deepseek-ai/dsh-work-items-jira', config: { project: 'ENG', origin: 'https://jira.fixture.invalid', allowWrites: true } },
    { name: '@deepseek-ai/dsh-api-work-items-controller' },
  ], null, 2) + '\n')
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['fixture-credentials', { apply(owner: Context) {
      owner.provide('credentials', { resolve: async () => ({ value: 'ci@example.com:api-token', source: 'fixture' }) } as never)
    } }],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session-persistence-jsonl', SessionPersistenceJsonl],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-work-items', WorkItemsRuntime],
    ['@deepseek-ai/dsh-work-items-jira', Jira],
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

it('previews, confirms, and restores exact Jira state transitions through Loader and the Host API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jira-approval-'))
  roots.push(root)
  const calls: { url: URL; method: string; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    expect(url.origin).toBe('https://jira.fixture.invalid')
    expect(init?.headers).toMatchObject({ authorization: 'Basic ' + btoa('ci@example.com:api-token') })
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined })
    if (method === 'GET') {
      expect(['/rest/api/3/issue/ENG-7', '/rest/api/3/issue/ENG-7/transitions']).toContain(url.pathname)
      if (url.pathname.endsWith('/transitions')) {
        return new Response(JSON.stringify({ transitions: [
          { id: '11', to: { statusCategory: { key: 'done' } } },
          { id: '12', to: { statusCategory: { key: 'indeterminate' } } },
        ] }), { status: 200 })
      }
      return new Response(JSON.stringify({
        key: 'ENG-7',
        fields: {
          summary: 'Review deployment', description: null, status: { name: 'In Progress' },
          labels: [], assignee: null, created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z',
        },
      }), { status: 200 })
    }
    expect(url.pathname).toBe('/rest/api/3/issue/ENG-7/transitions')
    return new Response(null, { status: 204 })
  }))
  const ctx = await boot(root)
  const api = ctx.workItemsController
  const signal = new AbortController().signal
  const mutation = { kind: 'state' as const, id: WorkItemId('jira:ENG-7'), state: 'closed' }
  const prepared = (await api.prepareWrite({ mutation }, signal)).operation
  expect(prepared).toMatchObject({ source: 'jira', status: 'prepared', mutation })
  expect(calls.every(call => call.method === 'GET')).toBe(true)
  const confirmed = await api.confirmWrite({ operationId: prepared.operationId }, signal)
  expect(confirmed.operation.status).toBe('succeeded')
  const transitionPosts = calls.filter(call => call.method === 'POST')
  expect(transitionPosts.map(call => call.body)).toEqual([{ transition: { id: '11' } }])
  const dispatched = calls.length
  expect(await api.confirmWrite({ operationId: prepared.operationId }, signal)).toEqual(confirmed)
  expect(calls).toHaveLength(dispatched)

  await ctx.fiber.dispose()
  const restarted = await boot(root)
  const history = await restarted.workItemsController.listWrites({ source: 'jira', limit: 20 }, signal)
  expect(history.operations).toEqual(expect.arrayContaining([confirmed.operation]))
  expect(await restarted.workItemsController.confirmWrite({ operationId: prepared.operationId }, signal)).toEqual(confirmed)
  expect(calls).toHaveLength(dispatched)
})
