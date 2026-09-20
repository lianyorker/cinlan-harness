/** Task-private transfers against controlled loopback HTTP and a real tiny archive. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { VoiceModelId } from '@deepseek-ai/dsh-voice'
import type { VoiceModelDefinition, VoiceModelTask } from '@deepseek-ai/dsh-voice'
import { httpFixture, modelFixture } from '../../../api/voice-controller/tests/harness.ts'
import { downloadModelToStaging, extractArchiveJs } from '../src/model-cache.ts'
import type { DownloadOptions } from '../src/model-cache.ts'

const FIXTURE_ARCHIVE = new URL('./fixtures/fixture-model.tar.bz2', import.meta.url)
const OPTIONS: DownloadOptions = { segmentBytes: 64, concurrency: 3, maxAttempts: 1, retryDelayMs: 1, requestTimeoutMs: 10_000 }

async function staging() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-transfer-'))
  const controller = new AbortController()
  const transfers = new Set<Promise<void>>()
  onTestFinished(async () => {
    controller.abort()
    await Promise.allSettled(transfers)
    await rm(root, { recursive: true, force: true })
  })
  const progress: NonNullable<VoiceModelTask['progress']>[] = []
  const directory = join(root, 'task-private')
  return {
    root, directory, controller, progress,
    download(definition: VoiceModelDefinition, options = OPTIONS) {
      const transfer = downloadModelToStaging(definition, directory, fetch, extractArchiveJs, options, controller.signal,
        value => progress.push({ ...value }))
      transfers.add(transfer)
      return transfer
    },
  }
}

async function archiveFixture(handler?: (request: IncomingMessage, response: ServerResponse, bytes: Buffer) => void) {
  const bytes = await readFile(FIXTURE_ARCHIVE)
  const ranges: string[] = []
  const server = await httpFixture((request, response) => {
    ranges.push(request.headers.range ?? '')
    if (handler !== undefined) handler(request, response, bytes)
    else serveRange(request, response, bytes)
  })
  const definition: VoiceModelDefinition = {
    id: VoiceModelId('fixture-archive'), name: 'Tiny archive', description: 'Pinned archive fixture', recommended: false,
    kind: 'streaming', approximateBytes: bytes.byteLength,
    download: { type: 'archive', url: server.origin + '/model.tar.bz2', sha256: createHash('sha256').update(bytes).digest('hex') },
    architecture: { type: 'transducer', encoder: 'fixture-model/encoder.onnx', decoder: 'fixture-model/decoder.onnx', joiner: 'fixture-model/joiner.onnx', tokens: 'fixture-model/tokens.txt' },
  }
  return { definition, bytes, ranges }
}

function serveRange(request: IncomingMessage, response: ServerResponse, bytes: Buffer) {
  const match = /^bytes=([0-9]+)-([0-9]+)$/.exec(request.headers.range ?? '')
  if (match === null) { response.writeHead(400); response.end(); return }
  const start = Number(match[1])
  const end = Number(match[2])
  response.writeHead(206, { 'content-range': 'bytes ' + String(start) + '-' + String(end) + '/' + String(bytes.byteLength) })
  response.end(bytes.subarray(start, end + 1))
}

async function expectExtracted(directory: string) {
  expect(await readFile(join(directory, 'tokens.txt'), 'utf8')).toBe('hello world token file')
  expect(await readdir(directory)).toEqual(['tokens.txt'])
}

describe('voice task-private model transfers', () => {
  it('downloads real ranges, verifies their assembled hash and extracts into the task directory', async () => {
    const fixture = await archiveFixture()
    const task = await staging()
    await task.download(fixture.definition)
    await expectExtracted(task.directory)
    expect(fixture.ranges).toHaveLength(Math.ceil(fixture.bytes.byteLength / OPTIONS.segmentBytes))
    expect(new Set(fixture.ranges).size).toBe(fixture.ranges.length)
    expect(task.progress.at(-1)).toEqual({ state: 'extracting', receivedBytes: fixture.bytes.byteLength, totalBytes: fixture.bytes.byteLength })
    expect(await readdir(task.root)).toEqual(['task-private'])
  })

  it('bounds simultaneous HTTP ranges by configured concurrency', async () => {
    const entered = Promise.withResolvers<undefined>()
    const held: (() => void)[] = []
    let active = 0
    let peak = 0
    let released = false
    const fixture = await archiveFixture((request, response, bytes) => {
      if (request.headers.range === 'bytes=0-31' || released) { serveRange(request, response, bytes); return }
      active += 1
      peak = Math.max(peak, active)
      held.push(() => { active -= 1; serveRange(request, response, bytes) })
      if (active === 2) entered.resolve(undefined)
    })
    const task = await staging()
    const transfer = task.download(fixture.definition, { ...OPTIONS, segmentBytes: 32, concurrency: 2 })
    await Promise.race([entered.promise, transfer.then(() => { throw new Error('transfer finished without overlapping requests') })])
    released = true
    for (const release of held) release()
    await transfer
    expect(peak).toBe(2)
    await expectExtracted(task.directory)
  })

  it.each([429, 503])('retries HTTP %s within the owning task', async (status) => {
    let first = true
    const fixture = await archiveFixture((request, response, bytes) => {
      if (first) { first = false; response.writeHead(status); response.end(); return }
      serveRange(request, response, bytes)
    })
    const task = await staging()
    await task.download(fixture.definition, { ...OPTIONS, maxAttempts: 2 })
    expect(fixture.ranges.filter(range => range === 'bytes=0-63')).toHaveLength(2)
    await expectExtracted(task.directory)
  })

  it('does not retry permanent HTTP failures', async () => {
    const fixture = await archiveFixture((_request, response) => { response.writeHead(404); response.end() })
    const task = await staging()
    await expect(task.download(fixture.definition, { ...OPTIONS, maxAttempts: 3 })).rejects.toThrow('HTTP 404')
    expect(fixture.ranges).toHaveLength(1)
    expect(await readdir(task.root)).toEqual(['task-private'])
  })

  it.each(['later-whole', 'wrong-range', 'http-error', 'unknown-size', 'file-error'] as const)(
    'closes the unconsumed %s response before releasing transfer ownership', async (mode) => {
      let closed = false
      const fixture = await archiveFixture((request, response, bytes) => {
        if (mode === 'later-whole' && request.headers.range === 'bytes=0-63') {
          serveRange(request, response, bytes)
          return
        }
        response.once('close', () => { closed = true })
        const status = mode === 'later-whole' ? 200 : mode === 'wrong-range' ? 206 : 404
        response.writeHead(status, { 'content-length': '1024', 'content-range': 'bytes 1-64/' + String(bytes.length) })
        response.write('x')
      })
      const task = await staging()
      let definition = fixture.definition
      if (mode === 'unknown-size') definition = { ...definition, approximateBytes: 0 }
      if (mode === 'file-error') {
        if (definition.download.type !== 'archive') throw new Error('expected archive fixture')
        definition = { ...definition, download: { type: 'files', entries: [
          { name: 'tokens.txt', url: definition.download.url, bytes: 4, sha256: '0'.repeat(64) },
        ] } }
      }
      await expect(task.download(definition, { ...OPTIONS, concurrency: 1 })).rejects.toThrow()
      await vi.waitFor(() => { expect(closed).toBe(true) }, { timeout: 2000 })
      expect(task.controller.signal.aborted).toBe(false)
      expect(await readdir(task.directory)).toEqual([])
    },
  )

  it('refuses a mismatched Content-Range before extraction', async () => {
    const fixture = await archiveFixture((_request, response, bytes) => {
      response.writeHead(206, { 'content-range': 'bytes 1-64/' + String(bytes.byteLength) })
      response.end(bytes.subarray(0, 64))
    })
    const task = await staging()
    await expect(task.download(fixture.definition, { ...OPTIONS, maxAttempts: 3 })).rejects.toThrow('expected Content-Range bytes 0-63/')
    expect(fixture.ranges).toHaveLength(1)
    expect(await readdir(task.directory)).toEqual([])
  })

  it.each([63, 65])('refuses a range body with %s bytes when exactly 64 are pinned', async (size) => {
    const fixture = await archiveFixture((_request, response, bytes) => {
      response.writeHead(206, { 'content-range': 'bytes 0-63/' + String(bytes.byteLength) })
      response.end(Buffer.alloc(size))
    })
    const task = await staging()
    await expect(task.download(fixture.definition)).rejects.toThrow(size > 64
      ? 'download exceeded pinned byte count' : 'expected 64 range bytes, received ' + String(size))
    expect(await readdir(task.directory)).toEqual([])
    expect(await readdir(task.root)).toEqual(['task-private'])
    expect(task.progress.every(value => value.receivedBytes >= 0 && value.receivedBytes <= value.totalBytes)).toBe(true)
  })

  it('accepts an exact whole response when the server ignores the initial range', async () => {
    const fixture = await archiveFixture((_request, response, bytes) => { response.writeHead(200); response.end(bytes) })
    const task = await staging()
    await task.download(fixture.definition)
    expect(fixture.ranges).toHaveLength(1)
    await expectExtracted(task.directory)
  })

  it('rejects same-sized archive corruption before extracting any model files', async () => {
    const fixture = await archiveFixture((request, response, bytes) => {
      serveRange(request, response, Buffer.alloc(bytes.byteLength, 0x5a))
    })
    const task = await staging()
    await expect(task.download(fixture.definition)).rejects.toThrow('expected SHA-256')
    expect(await readdir(task.directory)).toEqual([])
    expect(await readdir(task.root)).toEqual(['task-private'])
  })

  it('downloads each pinned file and verifies the bytes independently', async () => {
    const fixture = await modelFixture()
    const task = await staging()
    await task.download(fixture.definition)
    for (const [name, bytes] of fixture.files) expect(await readFile(join(task.directory, name))).toEqual(bytes)
    expect(fixture.requests).toEqual([...fixture.files.keys()])
    expect(task.progress.at(-1)?.receivedBytes).toBe(fixture.definition.approximateBytes)
  })

  it('rejects a pinned file hash mismatch', async () => {
    const fixture = await modelFixture()
    const task = await staging()
    if (fixture.definition.download.type !== 'files') throw new Error('expected file fixture')
    const definition = { ...fixture.definition, download: { type: 'files' as const, entries: fixture.definition.download.entries.map(entry => ({ ...entry, sha256: '0'.repeat(64) })) } }
    await expect(task.download(definition)).rejects.toThrow('pinned file SHA-256 mismatch')
    expect(fixture.requests).toHaveLength(1)
  })

  it('aborts an HTTP body, joins its closure and removes partial transfer artifacts', async () => {
    const fixture = await modelFixture()
    const task = await staging()
    const held = fixture.hold()
    const transfer = task.download(fixture.definition)
    const rejected = expect(transfer).rejects.toMatchObject({ name: 'AbortError' })
    await held.entered
    task.controller.abort()
    await rejected
    await held.closed
    expect(await readdir(task.directory)).toEqual([])
    expect(await readdir(task.root)).toEqual(['task-private'])
  })

  it('times out a stalled HTTP body and joins its connection before settlement', async () => {
    const fixture = await modelFixture()
    const task = await staging()
    const held = fixture.hold()
    const transfer = task.download(fixture.definition, { ...OPTIONS, requestTimeoutMs: 500 })
    const rejected = expect(transfer).rejects.toThrow(/abort|stall|timeout/i)
    await Promise.race([held.entered, transfer])
    await rejected
    await held.closed
    expect(task.controller.signal.aborted).toBe(false)
    expect(await readdir(task.directory)).toEqual([])
  })

  it('keeps simultaneous tasks in distinct private directories', async () => {
    const fixture = await archiveFixture()
    const first = await staging()
    const second = await staging()
    await Promise.all([first.download(fixture.definition), second.download(fixture.definition)])
    expect(first.directory).not.toBe(second.directory)
    await expectExtracted(first.directory)
    await expectExtracted(second.directory)
  })
})
