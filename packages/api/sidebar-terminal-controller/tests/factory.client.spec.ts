/** Real Loader composition for the Client terminal factory, with only physical transport I/O controlled. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as ClientConnection from '@deepseek-ai/dsh-client-connection/client'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import * as ClientGateway from '@deepseek-ai/dsh-api-gateway/client'
import { TYPERT_REMOTE } from '@deepseek-ai/dsh-api-sidebar-terminal-controller/remote'
import type {
  SidebarAgentTerminalId, SidebarTerminalAttachmentId, SidebarTerminalFrame, SidebarTerminalOpenRequest,
  SidebarTerminalProcessId, SidebarTerminalSessionId, SidebarTerminalTabId, TerminalCallbacks,
} from '../src/types.ts'
import * as Factory from '../src/client/index.ts'

interface PendingFetch {
  readonly url: URL
  fail(error: Error): void
}

function externalTransport(opening?: SidebarTerminalFrame) {
  const pending = new Set<PendingFetch>()
  const arrivals: PendingFetch[] = []
  const receivers: Array<(request: PendingFetch) => void> = []
  const streams = new Set<AbortSignal>()
  const fetch = vi.fn<ClientTransportHooks['fetch']>((url) => {
    const response = Promise.withResolvers<Response>()
    const request = { url, fail: (error: Error) => { response.reject(error) } }
    pending.add(request)
    const receive = receivers.shift()
    if (receive === undefined) arrivals.push(request)
    else receive(request)
    return response.promise.finally(() => { pending.delete(request) })
  })
  const hooks: ClientTransportHooks = {
    fetch,
    async *openStream(endpoint, _payload, signal) {
      if (signal.aborted) return
      streams.add(signal)
      const closed = Promise.withResolvers<undefined>()
      const abort = (): void => { closed.resolve(undefined) }
      signal.addEventListener('abort', abort, { once: true })
      try {
        if (endpoint === 'sidebarTerminals/open' && opening !== undefined) yield opening
        await closed.promise
      } finally {
        signal.removeEventListener('abort', abort)
        streams.delete(signal)
      }
    },
  }
  return {
    hooks, fetch, pending, streams,
    nextFetch(): Promise<PendingFetch> {
      const request = arrivals.shift()
      return request === undefined
        ? new Promise(resolve => receivers.push(resolve))
        : Promise.resolve(request)
    },
    failAll(): void {
      for (const request of pending) request.fail(new Error('External transport fixture closed.'))
    },
  }
}

const factoryPluginName = '@deepseek-ai/dsh-api-sidebar-terminal-controller/client'
const descriptorPluginName = 'test-sidebar-terminal-remote-descriptors'
const sessionId = 'factory-session' as SidebarTerminalSessionId
const tabId = 'terminal:factory' as SidebarTerminalTabId
const attachmentId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' as SidebarTerminalAttachmentId
const agentId = '11111111-2222-4333-8444-555555555555' as SidebarAgentTerminalId
const request: SidebarTerminalOpenRequest = { target: { kind: 'ui', sessionId, tabId }, cols: 80, rows: 24 }

async function loadFactory(opening?: SidebarTerminalFrame) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-client-factory-'))
  const ctx = new Context()
  const io = externalTransport(opening)
  onTestFinished(async () => {
    io.failAll()
    try {
      await ctx.fiber.dispose()
      expect(io.pending.size).toBe(0)
      expect(io.streams.size).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      await rm(root, { recursive: true, force: true })
    }
  })
  vi.stubGlobal('__DSH_TRANSPORT__', io.hooks)
  const descriptors = {
    inject: ['remote'],
    async apply(scope: Context) { await scope.remote.$mount(TYPERT_REMOTE) },
  }
  const rows = [
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-client-connection/client' },
    { name: '@deepseek-ai/dsh-api-gateway/client' },
    { name: descriptorPluginName },
    { name: factoryPluginName },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-client-connection/client', ClientConnection],
    ['@deepseek-ai/dsh-api-gateway/client', ClientGateway],
    [descriptorPluginName, descriptors],
    [factoryPluginName, Factory],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected Loader module: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(value => value.options.name === factoryPluginName)
  if (entry === undefined) throw new Error('Client factory Loader entry missing.')
  const create = ctx.get('sidebarTerminalClient')
  expect(create).toBeTypeOf('function')
  if (create === undefined) throw new Error('Client terminal factory missing.')
  return {
    ctx, io, create,
    async setEnabled(enabled: boolean): Promise<void> {
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
  }
}

async function expectDisposed(scope: TerminalCallbacks): Promise<void> {
  const delivered = vi.fn()
  expect(() => scope.connectTerminal(request, async () => { delivered() }, delivered)).toThrow(/disposed/)
  expect(() => scope.watchAgentTerminals(sessionId, delivered)).toThrow(/disposed/)
  await expect(scope.terminalCapability()).rejects.toThrow(/disposed/)
  await expect(scope.terminalInput(attachmentId, 'late input')).rejects.toThrow(/disposed/)
  await expect(scope.terminalResize(attachmentId, 90, 30)).rejects.toThrow(/disposed/)
  await expect(scope.terminalCloseAgent(agentId)).rejects.toThrow(/disposed/)
  await expect(scope.terminalCloseUi(sessionId, tabId)).rejects.toThrow(/disposed/)
  expect(delivered).not.toHaveBeenCalled()
}

function outcome(pending: Promise<unknown>): Promise<string> {
  return pending.then(() => 'fulfilled', () => 'rejected')
}

describe('sidebar terminal Client factory through Loader', () => {
  it('withdraws the factory and rejects retained clients before pending physical I/O settles', async () => {
    const h = await loadFactory()
    const scope = h.create()
    const pending = outcome(scope.terminalCapability())
    const sent = await h.io.nextFetch()
    expect(sent.url.pathname).toBe('/api/sidebarTerminals/capability')
    let finished = false
    const stopping = h.setEnabled(false).then(() => { finished = true })
    await vi.waitFor(() => { expect(h.ctx.get('sidebarTerminalClient')).toBeUndefined() })
    expect(finished).toBe(false)
    expect(() => h.create()).toThrow()
    await expectDisposed(scope)
    expect(h.io.fetch).toHaveBeenCalledOnce()
    sent.fail(new Error('Physical request completed with a connection failure.'))
    expect(await pending).toBe('rejected')
    await stopping
    expect(finished).toBe(true)
    expect(() => h.create()).toThrow()
    await expectDisposed(scope)
    expect(h.io.fetch).toHaveBeenCalledOnce()
  })

  it('keeps UI scopes independent and creates another scope after one has closed', async () => {
    const h = await loadFactory()
    const first = h.create()
    const second = h.create()
    const secondPending = outcome(second.terminalCapability())
    const secondRequest = await h.io.nextFetch()
    await first.dispose()
    await expectDisposed(first)
    expect(h.ctx.get('sidebarTerminalClient')).toBe(h.create)
    const replacement = h.create()
    const replacementPending = outcome(replacement.terminalCapability())
    const replacementRequest = await h.io.nextFetch()
    expect(replacementRequest.url.pathname).toBe('/api/sidebarTerminals/capability')
    let secondClosed = false
    const closingSecond = second.dispose().then(() => { secondClosed = true })
    await expectDisposed(second)
    expect(secondClosed).toBe(false)
    secondRequest.fail(new Error('Second scope request finished.'))
    expect(await secondPending).toBe('rejected')
    await closingSecond
    expect(h.io.pending.size).toBe(1)
    expect(h.ctx.get('sidebarTerminalClient')).toBe(h.create)
    replacementRequest.fail(new Error('Replacement scope request finished.'))
    expect(await replacementPending).toBe('rejected')
    await replacement.dispose()
    expect(h.io.fetch).toHaveBeenCalledTimes(2)
  })

  it('awaits a scope already closing and makes repeated dispose calls await the same cleanup', async () => {
    const h = await loadFactory()
    const scope = h.create()
    const pending = outcome(scope.terminalCapability())
    const sent = await h.io.nextFetch()
    let firstDone = false
    let repeatedDone = false
    let providerDone = false
    const first = scope.dispose().then(() => { firstDone = true })
    const repeated = scope.dispose().then(() => { repeatedDone = true })
    const provider = h.setEnabled(false).then(() => { providerDone = true })
    await vi.waitFor(() => { expect(h.ctx.get('sidebarTerminalClient')).toBeUndefined() })
    await setImmediate()
    expect(firstDone).toBe(false)
    expect(repeatedDone).toBe(false)
    expect(providerDone).toBe(false)
    expect(() => h.create()).toThrow()
    sent.fail(new Error('Already-closing scope finished its physical request.'))
    expect(await pending).toBe('rejected')
    await Promise.all([first, repeated, provider])
    expect([firstDone, repeatedDone, providerDone]).toEqual([true, true, true])
    expect(h.io.pending.size).toBe(0)
  })

  it('waits for another UI scope after one scope fails to release its attachment', async () => {
    const opening: SidebarTerminalFrame = {
      type: 'ready', attachmentId, processId: '66666666-7777-4888-8999-000000000000' as SidebarTerminalProcessId,
      pid: 123, cwd: '/workspace', shellName: 'fixture-shell',
    }
    const h = await loadFactory(opening)
    const failingScope = h.create()
    const pendingScope = h.create()
    const renderer = Promise.withResolvers<undefined>()
    const received = Promise.withResolvers<SidebarTerminalFrame>()
    const errors = vi.fn()
    onTestFinished(() => { renderer.resolve(undefined) })
    failingScope.connectTerminal(request, (frame) => {
      received.resolve(frame)
      return renderer.promise
    }, errors)
    expect(await received.promise).toEqual(opening)
    const pending = outcome(pendingScope.terminalCapability())
    const pendingRequest = await h.io.nextFetch()
    expect(pendingRequest.url.pathname).toBe('/api/sidebarTerminals/capability')
    let providerDone = false
    const stopping = outcome(h.setEnabled(false)).then((result) => { providerDone = true; return result })
    const release = await h.io.nextFetch()
    expect(release.url.pathname).toBe('/api/sidebarTerminals/release')
    await vi.waitFor(() => { expect(h.ctx.get('sidebarTerminalClient')).toBeUndefined() })
    release.fail(new Error('External attachment release failed.'))
    await expect(failingScope.dispose()).rejects.toBeInstanceOf(AggregateError)
    await setImmediate()
    expect(providerDone).toBe(false)
    expect(h.io.pending.size).toBe(1)
    expect(() => h.create()).toThrow()
    await expectDisposed(pendingScope)
    pendingRequest.fail(new Error('Other UI scope request finally settled.'))
    expect(await pending).toBe('rejected')
    await stopping
    expect(providerDone).toBe(true)
    renderer.resolve(undefined)
    expect(errors).not.toHaveBeenCalled()
    expect(h.io.fetch).toHaveBeenCalledTimes(2)
    expect(h.io.pending.size).toBe(0)
  })

  it('publishes a fresh factory on reactivation while retained factories and clients stay stopped', async () => {
    const h = await loadFactory()
    const oldScope = h.create()
    await h.setEnabled(false)
    expect(h.ctx.get('sidebarTerminalClient')).toBeUndefined()
    expect(() => h.create()).toThrow()
    await expectDisposed(oldScope)
    await h.setEnabled(true)
    const nextFactory = h.ctx.get('sidebarTerminalClient')
    expect(nextFactory).toBeTypeOf('function')
    expect(nextFactory).not.toBe(h.create)
    if (nextFactory === undefined) throw new Error('Reactivated factory missing.')
    expect(() => h.create()).toThrow()
    const nextScope = nextFactory()
    const pending = outcome(nextScope.terminalCapability())
    const sent = await h.io.nextFetch()
    expect(sent.url.pathname).toBe('/api/sidebarTerminals/capability')
    sent.fail(new Error('Reactivated scope reached physical I/O.'))
    expect(await pending).toBe('rejected')
    await nextScope.dispose()
    await expectDisposed(oldScope)
    expect(h.io.fetch).toHaveBeenCalledOnce()
  })
})
