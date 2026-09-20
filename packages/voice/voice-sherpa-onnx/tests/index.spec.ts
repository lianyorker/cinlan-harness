/** Provider HTTP and managed extraction exercised through real Loader rows. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { VoiceModelTask } from '@deepseek-ai/dsh-voice'
import { createHarness, installModel, MODEL_ID, nativeRecognizer, terminalTask } from '../../../api/voice-controller/tests/harness.ts'
import * as sherpaDeps from '../src/sherpa-deps.ts'
import { nativeTarExtractor } from '../src/index.ts'

const FIXTURE_ARCHIVE = new URL('./fixtures/fixture-model.tar.bz2', import.meta.url)
const PCM = Buffer.from(new Float32Array([0, 0.25]).buffer).toString('base64')

describe('voice provider Loader HTTP adapter', () => {
  it('extracts a real pinned archive through the mounted managed subprocess provider', async () => {
    const harness = await createHarness()
    const destination = join(harness.root, 'native-extracted')
    const archive = join(harness.root, 'fixture.tar.bz2')
    await mkdir(destination)
    await writeFile(archive, await readFile(FIXTURE_ARCHIVE))
    const extract = nativeTarExtractor(harness.ctx, { graceMs: 5000, stderrBytes: 4096 })
    await extract(archive, destination, new AbortController().signal)
    expect(await readFile(join(destination, 'tokens.txt'), 'utf8')).toBe('hello world token file')
  })

  it('reports actual native tar failure without publishing extracted model files', async () => {
    const harness = await createHarness()
    const destination = join(harness.root, 'bad-extracted')
    const archive = join(harness.root, 'invalid.tar.bz2')
    await mkdir(destination)
    await writeFile(archive, 'not a bzip2 archive')
    const extract = nativeTarExtractor(harness.ctx, { graceMs: 5000, stderrBytes: 4096 })
    await expect(extract(archive, destination, new AbortController().signal)).rejects.toThrow(/native tar extraction failed/)
    await expect(readFile(join(destination, 'tokens.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('transcribes verified HTTP-downloaded files and removes them through the legacy route', async () => {
    nativeRecognizer('legacy transcript')
    const harness = await createHarness(true)
    const directory = await installModel(harness)
    const response = await harness.legacy('transcribe', { modelId: MODEL_ID, pcm16kMonoBase64: PCM })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, value: { text: 'legacy transcript' } })
    const removed = await harness.legacy('models.remove', { modelId: MODEL_ID })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ ok: true, value: {} })
    await expect(readFile(join(directory, 'tokens.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns Host task receipts from each legacy installation endpoint', async () => {
    const harness = await createHarness(true)
    for (const operation of ['download', 'reinstall', 'update'] as const) {
      const response = await harness.legacy('models.' + operation, { modelId: MODEL_ID })
      expect(response.status).toBe(200)
      const envelope = await response.json() as { ok: boolean; value: VoiceModelTask }
      expect(envelope).toMatchObject({ ok: true, value: { modelId: MODEL_ID, operation, state: 'running' } })
      const terminal = await terminalTask(harness, envelope.value.taskId)
      expect(terminal.task).toMatchObject({ operation, state: 'succeeded' })
      expect(terminal.resource.integrity).toBe('verified')
    }
  })

  it('joins an exact cancellation through the legacy endpoint', async () => {
    const harness = await createHarness(true)
    const hold = harness.fixture.hold()
    const admitted = await harness.legacy('models.download', { modelId: MODEL_ID })
    const envelope = await admitted.json() as { value: VoiceModelTask }
    await hold.entered
    const cancelled = await harness.legacy('models.cancel', { modelId: MODEL_ID, taskId: envelope.value.taskId })
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toEqual({ ok: true, value: { cancelled: true } })
    await hold.closed
    expect((await terminalTask(harness, envelope.value.taskId)).task?.state).toBe('cancelled')
  })

  it('reports addon degradation after a real installation', async () => {
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue(null)
    vi.spyOn(sherpaDeps, 'sherpaOnnxLoadCause').mockReturnValue(new Error('native module missing'))
    const harness = await createHarness(true)
    await installModel(harness)
    const response = await harness.legacy('transcribe', { modelId: MODEL_ID, pcm16kMonoBase64: PCM })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'VOICE_ENGINE_DEGRADED' } })
  })

  it('refuses unknown models without issuing a model HTTP request', async () => {
    const harness = await createHarness(true)
    const response = await harness.legacy('models.download', { modelId: 'missing' })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not-found' } })
    expect(harness.fixture.requests).toEqual([])
  })

  it('rejects a forged non-loopback Host header and consumes the refused response', async () => {
    const harness = await createHarness(true)
    const status = await new Promise<number>((resolve, reject) => {
      const request = get(new URL('/voice/api/models.list', harness.origin), {
        method: 'POST', headers: { host: 'example.com' },
      }, (response) => {
        response.on('error', reject)
        response.resume()
        response.once('end', () => { resolve(response.statusCode ?? 0) })
      })
      request.once('error', reject)
    })
    expect(status).toBe(403)
  })

  it('rejects GET without starting a model transfer', async () => {
    const harness = await createHarness(true)
    const response = await fetch(new URL('/voice/api/models.list', harness.origin))
    expect(response.status).toBe(405)
    await response.text()
    expect(harness.fixture.requests).toEqual([])
  })
})
