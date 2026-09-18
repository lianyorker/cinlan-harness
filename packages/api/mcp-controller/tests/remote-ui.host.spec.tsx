// @vitest-environment jsdom
/** Native MCP rendering follows real Gateway operations through an in-process Remote carrier. */
import { act, cleanup, render as renderComponent } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods, type InvocationDescriptor, type RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import * as ClientApi from '@deepseek-ai/dsh-api-gateway/client'
import { z } from 'zod'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { McpSettingsSource } from '@deepseek-ai/dsh-client-ui-settings-mcp/src/client/source.ts'
import { McpSettingsSection, type McpSettingsSectionProps } from '@deepseek-ai/dsh-client-ui-settings-mcp/src/client/McpSettingsSection.tsx'
import { createMcpSettingsStore } from '@deepseek-ai/dsh-client-ui-settings-mcp/src/client/store.ts'
import { draftRequest } from '@deepseek-ai/dsh-client-ui-settings-mcp/src/client/draft.ts'
import { en, zh } from '@deepseek-ai/dsh-client-ui-settings-mcp/src/client/locales.ts'
import { startHttpMcpFixture } from '../../../mcp/mcp-client/tests/http-fixture.ts'
import { bootFixture } from '../../../mcp/mcp-management/tests/harness.ts'
import McpController from '../src/index.ts'

afterEach(cleanup)

describe('MCP Remote to native Settings', () => {
  it('renders real HTTP discovery then removes the stopped record through the same source', async () => {
    const server = await startHttpMcpFixture()
    onTestFinished(async () => { await server.close() })
    const { ctx } = await bootFixture({ patches: [{ insert: [
      { id: 'typert', name: 'cordis:mcp-ui-typert' }, { id: 'gateway', name: 'cordis:mcp-ui-gateway' },
      { id: 'controller', name: 'cordis:mcp-ui-controller' },
    ] }], prepare: (root) => { Object.assign(root.loader.builtins, {
      'mcp-ui-typert': TypertRegistry, 'mcp-ui-gateway': TypertGateway, 'mcp-ui-controller': McpController,
    }) } })
    const client = new Context()
    onTestFinished(async () => {
      await client.fiber.dispose()
      while (client.fiber.inertia !== undefined) await client.fiber.inertia
    })
    await client.plugin(TypertRegistry).await()
    client.provide('connection', {
      rpc: {
        async call(_channel: string, endpoint: string, payload: unknown, signal: AbortSignal) {
          const separator = endpoint.indexOf('/')
          try {
            const value = await ctx.typertGateway.invoke({
              namespace: endpoint.slice(0, separator), method: endpoint.slice(separator + 1),
              args: (payload as { args: Record<string, unknown> }).args, signal,
            })
            return { ok: true, value }
          } catch (error) {
            return { ok: false, error: error as RemoteFailure }
          }
        },
        async *open(_channel: string, endpoint: string, payload: unknown, signal: AbortSignal) {
          const stream = await ctx.typertGateway.wireStream.open(endpoint, payload, signal)
          yield* stream
        },
      },
      registerGenerationSource: () => () => {},
      start: () => ({ stop: () => {} }),
    })
    await client.plugin(ClientApi).await()
    // Live markers own endpoint names; the fixture carries request objects to Host validation.
    const requestCodec = { mode: 'strict', typeSymbol: '@fixture/mcp#Request', schema: z.record(z.string(), z.unknown()) } as const
    const descriptors: InvocationDescriptor[] = remoteMethods(ctx.mcpController).map(marker => ({
      id: '@deepseek-ai/dsh-api-mcp-controller#mcp/' + marker.method,
      service: 'mcpController', namespace: 'mcp', method: marker.exportName ?? marker.method,
      invocation: { kind: 'direct' }, ...marker.mode === undefined ? {} : { mode: marker.mode },
      parameters: marker.method === 'snapshot' || marker.mode === 'stream' ? []
        : [{ name: 'request', wire: 'request', source: 'json', codec: requestCodec }],
      ...marker.mode === 'stream' || marker.method === 'probe' ? { cancellation: { parameter: 'signal' } } : {},
      result: { mode: 'src-json' },
    }))
    const unmount = await client.remote.$mount({ package: '@deepseek-ai/dsh-api-mcp-controller', descriptors })
    expect(typeof client.remote.mcp.removeServer).toBe('function')
    const source = new McpSettingsSource(client.remote.mcp)
    onTestFinished(async () => { await source.dispose() })
    source.connect(1)
    await vi.waitFor(() => { expect(source.state.getSnapshot().status).toBe('ready') })
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('en')
    locale.register('settings.mcp', { en, zh })
    const store = createMcpSettingsStore().create()
    const props = {
      actions: store.actions, useStore: bindSnapshotSelector(store), useMcp: bindSnapshotSelector(source.state),
      t: locale.bind('settings.mcp'), retry: () => { source.restart() },
      save: async (draft) => { const request = draftRequest(draft); return request === undefined ? false : source.save(request) },
      remove: source.remove.bind(source), setEnabled: source.setEnabled.bind(source),
      reconnect: source.reconnect.bind(source), probe: source.probe.bind(source),
    } as McpSettingsSectionProps
    const view = renderComponent(<McpSettingsSection {...props} />)
    const render = () => view.container.innerHTML
    expect(render()).toContain(en.empty)
    await act(async () => { expect(await source.save({ expectedRevision: 0, record: {
      transport: 'streamable-http', serverName: 'real-http', enabled: true, url: server.url,
      headers: {}, reconnect: { enabled: false },
    } })).toBe(true)
    await vi.waitFor(() => { expect(source.state.getSnapshot().snapshot?.servers[0]?.observed.phase).toBe('ready') })
    })
    const html = render()
    expect(html).toContain('real-http')
    expect(html).toContain('mcp__real-http__ping')
    expect(html).toContain('Replies pong.')
    expect(html).toContain('Connection: Ready')
    const record = source.state.getSnapshot().snapshot?.servers[0]?.record
    if (record === undefined) throw new Error('Real saved record missing from source')
    await act(async () => { expect(await source.remove({ id: record.id, expectedRevision: 0 })).toBe(false) })
    expect(render()).toContain(en.conflict)
    expect(render()).toContain('real-http')
    await act(async () => { expect(await source.remove({ id: record.id, expectedRevision: 1 })).toBe(true) })
    expect(render()).toContain(en.empty)
    expect(render()).not.toContain('mcp__real-http__ping')
    expect(server.methods).not.toContain('tools/call')
    await source.dispose()
    await unmount()
    expect(client.get('remote.mcp')).toBeUndefined()
  }, 15_000)
})
