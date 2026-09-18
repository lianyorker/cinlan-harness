import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-api-voice-controller'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createVoiceApi, VoiceApiError, type VoiceApi, type VoiceEngineStatus } from '../src/client/api.ts'
import { createVoiceRemote, modelRow } from './voice-fixtures.client.ts'

const operations: readonly { name: keyof VoiceApi; call: (api: VoiceApi) => Promise<unknown> }[] = [
  { name: 'engineStatus', call: api => api.engineStatus() },
  { name: 'modelsList', call: api => api.modelsList() },
  { name: 'modelsDownload', call: api => api.modelsDownload('zh') },
  { name: 'modelsRemove', call: api => api.modelsRemove('zh') },
  { name: 'transcribe', call: api => api.transcribe('zh', 'YWJj') },
]

describe('createVoiceApi', () => {
  describe.each(['provided', 'omitted'] as const)('with a %s cancellation signal', (signalMode) => {
    function signal(): AbortSignal | undefined {
      return signalMode === 'provided' ? new AbortController().signal : undefined
    }

    it('unwraps engine availability and forwards the signal', async () => {
      const remote = createVoiceRemote()
      const value: VoiceEngineStatus = { ok: true }
      remote.engineStatus.mockResolvedValue({ ok: true, value })
      const requestSignal = signal()
      await expect(createVoiceApi(remote).engineStatus(requestSignal)).resolves.toBe(value)
      expect(remote.engineStatus).toHaveBeenCalledExactlyOnceWith(requestSignal)
    })

    it('unwraps the model roster and forwards the signal', async () => {
      const remote = createVoiceRemote()
      const value = { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] }
      remote.modelsList.mockResolvedValue({ ok: true, value })
      const requestSignal = signal()
      await expect(createVoiceApi(remote).modelsList(requestSignal)).resolves.toBe(value)
      expect(remote.modelsList).toHaveBeenCalledExactlyOnceWith(requestSignal)
    })

    it('unwraps the downloaded cache and forwards the model request and signal', async () => {
      const remote = createVoiceRemote()
      const value = { cacheDir: '/cache/zh' }
      remote.modelsDownload.mockResolvedValue({ ok: true, value })
      const requestSignal = signal()
      await expect(createVoiceApi(remote).modelsDownload('zh', requestSignal)).resolves.toBe(value)
      expect(remote.modelsDownload).toHaveBeenCalledExactlyOnceWith({ modelId: 'zh' }, requestSignal)
    })

    it('unwraps removal and forwards the model request and signal', async () => {
      const remote = createVoiceRemote()
      const value = {}
      remote.modelsRemove.mockResolvedValue({ ok: true, value })
      const requestSignal = signal()
      await expect(createVoiceApi(remote).modelsRemove('zh', requestSignal)).resolves.toBe(value)
      expect(remote.modelsRemove).toHaveBeenCalledExactlyOnceWith({ modelId: 'zh' }, requestSignal)
    })

    it('unwraps transcription and forwards the model, PCM, and signal', async () => {
      const remote = createVoiceRemote()
      const value = { text: 'hello' }
      remote.transcribe.mockResolvedValue({ ok: true, value })
      const requestSignal = signal()
      await expect(createVoiceApi(remote).transcribe('zh', 'YWJj', requestSignal)).resolves.toBe(value)
      expect(remote.transcribe).toHaveBeenCalledExactlyOnceWith({ modelId: 'zh', pcm16kMonoBase64: 'YWJj' }, requestSignal)
    })
  })

  it('returns a degraded engine status as a successful value', async () => {
    const remote = createVoiceRemote()
    const value: VoiceEngineStatus = {
      ok: false, cause: 'Native engine unavailable', command: 'dsh plugin --profile web install', profile: 'web', note: 'Repair the engine',
    }
    remote.engineStatus.mockResolvedValue({ ok: true, value })
    await expect(createVoiceApi(remote).engineStatus()).resolves.toBe(value)
  })

  it.each(operations)('converts a typed $name refusal to VoiceApiError', async ({ name, call }) => {
    const remote = createVoiceRemote()
    const refusal: RemoteResult<never> = {
      ok: false, error: new RemoteError('voice/model-unknown', 'Unknown voice model', { code: 'VOICE_MODEL_UNKNOWN' }),
    }
    remote[name].mockResolvedValue(refusal)
    const result = call(createVoiceApi(remote))
    await expect(result).rejects.toBeInstanceOf(VoiceApiError)
    await expect(result).rejects.toMatchObject({ code: 'voice/model-unknown', message: 'Unknown voice model' })
  })

  it.each(operations)('preserves the original $name transport rejection', async ({ name, call }) => {
    const remote = createVoiceRemote()
    const failure = new Error('Carrier disconnected')
    remote[name].mockRejectedValue(failure)
    await expect(call(createVoiceApi(remote))).rejects.toBe(failure)
  })

  it.each(operations)('preserves the original $name cancellation rejection', async ({ name, call }) => {
    const remote = createVoiceRemote()
    const cancellation = new DOMException('Operation cancelled', 'AbortError')
    remote[name].mockRejectedValue(cancellation)
    await expect(call(createVoiceApi(remote))).rejects.toBe(cancellation)
  })

  it('passes in-flight cancellation to transcription and retains the abort reason', async () => {
    const remote = createVoiceRemote()
    const controller = new AbortController()
    const cancellation = new DOMException('Stop transcription', 'AbortError')
    remote.transcribe.mockImplementation((_request, requestSignal) => new Promise((_resolve, reject) => {
      requestSignal!.addEventListener('abort', () => { reject(cancellation) }, { once: true })
    }))
    const result = createVoiceApi(remote).transcribe('zh', 'YWJj', controller.signal)
    const rejected = expect(result).rejects.toBe(cancellation)
    controller.abort(cancellation)
    await rejected
    expect(remote.transcribe).toHaveBeenCalledExactlyOnceWith({ modelId: 'zh', pcm16kMonoBase64: 'YWJj' }, controller.signal)
  })
})
