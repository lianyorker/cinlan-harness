import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { VoiceModelId } from '@deepseek-ai/dsh-voice'
import type { VoiceModelsListValue } from '../src/types.ts'
import * as sherpaDeps from '@deepseek-ai/dsh-voice-sherpa-onnx/src/sherpa-deps.ts'
import { authenticatedCookie, createHarness, holdDownload, MODEL_ID, nativeRecognizer, remoteResult, seedModel } from './harness.ts'

const PROVIDER = '@deepseek-ai/dsh-voice-sherpa-onnx'
const CONTROLLER = '@deepseek-ai/dsh-api-voice-controller'
const ROSTER = [
  MODEL_ID, 'bilingual-streaming-zipformer', 'en-streaming-zipformer-20m',
  'bilingual-streaming-paraformer', 'sense-voice-zh-en-ja-ko-yue', 'whisper-tiny',
]
const PCM = Buffer.from(new Float32Array([0, 0.25, -0.5]).buffer).toString('base64')

async function models(harness: Awaited<ReturnType<typeof createHarness>>) {
  const result = await remoteResult(await harness.remote('modelsList'))
  if (!result.ok) throw new Error('voice roster failed: ' + result.error.message)
  return (result.value as VoiceModelsListValue).models
}

function downloadUrl(harness: Awaited<ReturnType<typeof createHarness>>): string {
  const source = harness.ctx.voice.requireDefinition(VoiceModelId(MODEL_ID)).download
  if (source.type !== 'archive') throw new Error('voice fixture requires the shipped archive model')
  return source.url
}

