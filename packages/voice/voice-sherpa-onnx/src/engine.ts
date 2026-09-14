/**
 * sherpa-onnx VoiceEngine implementation: loads one model's ONNX files into a
 * streaming `OnlineRecognizer` or non-streaming `OfflineRecognizer` and exposes
 * the Service Definition's `VoiceRecognizer` contract over it. The engine itself
 * never touches the download cache — `loadModel` receives the already-extracted
 * `cacheDir` from `ensureModelDownloaded`.
 */

import { join } from 'node:path'
import type { VoiceEngine, VoiceModelDefinition, VoiceRecognizer } from '@deepseek-ai/dsh-voice'
import { VoiceError } from '@deepseek-ai/dsh-voice'
import {
  describeSherpaOnnxCause,
  loadSherpaOnnx,
  sherpaOnnxLoadCause,
} from './sherpa-deps.ts'
import type { SherpaOfflineRecognizer, SherpaOnlineRecognizer } from './sherpa-deps.ts'

/** Sample rate every shipped model expects (sherpa-onnx feature config). */
const SAMPLE_RATE = 16_000
/** Feature dimension every shipped Zipformer transducer model expects. */
const FEATURE_DIM = 80
/** Trailing silence padded after the utterance, matching upstream sherpa-onnx examples (flushes the final decode window). */
const TAIL_PADDING_SECONDS = 0.4

/** Resolve a model-architecture file path to its absolute path in the cache directory.
 *  Archive paths have a top-level directory prefix that tar --strip-components 1 removes;
 *  individual-file download paths are bare filenames. */
function resolveModelPath(cacheDir: string, filePath: string): string {
  const parts = filePath.split('/')
  return parts.length > 1 ? join(cacheDir, ...parts.slice(1)) : join(cacheDir, filePath)
}

/** Wraps a streaming `OnlineRecognizer`: decode is polled to exhaustion via `isReady`. */
class SherpaOnlineOnnxRecognizer implements VoiceRecognizer {
  constructor(private readonly recognizer: SherpaOnlineRecognizer) {}

  transcribe(samples: Float32Array): Promise<string> {
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
    const tailPadding = new Float32Array(Math.round(SAMPLE_RATE * TAIL_PADDING_SECONDS))
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: tailPadding })
    stream.inputFinished()
    while (this.recognizer.isReady(stream)) {
      this.recognizer.decode(stream)
    }
    const result = this.recognizer.getResult(stream)
    return Promise.resolve(result.text)
  }

  dispose(): void {
    // sherpa-onnx-node's recognizer/stream instances are garbage-collected native
    // wrappers with no explicit close(); nothing to release here today.
  }
}

/** Wraps a non-streaming `OfflineRecognizer`: decode runs exactly once per stream (no `isReady` polling). */
class SherpaOfflineOnnxRecognizer implements VoiceRecognizer {
  constructor(private readonly recognizer: SherpaOfflineRecognizer) {}

  transcribe(samples: Float32Array): Promise<string> {
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
    this.recognizer.decode(stream)
    return Promise.resolve(this.recognizer.getResult(stream).text)
  }

  dispose(): void {
    // sherpa-onnx-node's recognizer/stream instances are garbage-collected native
    // wrappers with no explicit close(); nothing to release here today.
  }
}

/** The sherpa-onnx VoiceEngine Provider implementation. */
export const sherpaOnnxEngine: VoiceEngine = {
  id: 'sherpa-onnx',

  loadModel(definition: VoiceModelDefinition, cacheDir: string): Promise<VoiceRecognizer> {
    const sherpaOnnx = loadSherpaOnnx()
    if (sherpaOnnx === null) {
      return Promise.reject(new VoiceError(
        `sherpa-onnx-node failed to load: ${describeSherpaOnnxCause(sherpaOnnxLoadCause())} — reinstall the voice-sherpa-onnx plugin's native dependency`,
        'VOICE_ENGINE_DEGRADED',
      ))
    }
    const { architecture } = definition
    const resolve = (p: string): string => resolveModelPath(cacheDir, p)
    const featConfig = { sampleRate: SAMPLE_RATE, featureDim: FEATURE_DIM }
    const baseModelConfig = { tokens: resolve(architecture.tokens), numThreads: 1, provider: 'cpu' as const, debug: 0 as const }

    if (architecture.type === 'transducer') {
      const recognizer = new sherpaOnnx.OnlineRecognizer({
        featConfig,
        modelConfig: {
          ...baseModelConfig,
          transducer: {
            encoder: resolve(architecture.encoder),
            decoder: resolve(architecture.decoder),
            joiner: resolve(architecture.joiner),
          },
        },
      })
      return Promise.resolve(new SherpaOnlineOnnxRecognizer(recognizer))
    }
    if (architecture.type === 'paraformer') {
      const recognizer = new sherpaOnnx.OnlineRecognizer({
        featConfig,
        modelConfig: {
          ...baseModelConfig,
          paraformer: { encoder: resolve(architecture.encoder), decoder: resolve(architecture.decoder) },
        },
      })
      return Promise.resolve(new SherpaOnlineOnnxRecognizer(recognizer))
    }
    if (architecture.type === 'whisper') {
      const recognizer = new sherpaOnnx.OfflineRecognizer({
        featConfig,
        modelConfig: {
          ...baseModelConfig,
          whisper: {
            encoder: resolve(architecture.encoder),
            decoder: resolve(architecture.decoder),
            language: architecture.language,
            task: 'transcribe' as const,
          },
        },
      })
      return Promise.resolve(new SherpaOfflineOnnxRecognizer(recognizer))
    }
    const recognizer = new sherpaOnnx.OfflineRecognizer({
      featConfig,
      modelConfig: {
        ...baseModelConfig,
        senseVoice: { model: resolve(architecture.model), language: architecture.language },
      },
    })
    return Promise.resolve(new SherpaOfflineOnnxRecognizer(recognizer))
  },
}
