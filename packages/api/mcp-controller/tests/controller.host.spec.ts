/** Real Gateway dispatch over a Loader-composed durable MCP manager. */
import { createTrustedConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import McpController from '../src/index.ts'
import { startHttpMcpFixture } from '../../../mcp/mcp-client/tests/http-fixture.ts'
import type { McpManagementSnapshot, McpSaveResult } from '../src/types.ts'
import { bootFixture } from '../../../mcp/mcp-management/tests/harness.ts'

async function fixture() {
  const { ctx } = await bootFixture({ patches: [{ insert: [
    { id: 'typert', name: 'cordis:mcp-fixture-typert' },
    { id: 'gateway', name: 'cordis:mcp-fixture-gateway' },
    { id: 'controller', name: 'cordis:mcp-fixture-controller' },
  ] }], prepare: (root) => {
    Object.assign(root.loader.builtins, {
      'mcp-fixture-typert': TypertRegistry, 'mcp-fixture-gateway': TypertGateway, 'mcp-fixture-controller': McpController,
    })
  } })
  const access = createTrustedConnectionAccess()
  const call = (method: string, request?: unknown) => ctx.typertGateway.invoke({
    access, namespace: 'mcp', method, args: request === undefined ? {} : { request },
  })
  return { ctx, call }
}

const record = {
  transport: 'streamable-http', serverName: 'fixture', url: 'http://127.0.0.1:1/mcp', enabled: false, headers: {},
}

describe('MCP Remote management', () => {
  it('exposes actual methods and carries revisioned durable CRUD through Gateway dispatch', async () => {
    const { ctx, call } = await fixture()
    expect(remoteMethods(ctx.mcpController).map(method => method.exportName ?? method.method))
      .toEqual(['snapshot', 'watch', 'save', 'removeServer', 'setEnabled', 'reconnect', 'probe'])
    expect(await call('snapshot')).toMatchObject({ profile: 'fixture-profile', revision: 0, servers: [] })
    const saved = await call('save', { record, expectedRevision: 0 }) as McpSaveResult
    expect(saved.snapshot.servers[0]?.record.enabled).toBe(false)
    await expect(call('removeServer', { id: saved.id, expectedRevision: 0 })).rejects.toMatchObject({ code: 'mcp/conflict' })
    await expect(call('reconnect', { id: saved.id })).rejects.toMatchObject({ code: 'mcp/disabled' })
    await expect(call('probe', { id: saved.id })).rejects.toMatchObject({ code: 'mcp/disabled' })
    expect(await call('removeServer', { id: saved.id, expectedRevision: 1 })).toMatchObject({ revision: 2, servers: [] })
  })

  it('streams committed replacements through the real carrier and cancels without retaining observers', async () => {
    const { ctx, call } = await fixture()
    const abort = new AbortController()
    onTestFinished(() => { abort.abort() })
    const source = await ctx.typertGateway.wireStream.open('mcp/watch', { args: {} }, abort.signal, createTrustedConnectionAccess())
    const iterator = source[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ revision: 0, servers: [] })
    await call('save', { record, expectedRevision: 0 })
    const next = await iterator.next()
    expect((next.value as McpManagementSnapshot).revision).toBe(1)
    expect((next.value as McpManagementSnapshot).servers[0]?.observed.phase).toBe('stopped')
    const pending = iterator.next()
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: 'gateway/cancelled' })
  })

  it('enables and probes a real connection and preserves caller cancellation across Remote error translation', async () => {
    const server = await startHttpMcpFixture()
    onTestFinished(async () => { await server.close() })
    const { ctx, call } = await fixture()
    const saved = await call('save', { record: { ...record, url: server.url, reconnect: { enabled: false } }, expectedRevision: 0 }) as McpSaveResult
    expect(await call('setEnabled', { id: saved.id, enabled: true, expectedRevision: 1 })).toMatchObject({ revision: 2 })
    await vi.waitFor(() => { expect(ctx.mcpController.snapshot().servers[0]?.observed.phase).toBe('ready') })
    expect(await call('probe', { id: saved.id })).toMatchObject({ servers: [{ observed: { phase: 'ready' } }] })
    const abort = new AbortController()
    const cancelled = ctx.mcpController.probe({ id: saved.id }, abort.signal)
    abort.abort(new Error('fixture caller cancelled'))
    await expect(cancelled).rejects.toThrow('fixture caller cancelled')
    expect(await call('setEnabled', { id: saved.id, enabled: false, expectedRevision: 2 }))
      .toMatchObject({ revision: 3, servers: [{ observed: { phase: 'stopped' } }] })
  })

  it('coalesces slow-consumer changes and releases an idle watch on controller disposal', async () => {
    const { ctx, call } = await fixture()
    const source = ctx.mcpController.watch(new AbortController().signal)
    const iterator = source[Symbol.asyncIterator]()
    const paused = ctx.mcpController.watch(new AbortController().signal)[Symbol.asyncIterator]()
    expect((await paused.next()).value).toMatchObject({ revision: 0 })
    expect((await iterator.next()).value).toMatchObject({ revision: 0 })
    const pending = iterator.next()
    const saved = await call('save', { record, expectedRevision: 0 }) as McpSaveResult
    await pending
    await call('setEnabled', { id: saved.id, enabled: false, expectedRevision: 1 })
    expect((await iterator.next()).value).toMatchObject({ revision: 2 })
    const waiting = iterator.next()
    const entry = ctx.loader.entries().find(item => item.options.id === 'controller')
    if (entry?.fiber === undefined) throw new Error('Fixture controller has no active fiber')
    await entry.fiber.update({}, true)
    expect(await waiting).toEqual({ done: true, value: undefined })
    expect(await paused.next()).toEqual({ done: true, value: undefined })
  })

  it('rejects literal header secrets and credential-bearing URLs without exposing their content', async () => {
    const { call } = await fixture()
    for (const request of [
      { ...record, headers: { Authorization: 'secret-value' } },
      { ...record, url: 'https://user:secret-value@example.test/mcp' },
      { ...record, url: 'https://example.test/mcp?token=secret-value' },
    ]) {
      let failure: unknown
      try { await call('save', { record: request, expectedRevision: 0 }) } catch (error) { failure = error }
      expect(failure).toMatchObject({ code: 'mcp/invalid-config', message: 'MCP management request failed' })
      expect(String(failure)).not.toContain('secret-value')
    }
    expect(await call('snapshot')).toMatchObject({ revision: 0, servers: [] })
  })
})
