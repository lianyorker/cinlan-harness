import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import WebSocket from 'ws'
import { authenticatedCookie, createHarness, remoteResult } from './harness.ts'

const cacheRoot = process.env.CLH_VOICE_NATIVE_CACHE_ROOT
const wavPath = process.env.CLH_VOICE_NATIVE_WAV
const modelId = 'zipformer-bilingual-zh-en'

function pcm16Wav(bytes: Buffer): Float32Array {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected RIFF WAV')
  let format = false
  let samples: Float32Array | undefined
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + length > bytes.length) throw new Error('Truncated WAV chunk')
    const name = bytes.toString('ascii', offset, offset + 4)
    if (name === 'fmt ') {
      if (length < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1
        || bytes.readUInt32LE(start + 4) !== 16_000 || bytes.readUInt16LE(start + 14) !== 16) throw new Error('Expected 16 kHz mono PCM16 WAV')
      format = true
    }
    if (name === 'data') {
      if (length % 2 !== 0) throw new Error('Invalid PCM16 length')
      samples = Float32Array.from({ length: length / 2 }, (_, index) => bytes.readInt16LE(start + index * 2) / 32768)
    }
    offset = start + length + length % 2
  }
  if (!format || samples === undefined || samples.length === 0) throw new Error('Missing WAV format or audio')
  return samples
}

describe('real voice Gateway and native acceptance', () => {
  it.skipIf(cacheRoot === undefined || wavPath === undefined)('recognizes speech over authenticated WebSocket and HTTP and releases its generation lease', async () => {
    if (cacheRoot === undefined || wavPath === undefined) throw new Error('Native acceptance paths are required')
    const bytes = await readFile(wavPath)
    const samples = pcm16Wav(bytes)
    const privateCache = await mkdtemp(join(tmpdir(), 'clh-voice-native-'))
    onTestFinished(() => rm(privateCache, { recursive: true, force: true }))
    const source = join(cacheRoot, '.resources', modelId)
    const pointer: unknown = JSON.parse(await readFile(join(source, 'pointer.json'), 'utf8'))
    if (pointer === null || typeof pointer !== 'object' || !('generation' in pointer) || typeof pointer.generation !== 'string'
      || !/^[a-f0-9-]{36}$/.test(pointer.generation)) throw new Error('Expected a committed native model generation')
    const target = join(privateCache, '.resources', modelId)
    await mkdir(join(target, 'generations'), { recursive: true })
    await cp(join(source, 'generations', pointer.generation), join(target, 'generations', pointer.generation), { recursive: true })
    await writeFile(join(target, 'pointer.json'), JSON.stringify(pointer))
    const harness = await createHarness(true, { cacheRoot: privateCache })
    expect(await remoteResult(await harness.remote('engineStatus'))).toEqual({ ok: true, value: { ok: true } })
    const cookie = authenticatedCookie(harness.ctx.connection, harness.origin!)
    const socket = new WebSocket(`${harness.origin!.replace('http:', 'ws:')}/api/remote.mux`, { headers: { cookie } })
    onTestFinished(async () => {
      if (socket.readyState === WebSocket.CLOSED) return
      const closed = once(socket, 'close')
      socket.close()
      await closed
    })
    const frames: Record<string, unknown>[] = []
    socket.on('message', (data) => { frames.push(JSON.parse(data.toString()) as Record<string, unknown>) })
    await once(socket, 'open')
    const streamId = 'native-acceptance'
    socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'voice/transcribeStream', payload: { args: { request: { modelId } } } }))
    let chunks = 0
    for (let start = 0; start < samples.length; start += 8000) {
      const chunk = samples.slice(start, start + 8000)
      socket.send(JSON.stringify({ type: 'item', streamId, value: { pcm16kMonoBase64: Buffer.from(chunk.buffer).toString('base64') } }))
      chunks += 1
      await vi.waitFor(() => {
        expect(frames.find(frame => frame.type === 'error')).toBeUndefined()
        expect(frames.filter(frame => frame.type === 'item')).toHaveLength(chunks)
      }, { timeout: 20_000 })
    }
    socket.send(JSON.stringify({ type: 'end', streamId }))
    await vi.waitFor(() => {
      expect(frames.find(frame => frame.type === 'error')).toBeUndefined()
      expect(frames.at(-1)?.type).toBe('end')
    }, { timeout: 20_000 })
    const values = frames.filter(frame => frame.type === 'item').map(frame => frame.value)
    expect(values.slice(0, -1)).toHaveLength(chunks)
    expect(values.slice(0, -1)).toEqual(values.slice(0, -1).map(() => ({ type: 'partial', text: expect.any(String) })))
    const final = values.at(-1)
    if (final === null || typeof final !== 'object' || !('text' in final) || typeof final.text !== 'string') throw new Error('Missing native transcript')
    expect(final).toEqual({ type: 'final', text: expect.any(String) })
    expect(final.text.trim().length).toBeGreaterThan(0)
    const unary = await remoteResult(await harness.http('transcribe', { request: { modelId, pcm16kMonoBase64: Buffer.from(samples.buffer).toString('base64') } }, cookie))
    expect(unary).toEqual({ ok: true, value: { text: final.text } })
    for (const generation of await readdir(join(target, 'leases'))) {
      expect(await readdir(join(target, 'leases', generation))).toEqual([])
    }
    const report = { nativeAcceptance: true, modelId, wavSha256: createHash('sha256').update(bytes).digest('hex'), samples: samples.length, chunks, text: final.text, unaryMatchesStream: true, leasesReleased: true }
    if (process.env.CLH_VOICE_NATIVE_REPORT !== undefined) await writeFile(process.env.CLH_VOICE_NATIVE_REPORT, JSON.stringify(report, null, 2) + '\n')
  }, 120_000)
})
