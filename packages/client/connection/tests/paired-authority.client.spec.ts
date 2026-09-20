/** Paired page authority is retained through the real Loader and Connection client composition. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as Connection from '../src/client/index.ts'
import type { ClientTransportHooks, ConnectionHandle } from '../src/client/index.ts'

async function loadClient(origin: string, authority?: 'paired', ownsHost?: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paired-client-'))
  const ctx = new Context()
  const originalFetch = globalThis.fetch
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const transportDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__DSH_TRANSPORT__')
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally {
      if (locationDescriptor === undefined) Reflect.deleteProperty(globalThis, 'location')
      else Object.defineProperty(globalThis, 'location', locationDescriptor)
      if (transportDescriptor === undefined) Reflect.deleteProperty(globalThis, '__DSH_TRANSPORT__')
      else Object.defineProperty(globalThis, '__DSH_TRANSPORT__', transportDescriptor)
      await rm(root, { recursive: true, force: true })
    }
  })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(origin) })
  const fetch = vi.fn<ClientTransportHooks['fetch']>(async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected RPC envelope')
    const envelope = JSON.parse(init.body) as { rpcId: string }
    return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: 'paired reply' } })
  })
  const hooks: ClientTransportHooks = {
    fetch,
    ...(authority === undefined ? {} : { authority }),
    ...(ownsHost === undefined ? {} : { ownsHost }),
  }
  if (authority === undefined && ownsHost === undefined) Reflect.deleteProperty(globalThis, '__DSH_TRANSPORT__')
  else Object.defineProperty(globalThis, '__DSH_TRANSPORT__', { configurable: true, value: hooks })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, '- name: test-connection-client')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (specifier !== 'test-connection-client') throw new Error('Unexpected fixture module: ' + specifier)
    return Connection
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('Connection did not load')
  return { connection, fetch, originalFetch }
}

describe('paired Connection client authority', () => {
  it.each(['https://localhost:7443', 'https://127.0.0.1:7443', 'https://phone.example'])(
    'suppresses local-owner UI on %s and uses only its supplied Fetch carrier', async (origin) => {
      const { connection, fetch, originalFetch } = await loadClient(origin, 'paired', false)
      expect(connection.isLoopback).toBe(false)
      await expect(connection.rpc.call('/api', 'fixture/read', {})).resolves.toEqual({ ok: true, value: 'paired reply' })
      expect(fetch).toHaveBeenCalledOnce()
      expect(String(fetch.mock.calls[0]?.[0])).toBe(origin + '/api/fixture/read')
      expect(globalThis.fetch).toBe(originalFetch)
    },
  )

  it('does not let ownsHost override explicit paired authority', async () => {
    const { connection } = await loadClient('https://localhost', 'paired', true)
    expect(connection.isLoopback).toBe(false)
  })

  it.each(['http://localhost:8080', 'http://127.0.0.1:8080'])(
    'preserves ordinary Web loopback classification on %s', async (origin) => {
      const { connection } = await loadClient(origin)
      expect(connection.isLoopback).toBe(true)
    },
  )
})
