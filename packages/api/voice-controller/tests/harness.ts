/** Real Loader composition for desktop Fetch and optional authenticated HTTP voice calls. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Voice, { architectureFilePaths, VoiceModelId } from '@deepseek-ai/dsh-voice'
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

/** Shipped model exercised without a real native binary or model download. */
export const MODEL_ID = 'zh-streaming-zipformer-14m'

/**
 * Load production service rows from a private cordis.yml.
 * @param web - include an actual WebServer listening on an OS-assigned loopback port.
 * @returns context, private home, real carrier clients, and Loader lifecycle controls.
 */
export async function createHarness(web = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-controller-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      sherpaDeps.resetSherpaOnnxCache()
      await rm(root, { recursive: true, force: true })
    }
  })
  vi.stubEnv('DSH_HOME', root)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const configPath = join(root, 'cordis.yml')
  const rows = [
    ...(web ? [{ name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } }] : []),
    { name: '@deepseek-ai/dsh-voice' },
    { name: '@deepseek-ai/dsh-subprocess-local' },
    { name: '@deepseek-ai/dsh-voice-sherpa-onnx', config: { downloadConcurrency: 1, downloadMaxAttempts: 1 } },
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
    ctx, root, origin,
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
 * Seed nonempty native model inputs in this test's private home.
 * @param harness - real voice composition whose roster owns the file names.
 * @returns model cache directory; the provider still validates and adopts these files.
 */
export async function seedModel(harness: Awaited<ReturnType<typeof createHarness>>): Promise<string> {
  const definition = harness.ctx.voice.requireDefinition(VoiceModelId(MODEL_ID))
  const cacheDir = join(harness.root, 'models', 'voice', MODEL_ID)
  for (const file of architectureFilePaths(definition.architecture)) {
    const parts = file.split('/')
    const path = join(cacheDir, ...(parts.length > 1 ? parts.slice(1) : parts))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'native model fixture')
  }
  return cacheDir
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

/**
 * Hold one exact external model URL through cancellation and explicit settlement.
 * @param url - shipped model download URL.
 * @returns external request readiness, abort observation, release, and settlement signals.
 */
export function holdDownload(url: string) {
  const entered = Promise.withResolvers<AbortSignal>()
  const aborted = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const settled = Promise.withResolvers<undefined>()
  let started = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const address = input instanceof Request ? input.url : String(input)
    if (address !== url) throw new Error('unexpected external voice download: ' + address)
    const signal = init?.signal
    if (signal === undefined || signal === null) throw new Error('voice download did not receive cancellation')
    started = true
    const onAbort = (): void => { aborted.resolve(undefined) }
    signal.addEventListener('abort', onAbort, { once: true })
    entered.resolve(signal)
    try {
      await release.promise
      signal.throwIfAborted()
      throw new Error('external voice download released before cancellation')
    } finally {
      signal.removeEventListener('abort', onAbort)
      settled.resolve(undefined)
    }
  })
  onTestFinished(async () => {
    release.resolve(undefined)
    if (started) await settled.promise
  })
  return { entered: entered.promise, aborted: aborted.promise, release: () => { release.resolve(undefined) }, settled: settled.promise }
}
