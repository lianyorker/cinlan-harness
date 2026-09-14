/**
 * Model download and extraction cache under `$DSH_HOME/models/voice/<id>/`.
 * Archive download and extraction are separate lifecycle phases: bytes stream
 * to a temporary archive while status is `downloading`, then status moves to
 * `extracting` while an injected extractor installs the model. A ready
 * sentinel is written only after extraction settles, so a crashed or aborted
 * operation never looks ready on the next status read.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import unbzip2 from 'unbzip2-stream'
import * as tar from 'tar'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { VoiceModelDefinition, VoiceModelStatus } from '@deepseek-ai/dsh-voice'

/** Sentinel filename marking a fully extracted, ready model directory. */
export const READY_MARKER = '.dsh-voice-ready'

/** Fetch function, injectable for tests (defaults to the global fetch). */
export type FetchLike = typeof fetch

/** Extract one downloaded tar.bz2 archive into its prepared cache directory. */
export type ExtractArchive = (archivePath: string, cacheDir: string, signal?: AbortSignal) => Promise<void>

/** Download partition settings resolved by the Provider. */
export interface DownloadOptions {
  /** Maximum bytes requested by one HTTP range. */
  segmentBytes: number
  /** Maximum concurrent HTTP range requests. */
  concurrency: number
  /** Maximum attempts for one range after retryable failures. */
  maxAttempts: number
  /** Initial exponential-backoff delay after a retryable failure. */
  retryDelayMs: number
  /** Abort a range request after this duration without response bytes. */
  requestTimeoutMs: number
}

type InFlightState =
  | { state: 'downloading'; receivedBytes: number; totalBytes: number }
  | { state: 'extracting'; receivedBytes: number; totalBytes: number }

/**
 * Resolve the absolute cache directory for one model under the Harness home.
 * @param modelId - opaque model identifier used as the cache directory name.
 * @returns absolute model cache directory.
 */
export function modelCacheDir(modelId: string): string {
  return dshHomePath('models', 'voice', modelId)
}

/** Temporary archive path kept outside the destination directory being extracted. */
function modelArchivePath(modelId: string): string {
  return dshHomePath('models', 'voice', `.${modelId}.download.tar.bz2`)
}

function modelPartsDir(modelId: string): string {
  return dshHomePath('models', 'voice', `.${modelId}.download.parts`)
}

function partPath(partsDir: string, index: number): string {
  return join(partsDir, `${String(index).padStart(6, '0')}.part`)
}

/** Per-model in-flight download/extraction state for concurrent status reads. */
const inFlight = new Map<string, InFlightState>()
interface Installation {
  readonly controller: AbortController
  readonly promise: Promise<string>
}

/** One operation owns each model from the initial cache check through terminal cleanup. */
const installations = new Map<string, Installation>()
/** Last settled failure, retained until the next explicit retry. */
const failures = new Map<string, string>()

/**
 * Pure-JavaScript tar.bz2 extractor used by focused tests and as an explicit
 * fallback. Production passes a native-tar extractor through the Provider to
 * avoid high CPU and long completion delays on large model archives.
 * @param archivePath - downloaded tar.bz2 archive.
 * @param cacheDir - prepared destination directory.
 * @param signal - optional installation cancellation signal.
 */
export async function extractArchiveJs(archivePath: string, cacheDir: string, signal?: AbortSignal): Promise<void> {
  await pipeline(createReadStream(archivePath), unbzip2(), tar.extract({ cwd: cacheDir, strip: 1 }), { signal })
}

function extractedPath(cacheDir: string, archivedPath: string): string {
  return join(cacheDir, ...archivedPath.split('/').slice(1))
}

async function requiredModelFilesReady(definition: VoiceModelDefinition, cacheDir: string): Promise<boolean> {
  return (await Promise.all(Object.values(definition.files).map(async (path) => {
    const info = await stat(extractedPath(cacheDir, path)).catch(() => undefined)
    return info?.isFile() === true && info.size > 0
  }))).every(Boolean)
}

async function readInstalledModelStatus(definition: VoiceModelDefinition): Promise<VoiceModelStatus> {
  const cacheDir = modelCacheDir(definition.id)
  const marked = await stat(join(cacheDir, READY_MARKER)).then(() => true, () => false)
  if (marked) return { state: 'ready', cacheDir }
  if (await requiredModelFilesReady(definition, cacheDir)) {
    await writeFile(join(cacheDir, READY_MARKER), '')
    return { state: 'ready', cacheDir }
  }
  return { state: 'not-downloaded' }
}

