/** Production Loader rows with isolated storage and authenticated Remote carriers. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { expect, onTestFinished, vi } from 'vitest'
import WebSocket, { type RawData } from 'ws'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadOverlayPatches, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalExecutionHost from '@deepseek-ai/dsh-execution-host-local'
import ExecutionHostTargets from '@deepseek-ai/dsh-execution-host-targets'
import type { Config as TargetsConfig } from '@deepseek-ai/dsh-execution-host-targets'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle, ServerResponse } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { parseRemoteStreamServerMessage, type RemoteStreamServerMessage } from '@deepseek-ai/dsh-api-gateway/src/stream-protocol.ts'
import ExecutionHostController from '../src/index.ts'
import type { ListTargetsValue } from '../src/types.ts'

const MANAGEMENT_NAMES = [
  '@deepseek-ai/dsh-execution-host-local',
  '@deepseek-ai/dsh-execution-host-targets',
  '@deepseek-ai/dsh-api-execution-host-controller',
] as const

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/**
 * Boot actual storage, subprocess, identity, target, authentication and Remote services.
 * @param targetConfig - deployment limits; SSH defaults to a nonexistent private executable.
 * @param profile - shipped profile supplying the identity, target and controller rows.
 * @returns real carriers and Loader controls; test teardown owns all sockets, plugins and files.
 */
export async function createHarness(targetConfig: Partial<TargetsConfig> = {}, profile: 'web' | 'security-research' = 'web') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-execution-host-controller-'))
  const ctx = new Context()
  const sockets: { socket: WebSocket; closed: Promise<void> }[] = []
  onTestFinished(async () => {
    try {
      for (const { socket } of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
      await Promise.all(sockets.map(value => value.closed))
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const configPath = join(root, 'cordis.yml')
  const warnings: string[] = []
  const layers = PROFILE_TEMPLATES[profile]!.bundles.map(name => loadOverlayPatches(name,
    fileURLToPath(new URL('../../../bundle/' + name.slice('@deepseek-ai/dsh-'.length) + '/cordis.patch.yml', import.meta.url))))
  const profileRows = composeEntries(layers, warning => warnings.push(warning))
  const wanted = new Set<string>(MANAGEMENT_NAMES)
  const managementRows = profileRows.filter(row => row.name !== undefined && wanted.has(row.name))
  expect(warnings).toEqual([])
  expect(managementRows.map(row => row.name).sort()).toEqual([...MANAGEMENT_NAMES].sort())
  const webManifest = JSON.parse(await readFile(new URL('../../../bundle/web-app/package.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>
  }
  for (const name of MANAGEMENT_NAMES) expect(webManifest.dependencies).toHaveProperty(name)
  const rows = [
    { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
    { name: '@deepseek-ai/dsh-storage' },
    { name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
    { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    { name: '@deepseek-ai/dsh-subprocess-local' },
    ...managementRows.map(row => row.name === '@deepseek-ai/dsh-execution-host-targets'
      ? { ...row, config: { sshExecutable: join(root, 'absent-ssh'), ...targetConfig } } : row),
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: '@deepseek-ai/dsh-client-connection' },
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-api-gateway' },
  ]
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
    ['@deepseek-ai/dsh-execution-host-local', LocalExecutionHost],
    ['@deepseek-ai/dsh-execution-host-targets', ExecutionHostTargets],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-api-gateway', TypertGateway],
    ['@deepseek-ai/dsh-api-execution-host-controller', ExecutionHostController],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected execution-host Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const origin = 'http://127.0.0.1:' + String(ctx.webServer.port)
  const cookie = authenticatedCookie(ctx.connection, origin)
  const shared = ctx.connection.createSharedFetchHandler('/api')
  let rpcSequence = 0
  const request = (method: string, args: unknown) => ({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'hosts-' + String(++rpcSequence), method: 'executionHosts/' + method, payload: { args } }),
  })
  return {
    ctx, root, origin, cookie,
    http(method: string, args: unknown = {}, authorized = true) {
      const init = request(method, args)
      return fetch(origin + '/api/executionHosts/' + method, { ...init, headers: { ...init.headers, ...(authorized ? { cookie } : {}) } })
    },
    desktop(method: string, args: unknown = {}) {
      return shared.fetch(new Request('dsh-app://app/api/executionHosts/' + method, request(method, args)))
    },
    async savedDocument(): Promise<unknown> {
      return JSON.parse(await readFile(join(root, 'storage', 'execution_host_targets.json'), 'utf8')) as unknown
    },
    async setEnabled(name: string, enabled: boolean): Promise<void> {
      const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === name)
      if (entry === undefined) throw new Error('missing execution-host Loader entry: ' + name)
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
    subscriptions(): number {
      return ctx.events._hooks['execution-host-targets/changed']?.length ?? 0
    },
    async socket(authorized = true) {
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', { headers: authorized ? { cookie } : {} })
      const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
      sockets.push({ socket, closed })
      const errors: Error[] = []
      socket.on('error', (error) => { errors.push(error) })
      const frames: RemoteStreamServerMessage[] = []
      socket.on('message', (data) => { frames.push(parseRemoteStreamServerMessage(rawText(data))) })
      await once(socket, 'open')
      return {
        socket, frames, errors, closed,
        follow(streamId: string): void {
          socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'executionHosts/follow', payload: { args: {} } }))
        },
        cancel(streamId: string): void { socket.send(JSON.stringify({ type: 'cancel', streamId })) },
        snapshots(streamId: string): ListTargetsValue[] {
          return frames.filter(frame => frame.type === 'item' && frame.streamId === streamId)
            .map(frame => (frame as Extract<RemoteStreamServerMessage, { type: 'item' }>).value as ListTargetsValue)
        },
        async waitForSnapshot(streamId: string, predicate: (value: ListTargetsValue) => boolean): Promise<ListTargetsValue> {
          let snapshot: ListTargetsValue | undefined
          await vi.waitFor(() => {
            snapshot = this.snapshots(streamId).find(predicate)
            expect(snapshot).toBeDefined()
          })
          return snapshot!
        },
      }
    },
  }
}

/**
 * Decode and verify the actual Connection response envelope.
 * @param response - real shared Fetch or authenticated HTTP response.
 * @returns serialized Remote result.
 */
export async function remoteResult(response: Response) {
  expect(response.status).toBe(200)
  const envelope = await response.json() as ServerResponse
  expect(envelope.type).toBe('server-response')
  expect(envelope.rpcId).toMatch(/^hosts-[0-9]+$/)
  return envelope.result
}

/**
 * Require a successful response and read its declared controller DTO.
 * @param response - actual Connection response.
 * @returns the decoded value after success validation.
 */
export async function success<T>(response: Response): Promise<T> {
  const result = await remoteResult(response)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message)
  return result.value as T
}

function authenticatedCookie(connection: HostConnectionHandle, origin: string): string {
  const launch = new URL(connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  connection.authorizeIndex({ method: 'GET', url: launch.pathname + launch.search, headers: { host: launch.host } }, {
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
  if (setCookie === undefined) throw new Error('execution-host fixture received no browser cookie')
  return setCookie.split(';', 1)[0]!
}
