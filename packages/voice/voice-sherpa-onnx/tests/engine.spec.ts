/* oxlint-disable typescript/no-unsafe-assignment -- native module test double. */
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceModelId } from '@deepseek-ai/dsh-voice'
import type { VoiceModelDefinition } from '@deepseek-ai/dsh-voice'
import * as sherpaDeps from '../src/sherpa-deps.ts'
import { sherpaOnnxEngine } from '../src/engine.ts'

function definition(): VoiceModelDefinition {
  return {
    id: VoiceModelId('fixture-model'),
    name: 'fixture-model',
    description: 'test model',
    recommended: false,
    kind: 'streaming',
    approximateBytes: 0,
    download: { type: 'archive', url: 'https://example.invalid/fixture-model.tar.bz2', sha256: '4c60d3d6068e1f601433271f210feb2db99f548d0e83a038b29451d801dc91f7' },
    architecture: {
      type: 'transducer',
      encoder: 'fixture-model/encoder.onnx',
      decoder: 'fixture-model/decoder.onnx',
      joiner: 'fixture-model/joiner.onnx',
      tokens: 'fixture-model/tokens.txt',
    },
  }
}

describe('sherpaOnnxEngine.loadModel', () => {
  afterEach(() => { sherpaDeps.resetSherpaOnnxCache() })

  it('throws a VOICE_ENGINE_DEGRADED error when the native binding failed to load', async () => {
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue(null)
    vi.spyOn(sherpaDeps, 'sherpaOnnxLoadCause').mockReturnValue(new Error('native module missing'))
    await expect(sherpaOnnxEngine.loadModel(definition(), '/cache/fixture-model'))
      .rejects.toMatchObject({ code: 'VOICE_ENGINE_DEGRADED', message: expect.stringContaining('native module missing') })
  })

  it('constructs an OnlineRecognizer with the model file paths joined under cacheDir and wraps transcribe/dispose', async () => {
    const createStream = vi.fn(() => ({ acceptWaveform: vi.fn(), inputFinished: vi.fn() }))
    const isReady = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    const decode = vi.fn()
    const getResult = vi.fn(() => ({ text: 'hello world' }))
    let capturedConfig: unknown
    class FakeOnlineRecognizer {
      constructor(config: unknown) {
        capturedConfig = config
      }
      createStream = createStream
      isReady = isReady
      decode = decode
      getResult = getResult
    }
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue({ OnlineRecognizer: FakeOnlineRecognizer, OfflineRecognizer: FakeOnlineRecognizer as never })
    const recognizer = await sherpaOnnxEngine.loadModel(definition(), '/cache/fixture-model')
    expect(capturedConfig).toMatchObject({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join('/cache/fixture-model', 'encoder.onnx'),
          decoder: join('/cache/fixture-model', 'decoder.onnx'),
          joiner: join('/cache/fixture-model', 'joiner.onnx'),
        },
        tokens: join('/cache/fixture-model', 'tokens.txt'),
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
    })
    await expect(recognizer.transcribe(new Float32Array([0, 0.1]))).resolves.toBe('hello world')
    expect(createStream).toHaveBeenCalledOnce()
    expect(decode).toHaveBeenCalledOnce()
    expect(() => { recognizer.dispose() }).not.toThrow()
  })
})
