/** Loader composition and real Connection HTTP carrier for usage controller tests. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import UsageQueryService from '@deepseek-ai/dsh-usage-query'
import type { Config as UsageQueryConfig, UsageQueryRequest } from '@deepseek-ai/dsh-usage-query'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute, WebServer, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import * as UsageController from '../src/index.ts'
import { seedUsageLogs } from './fixture.ts'

/**
 * Assemble real providers from cordis.yml without an Agent or model adapter.
 * @param queryConfig - optional bounded-query settings for deadline tests.
 * @returns the Loader context, cold logs, registered routes, and entry lifecycle controls.
 */
export async function createHarness(queryConfig: Partial<UsageQueryConfig> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-controller-'))
  const ctx = new Context()
  const routes: WebRoute[] = []
  const upgrades: WebUpgradeRoute[] = []
  onTestFinished(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const webServer: Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> = {
    register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
  ctx.provide('webServer', webServer as WebServer)
  const configPath = join(root, 'cordis.yml')
  const rows = [
    { name: '@deepseek-ai/dsh-session' },
    { name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: '@deepseek-ai/dsh-session-query-sqlite', config: { path: join(root, 'query.sqlite') } },
    { name: '@deepseek-ai/dsh-usage-query', config: queryConfig },
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: '@deepseek-ai/dsh-client-connection' },
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-api-gateway' },
    { name: '@deepseek-ai/dsh-api-usage-controller' },
  ]
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', SessionPersistenceJsonl],
    ['@deepseek-ai/dsh-session-query-sqlite', SessionQuerySqlite],
    ['@deepseek-ai/dsh-usage-query', UsageQueryService],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-api-gateway', TypertGateway],
    ['@deepseek-ai/dsh-api-usage-controller', UsageController],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected usage Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceJsonl
  const paths = await seedUsageLogs(persistence)
  return {
    ctx, root, routes, upgrades, persistence, paths,
    async setEnabled(name: string, enabled: boolean) {
      const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === name)
      if (entry === undefined) throw new Error('missing usage Loader entry: ' + name)
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
  }
}

/**
 * Serve the Connection-owned route on an OS-allocated loopback port.
 * @param ctx - authenticated Host composition.
 * @param routes - routes registered by the real Connection plugin.
 * @returns an HTTP query client with a valid cookie from the launch-token exchange.
 */
export async function serveApi(ctx: Context, routes: readonly WebRoute[]) {
  const activeHandlers = new Set<Promise<void>>()
  const errors: unknown[] = []
  const server = createServer((request, response) => {
    const route = routes.find(candidate => candidate.path === '/api')
    if (route === undefined) { response.writeHead(404); response.end(); return }
    const handling = Promise.resolve(route.handler(request, response))
    activeHandlers.add(handling)
    void handling.catch((error: unknown) => { errors.push(error) }).finally(() => { activeHandlers.delete(handling) })
  })
  onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
      server.closeAllConnections()
    })
    await Promise.all(activeHandlers)
    if (errors.length > 0) throw new AggregateError(errors, 'usage HTTP route failed')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('usage HTTP fixture has no TCP address')
  const origin = 'http://127.0.0.1:' + String(address.port)
  const cookie = browserCookie(ctx.connection, origin)
  return {
    cookie, origin,
    query(request: UsageQueryRequest, options: { cookie?: string; signal?: AbortSignal } = { cookie }) {
      return fetch(origin + '/api/usage/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(options.cookie === undefined ? {} : { cookie: options.cookie }) },
        body: JSON.stringify({ type: 'client-request', rpcId: 'usage-request', method: 'usage/query', payload: { args: { request } } }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    },
  }
}

function browserCookie(connection: HostConnectionHandle, origin: string): string {
  const target = new URL(connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  connection.authorizeIndex({ method: 'GET', url: target.pathname + target.search, headers: { host: target.host } }, {
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
  if (setCookie === undefined) throw new Error('usage fixture received no browser authentication cookie')
  return setCookie.split(';', 1)[0]!
}

/**
 * Pause only the scheduling of a real cold open so cancellation has a deterministic overlap.
 * @param persistence - real provider whose original open still performs the read or abort check.
 * @returns the entry signal, scheduling release, and operation settlement.
 */
export function holdColdOpen(persistence: SessionPersistenceJsonl) {
  const entered = Promise.withResolvers<AbortSignal>()
  const release = Promise.withResolvers<undefined>()
  const settled = Promise.withResolvers<undefined>()
  let started = false
  const open = persistence.open.bind(persistence)
  const spy = vi.spyOn(persistence, 'open').mockImplementationOnce(async (id, access, options) => {
    started = true
    try {
      if (options?.signal === undefined) throw new Error('usage cold open has no cancellation signal')
      entered.resolve(options.signal)
      await release.promise
      return await open(id, access, options)
    } finally {
      settled.resolve(undefined)
    }
  })
  onTestFinished(async () => {
    release.resolve(undefined)
    if (started) await settled.promise
    spy.mockRestore()
  })
  return { entered: entered.promise, release: () => { release.resolve(undefined) }, settled: settled.promise }
}
