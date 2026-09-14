/* oxlint-disable typescript/no-extraneous-class, typescript/no-unsafe-assignment */
/** Integration test for the /voice/api route mounted on a real WebServer. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Voice from '@deepseek-ai/dsh-voice'
import * as sherpaDeps from '../src/sherpa-deps.ts'
import { apply, inject, nativeTarExtractor } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { modelCacheDir } from '../src/model-cache.ts'

let ctx: Context | undefined
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-voice-sherpa-onnx-'))
  vi.stubEnv('DSH_HOME', home)
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  sherpaDeps.resetSherpaOnnxCache()
  await rm(home, { recursive: true, force: true })
})

async function mount(): Promise<{ port: number }> {
  ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Voice)
  ctx.provide('subprocess', { spawn: vi.fn() } as never)
  await ctx.plugin({ inject, apply })
  return { port: ctx.webServer.port }
}

async function post(port: number, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: 'POST',
    headers: { host: `127.0.0.1:${String(port)}` },
    body: JSON.stringify(body),
  })
  return { status: response.status, json: await response.json() }
}

describe('voice-sherpa-onnx: /voice/api route', () => {
  it('declares the two services it drives', () => {
    expect(inject).toEqual(['voice', 'webServer', 'subprocess'])
  })

  it.each([
    'downloadSegmentBytes',
    'downloadConcurrency',
    'downloadMaxAttempts',
    'downloadRetryDelayMs',
    'downloadRequestTimeoutMs',
  ] satisfies Array<keyof Config>)('rejects invalid %s configuration before mounting', (key) => {
    expect(() => { apply({} as Context, { [key]: 0 }) }).toThrow(`voice-sherpa-onnx: ${key} must be a positive safe integer`)
  })


  it('runs native tar extraction through the managed subprocess seam', async () => {
    const stderr = { readFrom: vi.fn(() => ({ text: '', nextOffset: 0, lossy: false })) }
    const spawn = vi.fn(() => ({ done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stderr } }))
    const extractor = nativeTarExtractor({ subprocess: { spawn } } as unknown as Context)
    const signal = new AbortController().signal
    await expect(extractor('model.tar.bz2', 'cache-dir', signal)).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['tar', '-xjf', 'model.tar.bz2', '-C', 'cache-dir', '--strip-components', '1'],
      cwd: 'cache-dir',
      signal,
    }))
  })

  it('surfaces native tar stderr when extraction fails', async () => {
    const stderr = { readFrom: vi.fn(() => ({ text: 'corrupt archive', nextOffset: 15, lossy: false })) }
    const spawn = vi.fn(() => ({ done: Promise.resolve({ exitCode: 1, signal: null }), collected: { stderr } }))
    const extractor = nativeTarExtractor({ subprocess: { spawn } } as unknown as Context)
    await expect(extractor('model.tar.bz2', 'cache-dir')).rejects.toThrow(/corrupt archive/)
  })

  it('reports engine.status ok when the native binding loads', async () => {
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue({ OnlineRecognizer: class { readonly marker = true } } as never)
    const { port } = await mount()
    const { status, json } = await post(port, '/voice/api/engine.status', {})
    expect(status).toBe(200)
    expect(json).toMatchObject({ ok: true, value: { ok: true } })
  })

  it('reports engine.status with a repair command when the native binding is absent', async () => {
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue(null)
    vi.spyOn(sherpaDeps, 'sherpaOnnxLoadCause').mockReturnValue(new Error('native module missing'))
    const { port } = await mount()
    const { status, json } = await post(port, '/voice/api/engine.status', {})
    expect(status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      value: {
        ok: false,
        cause: 'native module missing',
        command: expect.stringContaining('dsh plugin --profile'),
        note: expect.stringContaining('allowBuilds: sherpa-onnx-node: true'),
      },
    })
  })

  it('lists the shipped models as not-downloaded before any request', async () => {
    const { port } = await mount()
    const { status, json } = await post(port, '/voice/api/models.list', {})
    expect(status).toBe(200)
    const models = (json as { value: { models: { definition: { id: string }; status: { state: string } }[] } }).value.models
    expect(models.map(model => model.definition.id)).toEqual(['zh-streaming-zipformer-14m', 'bilingual-streaming-zipformer'])
    expect(models.every(model => model.status.state === 'not-downloaded')).toBe(true)
  })


  it('removes a downloaded model through the loopback route', async () => {
    const { port } = await mount()
    const cacheDir = modelCacheDir('zh-streaming-zipformer-14m')
    await import('node:fs/promises').then(fs => fs.mkdir(cacheDir, { recursive: true }))
    await import('node:fs/promises').then(fs => fs.writeFile(join(cacheDir, '.dsh-voice-ready'), ''))

    const removed = await post(port, '/voice/api/models.remove', { modelId: 'zh-streaming-zipformer-14m' })
    expect(removed).toMatchObject({ status: 200, json: { ok: true, value: {} } })
    const listed = await post(port, '/voice/api/models.list', {})
    const models = (listed.json as { value: { models: { definition: { id: string }; status: { state: string } }[] } }).value.models
    expect(models.find(model => model.definition.id === 'zh-streaming-zipformer-14m')?.status.state).toBe('not-downloaded')
  })

  it('aborts an active model download and waits for quiescence during provider disposal', async () => {
    const requestFetch = globalThis.fetch
    let started!: () => void
    const archiveStarted = new Promise<void>((resolve) => { started = resolve })
    let aborted = false
    const fetchMock: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith('http://127.0.0.1:')) return requestFetch(input, init)
      const signal = init?.signal
      if (signal === null || signal === undefined) throw new Error('missing abort signal')
      started()
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        }, { once: true })
      })
    }
    vi.stubGlobal('fetch', fetchMock)
    const { port } = await mount()
    const request = post(port, '/voice/api/models.download', { modelId: 'zh-streaming-zipformer-14m' })
    const settledRequest = Promise.allSettled([request])
    await archiveStarted

    const disposing = ctx?.fiber.dispose()
    ctx = undefined
    await disposing
    await settledRequest

    expect(aborted).toBe(true)
  })

  it('rejects transcribe for a model that is not downloaded', async () => {
    const { port } = await mount()
    const { status, json } = await post(port, '/voice/api/transcribe', {
      modelId: 'zh-streaming-zipformer-14m',
      pcm16kMonoBase64: Buffer.alloc(4).toString('base64'),
    })
    expect(status).toBe(400)
    expect(json).toMatchObject({ ok: false, error: { code: 'bad-request', message: expect.stringContaining('is not downloaded') } })
  })

  it('rejects an unknown model id', async () => {
    const { port } = await mount()
    const { status, json } = await post(port, '/voice/api/models.download', { modelId: 'missing' })
    expect(status).toBe(404)
    expect(json).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('rejects a request whose Host header is not loopback', async () => {
    const { port } = await mount()
    // undici's fetch always sends the real connection authority as Host and
    // ignores an explicit override, so this fence test uses raw http.request
    // to forge a non-loopback Host header the way a DNS-rebinding attempt would.
    const { get } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = get({
        host: '127.0.0.1',
        port,
        path: '/voice/api/models.list',
        method: 'POST',
        headers: { host: 'example.com' },
      }, (res) => { resolve(res.statusCode ?? 0) })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('rejects a non-POST method', async () => {
    const { port } = await mount()
    const response = await fetch(`http://127.0.0.1:${String(port)}/voice/api/models.list`, {
      headers: { host: `127.0.0.1:${String(port)}` },
    })
    expect(response.status).toBe(405)
  })

  it('completes transcribe end-to-end once a model is downloaded, degrading with VOICE_ENGINE_DEGRADED when the native binding is absent', async () => {
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue(null)
    vi.spyOn(sherpaDeps, 'sherpaOnnxLoadCause').mockReturnValue(new Error('native module missing'))
    const { port } = await mount()
    const cacheDir = modelCacheDir('zh-streaming-zipformer-14m')
    await import('node:fs/promises').then(fs => fs.mkdir(cacheDir, { recursive: true }))
    await import('node:fs/promises').then(fs => fs.writeFile(join(cacheDir, '.dsh-voice-ready'), ''))
    const { status, json } = await post(port, '/voice/api/transcribe', {
      modelId: 'zh-streaming-zipformer-14m',
      pcm16kMonoBase64: Buffer.alloc(4).toString('base64'),
    })
    expect(status).toBe(500)
    expect(json).toMatchObject({
      ok: false,
      error: { code: 'VOICE_ENGINE_DEGRADED', message: expect.stringContaining('native module missing') },
    })
  })
})
