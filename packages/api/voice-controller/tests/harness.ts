/** Real Loader composition for desktop Fetch and optional authenticated HTTP voice calls. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse as HttpResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Voice, { VoiceModelId } from '@deepseek-ai/dsh-voice'
import type { VoiceModelDefinition, VoiceModelsListValue, VoiceModelTask } from '@deepseek-ai/dsh-voice'
import * as SherpaProvider from '@deepseek-ai/dsh-voice-sherpa-onnx'
import * as sherpaDeps from '@deepseek-ai/dsh-voice-sherpa-onnx/src/sherpa-deps.ts'
import type { SherpaOfflineRecognizerConfig, SherpaOnlineRecognizerConfig } from '@deepseek-ai/dsh-voice-sherpa-onnx/src/sherpa-deps.ts'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle, ServerResponse } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import VoiceController from '../src/index.ts'

/** Test-only pinned model contributed beside the shipped catalog. */
export const MODEL_ID = 'fixture-model'
/** Loader row owning the private model contribution. */
export const FIXTURE_PLUGIN = 'voice-test-model'

/**
 * Bind a controlled HTTP fixture and join every connection at teardown.
 * @param handler - Synchronous request handler; the test owns response release.
 * @returns Assigned origin and explicit idempotent close operation.
 */
export async function httpFixture(handler: (request: IncomingMessage, response: HttpResponse) => void) {
  const server = createServer(handler)
  let closing: Promise<void> | undefined
  const close = () => closing ??= new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
    server.closeAllConnections()
  })
  onTestFinished(close)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind TCP')
  return { origin: 'http://127.0.0.1:' + String(address.port), close }
}

/**
 * Serve tiny pinned model files with barriers for an in-flight HTTP response.
 * @returns Definition, observed requests, and controls for subsequent transfers.
 */