describe('voice real Loader and carriers', () => {
  it('serves the shipped roster and engine status through desktop Fetch without a WebServer', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    expect(harness.ctx.get('webServer')).toBeUndefined()
    expect(harness.ctx.get('subprocess')).toBeDefined()
    const roster = await models(harness)
    expect(roster.map(model => model.definition.id)).toEqual(ROSTER)
    expect(roster.every(model => model.status.state === 'not-downloaded')).toBe(true)
    expect(await remoteResult(await harness.remote('engineStatus'))).toEqual({ ok: true, value: { ok: true } })
    expect(native.load).toHaveBeenCalledOnce()
    expect(native.construct).not.toHaveBeenCalled()
  })

  it('reports native-addon degradation as status with provider repair guidance', async () => {
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue(null)
    vi.spyOn(sherpaDeps, 'sherpaOnnxLoadCause').mockReturnValue(new Error('native module missing'))
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote('engineStatus'))).toMatchObject({ ok: true, value: {
      ok: false, cause: 'native module missing', command: expect.stringContaining('dsh plugin --profile') as unknown,
      note: expect.stringContaining('allowBuilds: sherpa-onnx-node: true') as unknown,
    } })
    expect((await models(harness)).map(model => model.definition.id)).toEqual(ROSTER)
  })

  it.each([
    { method: 'modelsDownload', request: { modelId: '' } },
    { method: 'modelsRemove', request: { modelId: '' } },
    { method: 'transcribe', request: { modelId: MODEL_ID, pcm16kMonoBase64: 'not base64' } },
    { method: 'transcribe', request: { modelId: MODEL_ID, pcm16kMonoBase64: Buffer.from('one').toString('base64') } },
    { method: 'transcribe', request: { modelId: MODEL_ID, pcm16kMonoBase64: Buffer.from(new Float32Array([NaN]).buffer).toString('base64') } },
  ])('returns a typed invalid-request refusal for $method payload $request', async ({ method, request }) => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote(method, { request }))).toMatchObject({
      ok: false, error: { code: 'voice/invalid-request', details: { code: 'VOICE_INVALID_REQUEST' } },
    })
    expect(native.construct).not.toHaveBeenCalled()
    expect((await models(harness)).every(model => model.status.state === 'not-downloaded')).toBe(true)
  })

  it('rejects non-string model selectors before starting a download', async () => {
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote('modelsDownload', { request: { modelId: 42 } }))).toMatchObject({
      ok: false, error: { code: 'voice/invalid-request', details: { code: 'VOICE_INVALID_REQUEST' } },
    })
    expect((await models(harness)).every(model => model.status.state === 'not-downloaded')).toBe(true)
  })

  it.each(['modelsDownload', 'modelsRemove', 'transcribe'])('returns the typed unknown-model refusal for %s', async (method) => {
    const harness = await createHarness()
    const request = method === 'transcribe' ? { modelId: 'unknown-model', pcm16kMonoBase64: PCM } : { modelId: 'unknown-model' }
    expect(await remoteResult(await harness.remote(method, { request }))).toMatchObject({
      ok: false, error: { code: 'voice/model-unknown', details: { code: 'VOICE_MODEL_UNKNOWN' } },
    })
  })

  it('refuses transcription before model installation without loading the native addon', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } })))
      .toMatchObject({ ok: false, error: { code: 'voice/model-not-ready', details: { code: 'VOICE_MODEL_NOT_READY' } } })
    expect(native.load).not.toHaveBeenCalled()
  })

  it('transcribes through the real provider and removes only the private installed model', async () => {
    const native = nativeRecognizer('recognized locally')
    const harness = await createHarness()
    const cacheDir = await seedModel(harness)
    expect((await models(harness))[0]?.status).toEqual({ state: 'ready', cacheDir })
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } })))
      .toEqual({ ok: true, value: { text: 'recognized locally' } })
    expect(native.construct).toHaveBeenCalledOnce()
    expect(native.acceptWaveform.mock.calls[0]?.[0]).toEqual({ sampleRate: 16_000, samples: new Float32Array([0, 0.25, -0.5]) })
    expect(native.getResult).toHaveBeenCalledOnce()
    expect(await remoteResult(await harness.remote('modelsRemove', { request: { modelId: MODEL_ID } }))).toEqual({ ok: true, value: {} })
    await expect(access(cacheDir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await models(harness))[0]?.status).toEqual({ state: 'not-downloaded' })
  })

  it('sanitizes an unclassified native failure on the Remote wire', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    await seedModel(harness)
    native.getResult.mockImplementationOnce(() => { throw new Error(harness.root + ' private-native-diagnostic') })
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } })))
      .toEqual({ ok: false, error: {
        code: 'voice/operation-failed',
        message: 'Voice operation failed; check the local engine and model files',
        details: { code: 'VOICE_OPERATION_FAILED' },
      } })
    expect(native.getResult).toHaveBeenCalledOnce()
  })

  it('rejects missing and tampered HTTP cookies before native work and accepts Connection authentication', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness(true)
    const cookie = authenticatedCookie(harness.ctx.connection, harness.origin!)
    for (const credentials of [undefined, cookie + 'tampered']) {
      const refused = await harness.http('engineStatus', {}, credentials)
      expect(refused.status).toBe(401)
      expect(await refused.text()).toBe('unauthorized')
    }
    expect(native.load).not.toHaveBeenCalled()
    const admitted = await remoteResult(await harness.http('engineStatus', {}, cookie))
    expect(admitted).toEqual({ ok: true, value: { ok: true } })
    expect(native.load).toHaveBeenCalledOnce()
  })

  it('returns the same roster, engine status, and recognition from desktop and optional HTTP adapters', async () => {
    nativeRecognizer('same local result')
    const harness = await createHarness(true)
    await seedModel(harness)
    const cookie = authenticatedCookie(harness.ctx.connection, harness.origin!)
    const request = { modelId: MODEL_ID, pcm16kMonoBase64: PCM }
    for (const [remote, legacy, args, payload] of [
      ['engineStatus', 'engine.status', {}, {}],
      ['modelsList', 'models.list', {}, {}],
      ['transcribe', 'transcribe', { request }, request],
    ] as const) {
      const expected = await remoteResult(await harness.remote(remote, args))
      expect(await remoteResult(await harness.http(remote, args, cookie))).toEqual(expected)
      const response = await harness.legacy(legacy, payload)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expected)
    }
    const invalid = await harness.legacy('transcribe', { modelId: MODEL_ID, pcm16kMonoBase64: 'not base64' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('carries desktop cancellation to the external download and awaits provider settlement', async () => {
    nativeRecognizer()
    const harness = await createHarness()
    const hold = holdDownload(downloadUrl(harness))
    const controller = new AbortController()
    let completed = false
    const response = harness.remote('modelsDownload', { request: { modelId: MODEL_ID } }, controller.signal)
      .then((value) => { completed = true; return value })
    const signal = await hold.entered
    expect(signal.aborted).toBe(false)
    controller.abort(new DOMException('desktop caller cancelled', 'AbortError'))
    await hold.aborted
    expect(signal.aborted).toBe(true)
    await harness.remote('engineStatus')
    expect(completed).toBe(false)
    hold.release()
    await hold.settled
    expect(await remoteResult(await response)).toMatchObject({ ok: false, error: { code: 'gateway/cancelled' } })
    expect((await models(harness))[0]?.status).toEqual({ state: 'not-downloaded' })
    await expect(access(join(harness.root, 'models', 'voice', MODEL_ID, '.dsh-voice-ready'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('withdraws provider operations and HTTP routes while unloading, awaits cancellation, and reloads once', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness(true)
    const hold = holdDownload(downloadUrl(harness))
    const response = harness.remote('modelsDownload', { request: { modelId: MODEL_ID } })
    await hold.entered
    let disposed = false
    const disposal = harness.setEnabled(PROVIDER, false).then(() => { disposed = true })
    await hold.aborted
    expect(await remoteResult(await harness.remote('modelsList'))).toMatchObject({
      ok: false, error: { code: 'voice/unavailable', details: { code: 'VOICE_UNAVAILABLE' } },
    })
    expect(disposed).toBe(false)
    hold.release()
    await hold.settled
    expect(await remoteResult(await response)).toMatchObject({ ok: false, error: { code: 'voice/operation-failed' } })
    await disposal
    expect(harness.ctx.voice.listDefinitions()).toEqual([])
    expect(harness.ctx.voice.engineOrUndefined).toBeUndefined()
    const absent = await harness.legacy('models.list')
    expect(absent.status).toBe(404)
    await absent.text()
    await harness.setEnabled(PROVIDER, true)
    expect((await models(harness)).map(model => model.definition.id)).toEqual(ROSTER)
    native.load.mockClear()
    expect(await remoteResult(await harness.remote('engineStatus'))).toEqual({ ok: true, value: { ok: true } })
    expect(native.load).toHaveBeenCalledOnce()
    const restored = await harness.legacy('models.list')
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({ ok: true })
    expect((await models(harness)).every(model => model.status.state === 'not-downloaded')).toBe(true)
  })

  it('withdraws the controller endpoint and reattaches it once through the Loader', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    await harness.setEnabled(CONTROLLER, false)
    expect(harness.ctx.get('voiceController')).toBeUndefined()
    const absent = await harness.remote('engineStatus')
    expect(absent.status).toBe(404)
    await absent.text()
    expect(native.load).not.toHaveBeenCalled()
    await harness.setEnabled(CONTROLLER, true)
    expect(await remoteResult(await harness.remote('engineStatus'))).toEqual({ ok: true, value: { ok: true } })
    expect(native.load).toHaveBeenCalledOnce()
  })
})
