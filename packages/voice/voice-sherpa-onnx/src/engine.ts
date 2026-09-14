/**
 * sherpa-onnx VoiceEngine implementation: loads one model's ONNX files into a
 * streaming `OnlineRecognizer` and exposes the Service Definition's
 * `VoiceRecognizer` contract over it. The engine itself never touches the
 * download cache — `loadModel` receives the already-extracted `cacheDir` from
 * `ensureModelDownloaded`.
 */

import { join } from 'node:path'
import type { VoiceEngine, VoiceModelDefinition, VoiceRecognizer } from '@deepseek-ai/dsh-voice'
import { VoiceError } from '@deepseek-ai/dsh-voice'
import {
  describeSherpaOnnxCause,
  loadSherpaOnnx,
  sherpaOnnxLoadCause,
} from './sherpa-deps.ts'
import type { SherpaOnlineRecognizer } from './sherpa-deps.ts'

/** Sample rate every shipped streaming model expects (sherpa-onnx feature config). */
const SAMPLE_RATE = 16_000
/** Feature dimension every shipped streaming Zipformer transducer model expects. */
const FEATURE_DIM = 80
/** Trailing silence padded after the utterance, matching upstream sherpa-onnx examples (flushes the final decode window). */
const TAIL_PADDING_SECONDS = 0.4

class SherpaOnnxRecognizer implements VoiceRecognizer {
  constructor(private readonly recognizer: SherpaOnlineRecognizer) {}

  transcribe(samples: Float32Array): Promise<string> {
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
    const tailPadding = new Float32Array(Math.round(SAMPLE_RATE * TAIL_PADDING_SECONDS))
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: tailPadding })
    while (this.recognizer.isReady(stream)) {
      this.recognizer.decode(stream)
    }
    return Promise.resolve(this.recognizer.getResult(stream).text)
  }

  dispose(): void {
    // sherpa-onnx-node's OnlineRecognizer/OnlineStream instances are
    // garbage-collected native wrappers with no explicit close(); nothing to
    // release here today. Kept as an explicit no-op method (not omitted)
    // so the VoiceRecognizer contract stays uniform across future engines
    // that DO hold a releasable native handle.
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
    const recognizer = new sherpaOnnx.OnlineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: FEATURE_DIM },
      modelConfig: {
        transducer: {
          encoder: join(cacheDir, ...definition.files.encoder.split('/').slice(1)),
          decoder: join(cacheDir, ...definition.files.decoder.split('/').slice(1)),
          joiner: join(cacheDir, ...definition.files.joiner.split('/').slice(1)),
        },
        tokens: join(cacheDir, ...definition.files.tokens.split('/').slice(1)),
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
    })
    return Promise.resolve(new SherpaOnnxRecognizer(recognizer))
  },
}
