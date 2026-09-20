/** Verified model transfers into task-private staging; publication belongs to VoiceResourceStore. */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import unbzip2 from 'unbzip2-stream'
import * as tar from 'tar'
import type { VoiceModelDefinition, VoiceModelTask } from '@deepseek-ai/dsh-voice'

/** Fetch implementation for one transfer. */
export type FetchLike = typeof fetch
/** Extract a verified archive into a private task directory. */
export type ExtractArchive = (archivePath: string, cacheDir: string, signal?: AbortSignal) => Promise<void>
/** Download settings resolved from provider Config. */
export interface DownloadOptions {
  segmentBytes: number
  concurrency: number
  maxAttempts: number
  retryDelayMs: number
  requestTimeoutMs: number
}

type Progress = NonNullable<VoiceModelTask['progress']>
class DownloadProgress {
  current: { state: 'downloading' | 'extracting'; receivedBytes: number; totalBytes: number }
  constructor(totalBytes: number, private readonly changed: (value: Progress) => void) {
    this.current = { state: 'downloading', receivedBytes: 0, totalBytes }
    changed(this.current)
  }
  add(bytes: number): void {
    this.current.receivedBytes += bytes
    this.changed({ ...this.current })
  }
  extracting(bytes: number): void {
    this.current = { state: 'extracting', receivedBytes: bytes, totalBytes: bytes }
    this.changed({ ...this.current })
  }
}

function partPath(partsDir: string, index: number): string {
  return join(partsDir, String(index).padStart(6, '0') + '.part')
}

/**
 * Extract a pinned tar.bz2 archive with the JavaScript streaming implementation.
 * @param archivePath - Verified archive bytes.
 * @param cacheDir - Empty destination owned by the task.
 * @param signal - Host task cancellation.
 */
export async function extractArchiveJs(archivePath: string, cacheDir: string, signal?: AbortSignal): Promise<void> {
  await pipeline(createReadStream(archivePath), unbzip2(), tar.extract({ cwd: cacheDir, strip: 1 }), { signal })
}

class DownloadHttpError extends Error {
  constructor(readonly status: number) {
    super(`download failed: HTTP ${status}`)
  }
}

class DownloadProtocolError extends Error {}

class ArchiveIntegrityError extends DownloadProtocolError {}

function retryableDownloadError(error: unknown): boolean {
  if (error instanceof DownloadProtocolError) return false
  return !(error instanceof DownloadHttpError) || error.status === 408 || error.status === 429 || error.status >= 500
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function retryDownload<T>(
  options: DownloadOptions,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    signal.throwIfAborted()
    try {
      return await operation()
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (attempt >= options.maxAttempts || !retryableDownloadError(error)) throw error
      let delayMs = options.retryDelayMs
      for (let index = 1; index < attempt && delayMs < options.requestTimeoutMs; index += 1) {
        delayMs = delayMs >= options.requestTimeoutMs / 2 ? options.requestTimeoutMs : delayMs * 2
      }
      await waitForRetry(delayMs, signal)
    }
  }
}

interface DownloadIdleTimeout {
  signal: AbortSignal
  touch: () => void
  dispose: () => void
}

