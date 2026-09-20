/** Real Loader, Gateway, Connection, and authentication with an external terminal provider fixture. */
import { createTrustedConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SidebarTerminals from '@deepseek-ai/dsh-sidebar-terminals'
import type {
  SidebarAgentTerminalId, SidebarAgentTerminalSnapshot, SidebarTerminalAckRequest, SidebarTerminalAttachmentId,
  SidebarTerminalFrame, SidebarTerminalInputRequest, SidebarTerminalOpenRequest, SidebarTerminalReleaseRequest,
  SidebarTerminalResizeRequest, SidebarTerminalSessionId, SidebarTerminalUiTarget, SidebarTerminalCloseUiRequest, SidebarTerminalProcessId,
} from '@deepseek-ai/dsh-sidebar-terminals/types'
import { expect, onTestFinished, vi } from 'vitest'
import WebSocket from 'ws'
import Controller from '../src/index.ts'

/** Fixed attachment minted by the external provider fixture. */
export const ATTACHMENT = '12345678-1234-4234-8234-123456789abc' as SidebarTerminalAttachmentId
/** Native generation minted by the external provider fixture. */
export const PROCESS = '87654321-4321-4321-8321-cba987654321' as SidebarTerminalProcessId
/** Source JSON request used by authenticated clients. */
export const OPEN = { target: { kind: 'ui', sessionId: 'session-opaque', tabId: 'terminal:0' }, cols: 80, rows: 24 }

class ExternalTerminals extends SidebarTerminals {
  readonly signals: AbortSignal[] = []
  readonly returned = vi.fn<() => void>()
  readonly capability = vi.fn(() => ({ status: 'available' as const, shellName: 'fixture-shell' }))
  readonly shells = vi.fn(() => [{ path: '/bin/fixture-shell', name: 'fixture-shell' }])
  readonly input = vi.fn<(request: SidebarTerminalInputRequest) => void>()
  readonly resize = vi.fn<(request: SidebarTerminalResizeRequest) => void>()
  readonly ack = vi.fn<(request: SidebarTerminalAckRequest) => void>()
  readonly release = vi.fn<(request: SidebarTerminalReleaseRequest) => void>()
  readonly closeAgent = vi.fn<(uuid: SidebarAgentTerminalId) => void>()
  readonly inspectUi = vi.fn<(request: SidebarTerminalUiTarget) => SidebarTerminalProcessId | null>(() => PROCESS)
  readonly closeUi = vi.fn<(request: SidebarTerminalCloseUiRequest) => void>()
  readonly listUi = vi.fn<SidebarTerminals['listUi']>(() => [])
  readonly renameUi = vi.fn<SidebarTerminals['renameUi']>()
  readonly open = vi.fn((_request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame> =>
    this.frames(signal))
  readonly watch = vi.fn((
    _sessionId: SidebarTerminalSessionId, signal: AbortSignal,
  ): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]> => this.values([], signal))

  private frames(signal: AbortSignal): AsyncIterable<SidebarTerminalFrame> {
    return this.values({ type: 'ready', attachmentId: ATTACHMENT, processId: PROCESS, pid: 123, cwd: '.', shellName: 'fixture-shell' }, signal)
  }

  private async *values<T>(initial: T, signal: AbortSignal): AsyncIterable<T> {
    this.signals.push(signal)
    try {
      yield initial
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    } finally { this.returned() }
  }
}

/**
 * Boot source modules through test-only cordis.yml and real Loader resolution.
 * @param web - Bind an OS-assigned loopback listener for HTTP and mux authentication.
 * @returns Production carriers, external provider observations, and controller lifecycle controls.
 */
export async function createHarness(web = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sidebar-terminal-controller-'))
  const ctx = new Context()
  const sockets = new Set<WebSocket>()
  onTestFinished(async () => {
    try {
      await Promise.all([...sockets].map(async (socket) => {
        if (socket.readyState === WebSocket.CLOSED) return
        const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
        socket.terminate()
        await closed
      }))
      await ctx.fiber.dispose()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const rows = [
    ...(web ? [{ name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } }] : []),
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: '@deepseek-ai/dsh-client-connection' },
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-api-gateway' },
    { name: 'cordis:external-terminals' },
    { name: '@deepseek-ai/dsh-api-sidebar-terminal-controller' },
  ]
  const config = join(root, 'cordis.yml')
  await writeFile(config, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { include: Include, 'external-terminals': ExternalTerminals })
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer], ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-client-connection', Connection], ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-api-gateway', Gateway], ['@deepseek-ai/dsh-api-sidebar-terminal-controller', Controller],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const access = createTrustedConnectionAccess()
  const shared = ctx.connection.createSharedFetchHandler('/api', access)
  const origin = web ? 'http://127.0.0.1:' + String(ctx.webServer.port) : undefined
  let rpcId = 0
  return {
    ctx,
    provider: ctx.sidebarTerminals as ExternalTerminals,
    call(method: string, args: Record<string, unknown> = {}) {
      return ctx.typertGateway.invoke({ access, namespace: 'sidebarTerminals', method, args })
    },
    async stream(method: string, args: Record<string, unknown>, signal = new AbortController().signal) {
      const source = await ctx.typertGateway.wireStream.open('sidebarTerminals/' + method, { args }, signal, access)
      return source[Symbol.asyncIterator]()
    },
    async rpc(method: string, args: Record<string, unknown> = {}, cookie?: string) {
      const init = {
        method: 'POST', headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
        body: JSON.stringify({ type: 'client-request', rpcId: String(++rpcId), method: 'sidebarTerminals/' + method, payload: { args } }),
      }
      return origin === undefined
        ? shared.fetch(new Request('dsh-app://app/api/sidebarTerminals/' + method, init))
        : fetch(origin + '/api/sidebarTerminals/' + method, init)
    },
    cookie() {
      if (origin === undefined) throw new Error('Web listener required')
      const target = new URL(ctx.connection.authenticatedUrl(origin))
      let cookie: string | undefined
      ctx.connection.authorizeIndex({ method: 'GET', url: target.pathname + target.search, headers: { host: target.host } }, {
        writeHead(_status, headers) { cookie = headers?.['set-cookie'] }, end() {},
      })
      if (cookie === undefined) throw new Error('Connection did not issue cookie')
      return cookie.split(';', 1)[0]!
    },
    socket(cookie?: string) {
      if (origin === undefined) throw new Error('Web listener required')
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', {
        headers: cookie === undefined ? {} : { cookie },
      })
      sockets.add(socket)
      return socket
    },
    async setEnabled(enabled: boolean) {
      const entry = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-api-sidebar-terminal-controller')
      if (entry === undefined) throw new Error('Controller Loader entry missing')
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
  }
}

/**
 * Decode the actual Connection result envelope.
 * @param response - Shared Fetch or authenticated HTTP response.
 * @returns Result serialized by Gateway and Connection.
 */
export async function result(response: Response) {
  expect(response.status).toBe(200)
  const envelope = await response.json() as ServerResponse
  expect(envelope.type).toBe('server-response')
  return envelope.result
}