/**
 * Current cache status of one model. A complete pre-marker extraction from an
 * older Host is adopted by validating every required non-empty model file and
 * writing the ready sentinel, avoiding a full re-download after restart.
 * @param definition - model identity and required file set.
 * @returns live progress, retained failure, ready cache path, or not-downloaded state.
 */
export async function readModelStatus(definition: VoiceModelDefinition): Promise<VoiceModelStatus> {
  const progress = inFlight.get(definition.id)
  if (progress !== undefined) return progress
  const failure = failures.get(definition.id)
  if (failure !== undefined) return { state: 'failed', message: failure }
  return readInstalledModelStatus(definition)
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

function updateDownloadProgress(modelId: string, bytes: number): void {
  const current = inFlight.get(modelId)
  if (current?.state === 'downloading') current.receivedBytes += bytes
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
      operationSignal.removeEventListener('abort', abortFromOperation)
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

async function writeResponseBody(
  modelId: string,
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
        updateDownloadProgress(modelId, bytes)
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
    if (!committed) updateDownloadProgress(modelId, -receivedBytes)
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function downloadArchive(
  definition: VoiceModelDefinition,
  fetchImpl: FetchLike,
  archivePath: string,
  options: DownloadOptions | undefined,
  signal: AbortSignal,
): Promise<number> {
  const expectedTotal = definition.approximateBytes
  if (expectedTotal <= 0) {
    const response = await fetchImpl(definition.archiveUrl, { signal })
    const header = response.headers.get('content-length')
    const total = header === null || header === '' ? expectedTotal : Number(header)
    const progress = inFlight.get(definition.id)
    if (progress?.state === 'downloading') progress.totalBytes = total
    return writeResponseBody(definition.id, response, archivePath, signal)
  }

  if (options === undefined) throw new Error('segmented download options are required for a sized model archive')
  const partsDir = modelPartsDir(definition.id)
  const segmentCount = Math.ceil(expectedTotal / options.segmentBytes)
  await mkdir(partsDir, { recursive: true })
  const segmentSize = (index: number): number => Math.min(options.segmentBytes, expectedTotal - index * options.segmentBytes)
  const complete = await Promise.all(Array.from({ length: segmentCount }, async (_, index) => {
    const info = await stat(partPath(partsDir, index)).catch(() => undefined)
    return info?.isFile() === true && info.size === segmentSize(index)
  }))
  const progress = inFlight.get(definition.id)
  if (progress?.state === 'downloading') {
    progress.totalBytes = expectedTotal
    progress.receivedBytes = complete.reduce((total, ready, index) => total + (ready ? segmentSize(index) : 0), 0)
  }

  const downloadPart = async (index: number, allowWhole: boolean): Promise<'range' | 'whole'> => retryDownload(options, signal, async () => {
    const start = index * options.segmentBytes
    const end = start + segmentSize(index) - 1
    const idleTimeout = downloadIdleTimeout(options.requestTimeoutMs, signal)
    try {
      const response = await fetchImpl(definition.archiveUrl, {
        headers: { range: `bytes=${start}-${end}` },
        signal: idleTimeout.signal,
      })
      idleTimeout.touch()
      if (response.status === 200) {
        if (!allowWhole) throw new DownloadProtocolError('download failed: server stopped honoring byte ranges')
        await rm(partsDir, { recursive: true, force: true })
        const current = inFlight.get(definition.id)
        if (current?.state === 'downloading') current.receivedBytes = 0
        await writeResponseBody(definition.id, response, archivePath, idleTimeout.signal, expectedTotal, idleTimeout.touch)
        return 'whole'
      }
      if (response.status !== 206) throw new DownloadHttpError(response.status)
      const expectedRange = `bytes ${start}-${end}/${expectedTotal}`
      const receivedRange = response.headers.get('content-range')
      if (receivedRange !== expectedRange) {
        throw new DownloadProtocolError(`download failed: expected Content-Range ${expectedRange}, received ${receivedRange ?? 'none'}`)
      }
      await writeResponseBody(
        definition.id, response, partPath(partsDir, index), idleTimeout.signal, segmentSize(index), idleTimeout.touch,
      )
      complete[index] = true
      return 'range'
    } finally {
      idleTimeout.dispose()
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
  const actual = await sha256File(archivePath, signal)
  if (actual !== definition.archiveSha256) {
    throw new ArchiveIntegrityError(
      `download failed: expected SHA-256 ${definition.archiveSha256}, received ${actual}`,
    )
  }
}

async function installModel(
  definition: VoiceModelDefinition,
  fetchImpl: FetchLike,
  extractArchive: ExtractArchive,
  downloadOptions: DownloadOptions | undefined,
  signal: AbortSignal,
): Promise<string> {
  const cacheDir = modelCacheDir(definition.id)
  const archivePath = modelArchivePath(definition.id)
  failures.delete(definition.id)
  inFlight.set(definition.id, { state: 'downloading', receivedBytes: 0, totalBytes: definition.approximateBytes })
  try {
    const status = await readInstalledModelStatus(definition)
    if (status.state === 'ready') return status.cacheDir
    await rm(cacheDir, { recursive: true, force: true })
    await rm(archivePath, { force: true })
    await mkdir(dirname(archivePath), { recursive: true })
    const totalBytes = await downloadArchive(definition, fetchImpl, archivePath, downloadOptions, signal)
    await verifyArchiveIntegrity(definition, archivePath, signal)

    inFlight.set(definition.id, { state: 'extracting', receivedBytes: totalBytes, totalBytes })
    await mkdir(cacheDir, { recursive: true })
    await extractArchive(archivePath, cacheDir, signal)
    signal.throwIfAborted()
    await writeFile(join(cacheDir, READY_MARKER), '')
    await rm(modelPartsDir(definition.id), { recursive: true, force: true })
    return cacheDir
  } catch (error) {
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    if (error instanceof ArchiveIntegrityError) {
      await rm(modelPartsDir(definition.id), { recursive: true, force: true }).catch(() => {})
    }
    if (signal.aborted) failures.delete(definition.id)
    else failures.set(definition.id, error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    await rm(archivePath, { force: true }).catch(() => {})
    inFlight.delete(definition.id)
  }
}

/**
 * Download and install one model archive. Idempotent when already ready;
 * concurrent callers await the same operation through terminal cleanup.
 * @param definition - model download source and identity.
 * @param fetchImpl - injectable fetch.
 * @param extractArchive - extractor; production supplies native tar.
 * @param downloadOptions - required for sized archives; controls range size, concurrency, retry, and timeout behavior.
 * @returns absolute ready cache directory.
 */
export function ensureModelDownloaded(
  definition: VoiceModelDefinition,
  fetchImpl: FetchLike = fetch,
  extractArchive: ExtractArchive = extractArchiveJs,
  downloadOptions?: DownloadOptions,
): Promise<string> {
  const active = installations.get(definition.id)
  if (active !== undefined) return active.promise
  const controller = new AbortController()
  const promise = installModel(definition, fetchImpl, extractArchive, downloadOptions, controller.signal)
  const installation = { controller, promise }
  installations.set(definition.id, installation)
  void promise.then(
    () => { if (installations.get(definition.id) === installation) installations.delete(definition.id) },
    () => { if (installations.get(definition.id) === installation) installations.delete(definition.id) },
  )
  return promise
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
 * Abort active installations and wait until their download or extraction work settles.
 * Completed range parts remain available for a later resume.
 * @param modelIds - models owned by the disposing provider.
 */
export async function cancelModelInstallations(modelIds: Iterable<string>): Promise<void> {
  const active = [...new Set(modelIds)].flatMap((modelId) => {
    const installation = installations.get(modelId)
    return installation === undefined ? [] : [installation]
  })
  for (const installation of active) {
    installation.controller.abort(new DOMException('voice model installation cancelled', 'AbortError'))
  }
  await Promise.allSettled(active.map(installation => installation.promise))
}

/**
 * Cancel an active installation, wait for quiescence, and remove its complete cache and resumable parts.
 * @param modelId - model whose archive, cache, retained parts, and failure are removed.
 */
export async function forgetModel(modelId: string): Promise<void> {
  await cancelModelInstallations([modelId])
  installations.delete(modelId)
  failures.delete(modelId)
  inFlight.delete(modelId)
  await rm(modelCacheDir(modelId), { recursive: true, force: true })
  await rm(modelArchivePath(modelId), { force: true })
  await rm(modelPartsDir(modelId), { recursive: true, force: true })
}