function downloadIdleTimeout(timeoutMs: number, operationSignal: AbortSignal): DownloadIdleTimeout {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const abortFromOperation = (): void => { controller.abort(operationSignal.reason) }
  if (operationSignal.aborted) abortFromOperation()
  else operationSignal.addEventListener('abort', abortFromOperation, { once: true })
  const touch = (): void => {
    if (controller.signal.aborted) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      controller.abort(new DOMException('download stalled without progress', 'TimeoutError'))
    }, timeoutMs)
  }
  touch()
  return {
    signal: controller.signal,
    touch,
    dispose: () => {
      controller.abort(new DOMException('download attempt settled', 'AbortError'))
      operationSignal.removeEventListener('abort', abortFromOperation)
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

async function releaseDownloadResponse(response: Response | undefined, idle: DownloadIdleTimeout): Promise<void> {
  try {
    // A locked body belongs to the already-settled pipeline. Header rejection leaves it unlocked.
    if (response?.body !== undefined && response.body !== null && !response.body.locked) {
      try { await response.body.cancel() } catch (_responseAlreadyErrored) {
        // Fetch may already have errored the body; abort below still releases this attempt.
      }
    }
  } finally {
    idle.dispose()
  }
}

async function writeResponseBody(
  progress: DownloadProgress,
  response: Response,
  destination: string,
  signal: AbortSignal,
  expectedBytes?: number,
  onProgress?: () => void,
): Promise<number> {
  if (!response.ok || response.body === null) throw new DownloadHttpError(response.status)
  const temporary = `${destination}.partial`
  let receivedBytes = 0
  let committed = false
  await rm(temporary, { force: true })
  try {
    await pipeline(
      trackProgress(response.body, (bytes) => {
        receivedBytes += bytes
        progress.add(bytes)
        if (expectedBytes !== undefined && receivedBytes > expectedBytes) throw new DownloadProtocolError('download exceeded pinned byte count')
        onProgress?.()
      }),
      createWriteStream(temporary),
      { signal },
    )
    if (expectedBytes !== undefined && receivedBytes !== expectedBytes) {
      throw new Error(`download failed: expected ${expectedBytes} range bytes, received ${receivedBytes}`)
    }
    await rename(temporary, destination)
    committed = true
    return receivedBytes
  } finally {
    if (!committed) progress.add(-receivedBytes)
    await rm(temporary, { force: true })
  }
}

async function downloadArchive(
  definition: VoiceModelDefinition,
  fetchImpl: FetchLike,
  archivePath: string,
  progress: DownloadProgress,
  options: DownloadOptions,
  signal: AbortSignal,
): Promise<number> {
  if (definition.download.type !== 'archive') throw new Error('downloadArchive called for a file-download model')
  const archiveUrl = definition.download.url
  const expectedTotal = definition.approximateBytes
  if (expectedTotal <= 0) {
    return retryDownload(options, signal, async () => {
      const idle = downloadIdleTimeout(options.requestTimeoutMs, signal)
      let response: Response | undefined
      try {
        response = await fetchImpl(archiveUrl, { signal: idle.signal })
        const header = response.headers.get('content-length')
        const total = header === null || header === '' ? 0 : Number(header)
        progress.current.totalBytes = Number.isSafeInteger(total) && total > 0 ? total : 0
        return await writeResponseBody(progress, response, archivePath, idle.signal, undefined, idle.touch)
      } finally {
        await releaseDownloadResponse(response, idle)
      }
    })
  }

  const partsDir = `${archivePath}.parts`
  const segmentCount = Math.ceil(expectedTotal / options.segmentBytes)
  await mkdir(partsDir, { recursive: true })
  const segmentSize = (index: number): number => Math.min(options.segmentBytes, expectedTotal - index * options.segmentBytes)
  const complete = await Promise.all(Array.from({ length: segmentCount }, async (_, index) => {
    const info = await stat(partPath(partsDir, index)).catch(() => undefined)
    return info?.isFile() === true && info.size === segmentSize(index)
  }))
  if (progress.current.state === 'downloading') {
    progress.current.totalBytes = expectedTotal
    progress.current.receivedBytes = complete.reduce((total, ready, index) => total + (ready ? segmentSize(index) : 0), 0)
  }

  const downloadPart = async (index: number, allowWhole: boolean): Promise<'range' | 'whole'> => retryDownload(options, signal, async () => {
    const start = index * options.segmentBytes
    const end = start + segmentSize(index) - 1
    const idleTimeout = downloadIdleTimeout(options.requestTimeoutMs, signal)
    let response: Response | undefined
    try {
      response = await fetchImpl(archiveUrl, {
        headers: { range: `bytes=${start}-${end}` },
        signal: idleTimeout.signal,
      })
      idleTimeout.touch()
      if (response.status === 200) {
        if (!allowWhole) throw new DownloadProtocolError('download failed: server stopped honoring byte ranges')
        await rm(partsDir, { recursive: true, force: true })
        const current = progress.current
        if (current.state === 'downloading') current.receivedBytes = 0
        await writeResponseBody(progress, response, archivePath, idleTimeout.signal, expectedTotal, idleTimeout.touch)
        return 'whole'
      }
      if (response.status !== 206) throw new DownloadHttpError(response.status)
      const expectedRange = `bytes ${start}-${end}/${expectedTotal}`
      const receivedRange = response.headers.get('content-range')
      if (receivedRange !== expectedRange) {
        throw new DownloadProtocolError(`download failed: expected Content-Range ${expectedRange}, received ${receivedRange ?? 'none'}`)
      }
      await writeResponseBody(
        progress, response, partPath(partsDir, index), idleTimeout.signal, segmentSize(index), idleTimeout.touch,
      )
      complete[index] = true
      return 'range'
    } finally {
      await releaseDownloadResponse(response, idleTimeout)
    }
  })

  const firstMissing = complete.findIndex(ready => !ready)
  if (firstMissing !== -1) {
    if (await downloadPart(firstMissing, true) === 'whole') return expectedTotal
    complete[firstMissing] = true
  }
  const missing = complete.flatMap((ready, index) => ready ? [] : [index])
  let cursor = 0
  const workers = Array.from({ length: Math.min(options.concurrency, missing.length) }, async () => {
    while (cursor < missing.length) {
      const index = missing[cursor++]
      if (index !== undefined) await downloadPart(index, false)
    }
  })
  const settled = await Promise.allSettled(workers)
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (rejected !== undefined) throw rejected.reason

  await rm(archivePath, { force: true })
  for (let index = 0; index < segmentCount; index += 1) {
    await pipeline(createReadStream(partPath(partsDir, index)), createWriteStream(archivePath, { flags: 'a' }), { signal })
  }
  return expectedTotal
}

async function sha256File(path: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  const onAbort = (): void => {
    const reason = signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
    stream.destroy(reason)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const chunk of stream) hash.update(chunk as Uint8Array)
    signal.throwIfAborted()
    return hash.digest('hex')
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function verifyArchiveIntegrity(
  definition: VoiceModelDefinition,
  archivePath: string,
  signal: AbortSignal,
): Promise<void> {
  if (definition.download.type !== 'archive') throw new Error('verifyArchiveIntegrity called for a file-download model')
  const actual = await sha256File(archivePath, signal)
  if (actual !== definition.download.sha256) {
    throw new ArchiveIntegrityError(
      `download failed: expected SHA-256 ${definition.download.sha256}, received ${actual}`,
    )
  }
}

/** Download individual model files directly into the cache directory. */
async function downloadFiles(
  definition: VoiceModelDefinition,
  fetchImpl: FetchLike,
  cacheDir: string,
  progress: DownloadProgress,
  options: DownloadOptions,
  signal: AbortSignal,
): Promise<void> {
  if (definition.download.type !== 'files') throw new Error('downloadFiles called for an archive-download model')
  await mkdir(cacheDir, { recursive: true })
  for (const entry of definition.download.entries) {
    signal.throwIfAborted()
    const dest = join(cacheDir, entry.name)
    const info = await stat(dest).catch(() => undefined)
    if (info?.isFile() === true && info.size === entry.bytes && await sha256File(dest, signal) === entry.sha256) {
      progress.add(entry.bytes)
      continue
    }
    await retryDownload(options, signal, async () => {
      const idle = downloadIdleTimeout(options.requestTimeoutMs, signal)
      let response: Response | undefined
      try {
        response = await fetchImpl(entry.url, { signal: idle.signal })
        idle.touch()
        await writeResponseBody(progress, response, dest, idle.signal, entry.bytes, idle.touch)
        const actualHash = await sha256File(dest, idle.signal)
        if (actualHash !== entry.sha256) {
          throw new ArchiveIntegrityError('download failed: pinned file SHA-256 mismatch')
        }
      } finally {
        await releaseDownloadResponse(response, idle)
      }
    })
  }
}

/** Wrap a web stream as an async iterable while tracking byte progress. */
function trackProgress(body: ReadableStream<Uint8Array>, onChunk: (bytes: number) => void): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      const reader = body.getReader()
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          const { done, value } = await reader.read()
          if (done) return { done: true, value: undefined }
          onChunk(value.byteLength)
          return { done: false, value }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          await reader.cancel()
          return { done: true, value: undefined }
        },
      }
    },
  }
}

