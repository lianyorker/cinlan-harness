/* oxlint-disable typescript/prefer-promise-reject-errors -- abort test uses the signal reason. */
/** Model download/cache lifecycle tests against a real tiny .tar.bz2 fixture and a stubbed fetch. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceModelId } from '@deepseek-ai/dsh-voice'
import type { VoiceModelDefinition } from '@deepseek-ai/dsh-voice'
import { ensureModelDownloaded, extractArchiveJs, forgetModel, modelCacheDir, readModelStatus } from '../src/model-cache.ts'
import type { DownloadOptions } from '../src/model-cache.ts'

const FIXTURE_ARCHIVE = new URL('./fixtures/fixture-model.tar.bz2', import.meta.url)

function downloadOptions(concurrency: number, maxAttempts = 2): DownloadOptions {
  return { segmentBytes: 64, concurrency, maxAttempts, retryDelayMs: 1, requestTimeoutMs: 10_000 }
}

function rangeResponse(bytes: Uint8Array, start: number, end: number): Response {
  return new Response(Buffer.from(bytes.subarray(start, end + 1)), {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
  })
}

function definition(): VoiceModelDefinition {
  return {
    id: VoiceModelId('fixture-model'),
    name: 'fixture-model',
    kind: 'streaming',
    approximateBytes: 0,
    archiveUrl: 'https://example.invalid/fixture-model.tar.bz2',
    archiveSha256: '4c60d3d6068e1f601433271f210feb2db99f548d0e83a038b29451d801dc91f7',
    files: {
      encoder: 'fixture-model/encoder.onnx',
      decoder: 'fixture-model/decoder.onnx',
      joiner: 'fixture-model/joiner.onnx',
      tokens: 'fixture-model/tokens.txt',
    },
  }
}

/** A minimal fetch stub whose Response streams the real fixture archive bytes. */
async function fixtureFetch(): Promise<Response> {
  const bytes = await readFile(FIXTURE_ARCHIVE)
  const body = Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>
  return new Response(body, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
}

describe('model-cache', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-voice-cache-'))
    vi.stubEnv('DSH_HOME', home)
  })

  afterEach(async () => {
    await forgetModel('fixture-model')
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })

  it('reports not-downloaded before any download and resolves the model cache directory under $DSH_HOME', () => {
    const model = definition()
    expect(modelCacheDir(model.id)).toBe(join(home, 'models', 'voice', model.id))
  })

  it('downloads, decompresses, and extracts the archive, then reports ready', async () => {
    const model = definition()
    await expect(readModelStatus(model)).resolves.toEqual({ state: 'not-downloaded' })
    const cacheDir = await ensureModelDownloaded(model, fixtureFetch)
    expect(cacheDir).toBe(modelCacheDir(model.id))
    const tokens = await readFile(join(cacheDir, 'tokens.txt'), 'utf8')
    expect(tokens).toBe('hello world token file')
    await expect(readModelStatus(model)).resolves.toEqual({ state: 'ready', cacheDir })
  })

  it('is idempotent: a second call resolves without re-fetching once ready', async () => {
    const model = definition()
    await ensureModelDownloaded(model, fixtureFetch)
    const fetchSpy = vi.fn(fixtureFetch)
    const cacheDir = await ensureModelDownloaded(model, fetchSpy)
    expect(cacheDir).toBe(modelCacheDir(model.id))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('retains a download failure after cleanup settles', async () => {
    const model = definition()
    const failingFetch = vi.fn(async (): Promise<Response> => new Response(null, { status: 404 }))
    await expect(ensureModelDownloaded(model, failingFetch)).rejects.toThrow(/download failed: HTTP 404/)
    await expect(readModelStatus(model)).resolves.toEqual({ state: 'failed', message: 'download failed: HTTP 404' })
  })

  it('reports downloading progress while the archive request is in flight', async () => {
    const model = definition()
    let resolveFetch!: (response: Response) => void
    const gate = new Promise<Response>((resolve) => { resolveFetch = resolve })
    const gatedFetch = vi.fn(() => gate)
    const download = ensureModelDownloaded(model, gatedFetch)
    await vi.waitFor(async () => {
      await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'downloading' })
    })
    resolveFetch(await fixtureFetch())
    await download
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('switches to extracting with complete byte counts and becomes ready only when extraction settles', async () => {
    const model = definition()
    const totalBytes = (await readFile(FIXTURE_ARCHIVE)).byteLength
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const extractor = vi.fn(async (archivePath: string, cacheDir: string) => {
      await gate
      await extractArchiveJs(archivePath, cacheDir)
    })
    const download = ensureModelDownloaded(model, fixtureFetch, extractor)
    await vi.waitFor(async () => {
      await expect(readModelStatus(model)).resolves.toEqual({ state: 'extracting', receivedBytes: totalBytes, totalBytes })
    })
    release()
    await download
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('shares one installation through extraction failure and publishes failure only after cleanup', async () => {
    const model = definition()
    const cacheDir = modelCacheDir(model.id)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const extractor = vi.fn(async (_archivePath: string, destination: string) => {
      for (const path of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']) {
        await writeFile(join(destination, path), 'partial')
      }
      await gate
      throw new Error('extract corrupt')
    })
    const fetchSpy = vi.fn(fixtureFetch)
    const first = ensureModelDownloaded(model, fetchSpy, extractor)
    await vi.waitFor(async () => {
      await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'extracting' })
    })
    const second = ensureModelDownloaded(model, fetchSpy, extractor)
    expect(second).toBe(first)
    await expect(readFile(join(cacheDir, 'encoder.onnx'), 'utf8')).resolves.toBe('partial')
    release()
    await expect(first).rejects.toThrow('extract corrupt')
    await expect(second).rejects.toThrow('extract corrupt')
    expect(fetchSpy).toHaveBeenCalledOnce()
    await expect(readFile(join(cacheDir, 'encoder.onnx'))).rejects.toThrow()
    await expect(readModelStatus(model)).resolves.toEqual({ state: 'failed', message: 'extract corrupt' })
  })


  it('downloads sized archives as concurrent HTTP ranges', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    const ranges: string[] = []
    const rangedFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range')
      if (range === null) throw new Error('missing range')
      ranges.push(range)
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match === null) throw new Error('invalid range')
      const start = Number(match[1])
      const end = Number(match[2])
      return rangeResponse(bytes, start, end)
    }) as typeof fetch

    await ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(3))

    expect(ranges).toHaveLength(Math.ceil(bytes.byteLength / 64))
    expect(ranges[0]).toBe('bytes=0-63')
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('keeps an active range alive when its total transfer exceeds the idle timeout', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    const rangedFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal
      if (signal === null || signal === undefined) throw new Error('missing abort signal')
      const chunkBytes = Math.ceil(bytes.byteLength / 4)
      const chunks = Array.from({ length: 4 }, (_, index) => bytes.subarray(
        index * chunkBytes,
        Math.min((index + 1) * chunkBytes, bytes.byteLength),
      )).filter(chunk => chunk.byteLength > 0)
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const onAbort = (): void => { controller.error(signal.reason) }
          signal.addEventListener('abort', onAbort, { once: true })
          for (const chunk of chunks) {
            controller.enqueue(chunk)
            await new Promise((resolve) => { setTimeout(resolve, 40) })
          }
          signal.removeEventListener('abort', onAbort)
          controller.close()
        },
      })
      return new Response(body, {
        status: 206,
        headers: { 'content-range': `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` },
      })
    }) as typeof fetch

    await ensureModelDownloaded(model, rangedFetch, extractArchiveJs, {
      segmentBytes: bytes.byteLength,
      concurrency: 1,
      maxAttempts: 1,
      retryDelayMs: 1,
      requestTimeoutMs: 70,
    })

    expect(rangedFetch).toHaveBeenCalledOnce()
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('retries a transient range failure within one installation', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    let failSecond = true
    const calls = new Map<string, number>()
    const rangedFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      calls.set(range, (calls.get(range) ?? 0) + 1)
      if (range === 'bytes=64-127' && failSecond) {
        failSecond = false
        throw new Error('connection reset')
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match === null) throw new Error('invalid range')
      return rangeResponse(bytes, Number(match[1]), Number(match[2]))
    }) as typeof fetch

    await ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1))

    expect(calls.get('bytes=0-63')).toBe(1)
    expect(calls.get('bytes=64-127')).toBe(2)
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it.each([429, 503])('retries retryable HTTP %s range responses', async (status) => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    let failed = false
    const rangedFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      if (!failed) {
        failed = true
        return new Response(null, { status })
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match === null) throw new Error('invalid range')
      return rangeResponse(bytes, Number(match[1]), Number(match[2]))
    }) as typeof fetch

    await ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1))

    expect(rangedFetch).toHaveBeenCalledTimes(Math.ceil(bytes.byteLength / 64) + 1)
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('rejects a mismatched Content-Range without retrying', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    const rangedFetch = vi.fn(async (): Promise<Response> => new Response(bytes.subarray(0, 64), {
      status: 206,
      headers: { 'content-range': `bytes 1-64/${bytes.byteLength}` },
    })) as typeof fetch

    await expect(ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1))).rejects.toThrow(
      `download failed: expected Content-Range bytes 0-63/${bytes.byteLength}, received bytes 1-64/${bytes.byteLength}`,
    )

    expect(rangedFetch).toHaveBeenCalledOnce()
  })

  it('does not retry a non-retryable HTTP range response', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    const rangedFetch = vi.fn(async (): Promise<Response> => new Response(null, { status: 404 })) as typeof fetch

    await expect(ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1))).rejects.toThrow('download failed: HTTP 404')

    expect(rangedFetch).toHaveBeenCalledOnce()
  })

  it('keeps completed ranges after failure and resumes without fetching them again', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    let failSecond = true
    const calls = new Map<string, number>()
    const rangedFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      calls.set(range, (calls.get(range) ?? 0) + 1)
      if (range === 'bytes=64-127' && failSecond) throw new Error('connection reset')
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match === null) throw new Error('invalid range')
      return rangeResponse(bytes, Number(match[1]), Number(match[2]))
    }) as typeof fetch

    await expect(ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1, 1))).rejects.toThrow('connection reset')
    failSecond = false
    await ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1, 1))

    expect(calls.get('bytes=0-63')).toBe(1)
    expect(calls.get('bytes=64-127')).toBe(2)
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('rejects same-sized corrupted resumed parts, discards them, and redownloads clean bytes', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    let failSecond = true
    const calls = new Map<string, number>()
    const rangedFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      calls.set(range, (calls.get(range) ?? 0) + 1)
      if (range === 'bytes=64-127' && failSecond) throw new Error('connection reset')
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match === null) throw new Error('invalid range')
      return rangeResponse(bytes, Number(match[1]), Number(match[2]))
    }) as typeof fetch

    await expect(ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1, 1))).rejects.toThrow('connection reset')
    const partsDir = join(home, 'models', 'voice', '.fixture-model.download.parts')
    await writeFile(join(partsDir, '000000.part'), Buffer.alloc(64, 0x5a))
    failSecond = false

    await expect(ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1, 1))).rejects.toThrow(
      `download failed: expected SHA-256 ${model.archiveSha256}`,
    )
    await expect(readFile(join(partsDir, '000000.part'))).rejects.toThrow()

    await ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1, 1))
    expect(calls.get('bytes=0-63')).toBe(2)
    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('falls back to a whole response when a resumed server stops honoring ranges', async () => {
    const bytes = await readFile(FIXTURE_ARCHIVE)
    const model = { ...definition(), approximateBytes: bytes.byteLength }
    let failSecond = true
    const rangedFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      if (range === 'bytes=64-127' && failSecond) throw new Error('connection reset')
      if (!failSecond) return new Response(bytes, { status: 200 })
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (match === null) throw new Error('invalid range')
      return rangeResponse(bytes, Number(match[1]), Number(match[2]))
    }) as typeof fetch

    await expect(ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1, 1))).rejects.toThrow('connection reset')
    failSecond = false
    await ensureModelDownloaded(model, rangedFetch, extractArchiveJs, downloadOptions(1, 1))

    await expect(readModelStatus(model)).resolves.toMatchObject({ state: 'ready' })
  })

  it('cancels an active download before deleting its cache', async () => {
    const model = definition()
    let aborted = false
    const stalledFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal
      if (signal === null || signal === undefined) throw new Error('missing abort signal')
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        }, { once: true })
      })
    }) as typeof fetch

    const download = ensureModelDownloaded(model, stalledFetch)
    const rejected = expect(download).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => { expect(stalledFetch).toHaveBeenCalledOnce() })
    await forgetModel(model.id)
    await rejected

    expect(aborted).toBe(true)
    await expect(readModelStatus(model)).resolves.toEqual({ state: 'not-downloaded' })
  })

  it('cancels active extraction and waits for it before deleting the cache', async () => {
    const model = definition()
    let extractionStarted!: () => void
    const started = new Promise<void>((resolve) => { extractionStarted = resolve })
    let aborted = false
    const extractor = vi.fn(async (_archivePath: string, _cacheDir: string, signal?: AbortSignal) => {
      if (signal === undefined) throw new Error('missing abort signal')
      extractionStarted()
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        }, { once: true })
      })
    })

    const download = ensureModelDownloaded(model, fixtureFetch, extractor)
    const rejected = expect(download).rejects.toMatchObject({ name: 'AbortError' })
    await started
    await forgetModel(model.id)
    await rejected

    expect(aborted).toBe(true)
    await expect(readModelStatus(model)).resolves.toEqual({ state: 'not-downloaded' })
  })

  it('adopts a complete older extraction that lacks only the ready marker', async () => {
    const model = definition()
    const cacheDir = modelCacheDir(model.id)
    await mkdir(cacheDir, { recursive: true })
    for (const path of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']) {
      await writeFile(join(cacheDir, path), 'complete')
    }
    await expect(readModelStatus(model)).resolves.toEqual({ state: 'ready', cacheDir })
  })
})
