/**
 * The two shipped voice-dictation models for this vertical slice, sourced
 * from the upstream k2-fsa/sherpa-onnx `asr-models` GitHub release. Both are
 * streaming Zipformer-transducer models sharing one file layout inside their
 * extracted archive.
 */

import { VoiceModelId } from '@deepseek-ai/dsh-voice'
import type { VoiceModelDefinition } from '@deepseek-ai/dsh-voice'

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

/** Streaming Chinese-only Zipformer (~14M parameters; the smallest shipped model). */
export const ZH_STREAMING_ZIPFORMER: VoiceModelDefinition = {
  id: VoiceModelId('zh-streaming-zipformer-14m'),
  name: 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23',
  kind: 'streaming',
  approximateBytes: 74_004_050,
  archiveUrl: `${RELEASE_BASE}/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23.tar.bz2`,
  archiveSha256: '2cbd71b640d9c37d3784f29367333a4577b0398b62e9deeed418170b081cba8b',
  files: {
    encoder: 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/encoder-epoch-99-avg-1.onnx',
    decoder: 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/decoder-epoch-99-avg-1.onnx',
    joiner: 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/joiner-epoch-99-avg-1.onnx',
    tokens: 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/tokens.txt',
  },
}

/** Streaming Chinese/English bilingual Zipformer. */
export const BILINGUAL_STREAMING_ZIPFORMER: VoiceModelDefinition = {
  id: VoiceModelId('bilingual-streaming-zipformer'),
  name: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
  kind: 'streaming',
  approximateBytes: 511_274_346,
  archiveUrl: `${RELEASE_BASE}/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2`,
  archiveSha256: '27ffbd9ee24ad186d99acc2f6354d7992b27bcab490812510665fa8f9389c5f8',
  files: {
    encoder: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/encoder-epoch-99-avg-1.onnx',
    decoder: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/decoder-epoch-99-avg-1.onnx',
    joiner: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/joiner-epoch-99-avg-1.onnx',
    tokens: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/tokens.txt',
  },
}

/** The complete shipped roster for this vertical slice. */
export const SHIPPED_MODELS: readonly VoiceModelDefinition[] = [
  ZH_STREAMING_ZIPFORMER,
  BILINGUAL_STREAMING_ZIPFORMER,
]