/**
 * Download and verify pinned bytes without publishing an installation.
 * @param definition - Pinned model manifest.
 * @param cacheDir - Task-private staging directory; never an active generation.
 * @param fetchImpl - HTTP transport.
 * @param extractArchive - Managed archive extractor.
 * @param options - Resolved transfer configuration.
 * @param signal - Host-owned task cancellation.
 * @param changed - Task-local progress publisher.
 */
export async function downloadModelToStaging(
  definition: VoiceModelDefinition, cacheDir: string, fetchImpl: FetchLike,
  extractArchive: ExtractArchive, options: DownloadOptions, signal: AbortSignal,
  changed: (value: Progress) => void,
): Promise<void> {
  const progress = new DownloadProgress(definition.approximateBytes, changed)
  const archivePath = cacheDir + '.tar.bz2'
  await mkdir(cacheDir, { recursive: true })
  try {
    if (definition.download.type === 'archive') {
      const bytes = await downloadArchive(definition, fetchImpl, archivePath, progress, options, signal)
      await verifyArchiveIntegrity(definition, archivePath, signal)
      progress.extracting(bytes)
      await extractArchive(archivePath, cacheDir, signal)
    } else {
      await downloadFiles(definition, fetchImpl, cacheDir, progress, options, signal)
    }
    signal.throwIfAborted()
  } finally {
    await rm(archivePath, { force: true })
    await rm(archivePath + '.parts', { recursive: true, force: true })
  }
}