export async function modelFixture() {
  const files = new Map(['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt'].map(name => [name, Buffer.from('tiny pinned ' + name)]))
  const requests: string[] = []
  let blocked: {
    entered: ReturnType<typeof Promise.withResolvers<HttpResponse>>
    closed: ReturnType<typeof Promise.withResolvers<undefined>>
    response: HttpResponse | undefined
  } | undefined
  let status = 200
  const server = await httpFixture((request, response) => {
    const name = (request.url ?? '').slice(1)
    requests.push(name)
    const bytes = files.get(name)
    if (bytes === undefined) { response.writeHead(404); response.end(); return }
    if (blocked !== undefined && blocked.response === undefined) {
      const gate = blocked
      gate.response = response
      response.once('close', () => { gate.closed.resolve(undefined) })
      response.writeHead(200, { 'content-length': String(bytes.byteLength) })
      response.flushHeaders()
      blocked.entered.resolve(response)
      return
    }
    response.writeHead(status, { 'content-length': String(bytes.byteLength) })
    response.end(bytes)
  })
  const definition: VoiceModelDefinition = {
    id: VoiceModelId(MODEL_ID), name: 'Tiny local model', description: 'Pinned test model', recommended: false,
    kind: 'streaming', approximateBytes: [...files.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
    download: { type: 'files', entries: [...files].map(([name, bytes]) => ({
      name, url: server.origin + '/' + name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
    })) },
    architecture: { type: 'transducer', encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' },
  }
  return {
    definition, requests, files,
    fail(code = 503) { status = code },
    hold() {
      const gate = {
        entered: Promise.withResolvers<HttpResponse>(),
        closed: Promise.withResolvers<undefined>(),
        response: undefined as HttpResponse | undefined,
      }
      blocked = gate
      return {
        entered: gate.entered.promise, closed: gate.closed.promise,
        release() {
          const response = gate.response
          if (response === undefined) throw new Error('model response has not started')
          response.end(files.get('encoder.onnx'))
          blocked = undefined
        },
      }
    },
  }
}

/**
 * Load production service rows from a private cordis.yml.
 * @param web - include an actual WebServer listening on an OS-assigned loopback port.
 * @param options - Optional shared cache and model server for multiple Hosts.
 * @returns context, private home, real carrier clients, and Loader lifecycle controls.
 */
export async function createHarness(web = false, options: { cacheRoot?: string; fixture?: Awaited<ReturnType<typeof modelFixture>> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-controller-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      vi.restoreAllMocks()
      sherpaDeps.resetSherpaOnnxCache()
      await rm(root, { recursive: true, force: true })
    }
  })
  const fixture = options.fixture ?? await modelFixture()
  const cacheRoot = options.cacheRoot ?? join(root, 'model-cache')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const configPath = join(root, 'cordis.yml')
  const rows = [
    ...(web ? [{ name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } }] : []),
    { name: '@deepseek-ai/dsh-voice' },
    { name: '@deepseek-ai/dsh-subprocess-local' },
    { name: '@deepseek-ai/dsh-voice-sherpa-onnx', config: { cacheRoot, downloadConcurrency: 1, downloadMaxAttempts: 1 } },
    { name: FIXTURE_PLUGIN },
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: '@deepseek-ai/dsh-client-connection' },
    { name: '@deepseek-ai/dsh-typert-registry' },
    { name: '@deepseek-ai/dsh-api-gateway' },
    { name: '@deepseek-ai/dsh-api-voice-controller' },
  ]
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-voice', Voice],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
    ['@deepseek-ai/dsh-voice-sherpa-onnx', SherpaProvider],
    [FIXTURE_PLUGIN, { name: FIXTURE_PLUGIN, inject: ['voice'], apply(context: Context) { context.effect(() => context.voice.registerModel(fixture.definition)) } }],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-api-gateway', TypertGateway],
    ['@deepseek-ai/dsh-api-voice-controller', VoiceController],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected voice Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const shared = ctx.connection.createSharedFetchHandler('/api')
  const requestFetch = fetch
  const origin = web ? 'http://127.0.0.1:' + String(ctx.webServer.port) : undefined
  let nextRpc = 0
  const rpcRequest = (method: string, args: unknown, signal?: AbortSignal): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `voice-${String(++nextRpc)}`, method: `voice/${method}`, payload: { args } }),
    ...(signal === undefined ? {} : { signal }),
  })
  return {
    ctx, root, origin, cacheRoot, fixture,
    remote(method: string, args: unknown = {}, signal?: AbortSignal) {
      return shared.fetch(new Request(`dsh-app://app/api/voice/${method}`, rpcRequest(method, args, signal)))
    },
    http(method: string, args: unknown = {}, cookie?: string) {
      if (origin === undefined) throw new Error('voice fixture has no WebServer')
      const request = rpcRequest(method, args)
      return requestFetch(`${origin}/api/voice/${method}`, {
        ...request, headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      })
    },
    legacy(method: string, payload: unknown = {}) {
      if (origin === undefined) throw new Error('voice fixture has no WebServer')
      return requestFetch(`${origin}/voice/api/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })
    },
    async setEnabled(name: string, enabled: boolean) {
      const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === name)
      if (entry === undefined) throw new Error('missing voice Loader entry: ' + name)
      await entry.update({ disabled: !enabled })
      await ctx.loader.await()
    },
  }
}

/**
 * Decode and check the actual Connection response envelope.
 * @param response - settled Fetch response from a real carrier.
 * @returns the serialized Remote result.
 */
export async function remoteResult(response: Response) {
  expect(response.status).toBe(200)
  const envelope = await response.json() as ServerResponse
  expect(envelope.type).toBe('server-response')
  expect(envelope.rpcId).toMatch(/^voice-\d+$/)
  return envelope.result
}

/**
 * Exchange the Connection launch token for its browser cookie.
 * @param connection - real Host Connection service.
 * @param origin - loopback origin bound by the test WebServer.
 * @returns the cookie issued by Connection authentication.
 */
export function authenticatedCookie(connection: HostConnectionHandle, origin: string): string {
  const target = new URL(connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  connection.authorizeIndex({ method: 'GET', url: target.pathname + target.search, headers: { host: target.host } }, {
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
  if (setCookie === undefined) throw new Error('voice fixture received no browser authentication cookie')
  return setCookie.split(';', 1)[0]!
}

/**
 * Read model rows over the actual desktop carrier.
 * @param harness - Loaded provider and Remote controller.
 * @returns Public model rows.
 */
export async function models(harness: Awaited<ReturnType<typeof createHarness>>) {
  const result = await remoteResult(await harness.remote('modelsList'))
  if (!result.ok) throw new Error('voice roster failed: ' + result.error.message)
  return (result.value as VoiceModelsListValue).models
}

/**
 * Await one task's observable terminal record.
 * @param harness - Host that owns the task.
 * @param taskId - Exact task receipt.
 * @returns Terminal model row.
 */
export async function terminalTask(harness: Awaited<ReturnType<typeof createHarness>>, taskId: string) {
  return vi.waitFor(async () => {
    const row = (await models(harness)).find(row => row.task?.taskId === taskId)
    if (row === undefined || row.task?.state === 'running') throw new Error('task has not settled')
    return row
  }, { timeout: 5000 })
}

/**
 * Download the fixture through the real carrier and verify durable bytes.
 * @param harness - Loaded Host and model server.
 * @returns Committed generation directory.
 */
export async function installModel(harness: Awaited<ReturnType<typeof createHarness>>): Promise<string> {
  const result = await remoteResult(await harness.remote('modelsDownload', { request: { modelId: MODEL_ID } }))
  if (!result.ok) throw new Error(result.error.message)
  const row = await terminalTask(harness, (result.value as VoiceModelTask).taskId)
  expect(row.task?.state).toBe('succeeded')
  expect(row.resource.integrity).toBe('verified')
  if (row.status.state !== 'ready') throw new Error('fixture model is not ready')
  for (const [name, bytes] of harness.fixture.files) expect(await readFile(join(row.status.cacheDir, name))).toEqual(bytes)
  return row.status.cacheDir
}

/**
 * Replace only the external sherpa-onnx-node constructors.
 * @param text - external recognizer output.
 * @returns native calls observable by the spec.
 */
export function nativeRecognizer(text = 'local transcript') {
  const construct = vi.fn<(config: SherpaOnlineRecognizerConfig | SherpaOfflineRecognizerConfig) => void>()
  const acceptWaveform = vi.fn<(input: { sampleRate: number; samples: Float32Array }) => void>()
  const getResult = vi.fn(() => ({ text }))
  class Recognizer {
    constructor(config: SherpaOnlineRecognizerConfig | SherpaOfflineRecognizerConfig) { construct(config) }
    createStream() { return { acceptWaveform, inputFinished() {} } }
    isReady() { return false }
    decode() {}
    getResult() { return getResult() }
  }
  const load = vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue({ OnlineRecognizer: Recognizer, OfflineRecognizer: Recognizer })
  return { load, construct, acceptWaveform, getResult }
}
