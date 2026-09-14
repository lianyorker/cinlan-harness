/**
 * The shipped voice-dictation models for this vertical slice. The two original
 * streaming Zipformer-transducer models are sourced from the upstream
 * k2-fsa/sherpa-onnx `asr-models` GitHub release as tar.bz2 archives. Additional
 * models (English Zipformer, bilingual Paraformer, Sense Voice, Whisper tiny)
 * are sourced as individual files from HuggingFace with per-file SHA-256
 * verification, mirroring the orca speech model download catalog.
 */

import { VoiceModelId } from '@deepseek-ai/dsh-voice'
import type { VoiceModelDefinition } from '@deepseek-ai/dsh-voice'

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

/** Build a HuggingFace download URL for one file in a pinned revision. */
function hfFile(repository: string, revision: string, name: string): string {
  return `https://hf-mirror.com/${repository}/resolve/${revision}/${encodeURIComponent(name)}?download=true`
}

/** Streaming Chinese-only Zipformer (~14M parameters; the smallest shipped model). */
export const ZH_STREAMING_ZIPFORMER: VoiceModelDefinition = {
  id: VoiceModelId('zh-streaming-zipformer-14m'),
  name: 'sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23',
  description: '中文识别 · 超轻量 14M 参数，适合低资源设备',
  recommended: false,
  kind: 'streaming',
  approximateBytes: 74_004_050,
  download: {
    type: 'archive',
    url: `${RELEASE_BASE}/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23.tar.bz2`,
    sha256: '2cbd71b640d9c37d3784f29367333a4577b0398b62e9deeed418170b081cba8b',
  },
  architecture: {
    type: 'transducer',
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
  description: '中英双语 + 代码切换 · 低延迟实时流式识别',
  recommended: true,
  kind: 'streaming',
  approximateBytes: 511_274_346,
  download: {
    type: 'archive',
    url: `${RELEASE_BASE}/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2`,
    sha256: '27ffbd9ee24ad186d99acc2f6354d7992b27bcab490812510665fa8f9389c5f8',
  },
  architecture: {
    type: 'transducer',
    encoder: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/encoder-epoch-99-avg-1.onnx',
    decoder: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/decoder-epoch-99-avg-1.onnx',
    joiner: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/joiner-epoch-99-avg-1.onnx',
    tokens: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/tokens.txt',
  },
}

/** Streaming English-only Zipformer (~20M parameters; small and fast). */
export const EN_STREAMING_ZIPFORMER_20M: VoiceModelDefinition = {
  id: VoiceModelId('en-streaming-zipformer-20m'),
  name: 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17',
  description: 'English only · Lightweight 20M-param, good balance of speed and size',
  recommended: false,
  kind: 'streaming',
  approximateBytes: 91_928_372,
  download: {
    type: 'files',
    entries: [
      { name: 'encoder-epoch-99-avg-1.onnx', url: hfFile('csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17', 'd42f2d9f7ca24806fb667456a18a9f1b60f70d16', 'encoder-epoch-99-avg-1.onnx'), sha256: 'f77a22f4ff94604e1afb2aeb13504d7699363528c047c97d3436087c95c9b659', bytes: 88_804_590 },
      { name: 'decoder-epoch-99-avg-1.onnx', url: hfFile('csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17', 'd42f2d9f7ca24806fb667456a18a9f1b60f70d16', 'decoder-epoch-99-avg-1.onnx'), sha256: '45a7f940ecfb53d89fa270ad11b88b961e53a317203eb24b1c8e95ed208b0f30', bytes: 2_092_272 },
      { name: 'joiner-epoch-99-avg-1.onnx', url: hfFile('csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17', 'd42f2d9f7ca24806fb667456a18a9f1b60f70d16', 'joiner-epoch-99-avg-1.onnx'), sha256: '343e17dffa4f386ca206e00d3c406908f68f473c3d35968d6c3cddd5b8559a94', bytes: 1_026_462 },
      { name: 'tokens.txt', url: hfFile('csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17', 'd42f2d9f7ca24806fb667456a18a9f1b60f70d16', 'tokens.txt'), sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb', bytes: 5_048 },
    ],
  },
  architecture: {
    type: 'transducer',
    encoder: 'encoder-epoch-99-avg-1.onnx',
    decoder: 'decoder-epoch-99-avg-1.onnx',
    joiner: 'joiner-epoch-99-avg-1.onnx',
    tokens: 'tokens.txt',
  },
}

/** Streaming Chinese/English bilingual Paraformer. */
export const BILINGUAL_STREAMING_PARAFORMER: VoiceModelDefinition = {
  id: VoiceModelId('bilingual-streaming-paraformer'),
  name: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
  description: '中英双语 · 对口音和方言中文识别效果更好',
  recommended: true,
  kind: 'streaming',
  approximateBytes: 237_202_501,
  download: {
    type: 'files',
    entries: [
      { name: 'encoder.int8.onnx', url: hfFile('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', '8e40c43232a1c5c66c82111efc5820d3accca11b', 'encoder.int8.onnx'), sha256: '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a', bytes: 165_462_184 },
      { name: 'decoder.int8.onnx', url: hfFile('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', '8e40c43232a1c5c66c82111efc5820d3accca11b', 'decoder.int8.onnx'), sha256: 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f', bytes: 71_664_561 },
      { name: 'tokens.txt', url: hfFile('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', '8e40c43232a1c5c66c82111efc5820d3accca11b', 'tokens.txt'), sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6', bytes: 75_756 },
    ],
  },
  architecture: {
    type: 'paraformer',
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    tokens: 'tokens.txt',
  },
}

/** Non-streaming Sense Voice model (Chinese/English/Japanese/Korean/Cantonese). */
export const SENSE_VOICE_MULTILINGUAL: VoiceModelDefinition = {
  id: VoiceModelId('sense-voice-zh-en-ja-ko-yue'),
  name: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  description: '中日英韩粤 · 自动语言检测，多语言非流式识别',
  recommended: true,
  kind: 'non-streaming',
  approximateBytes: 239_549_735,
  download: {
    type: 'files',
    entries: [
      { name: 'model.int8.onnx', url: hfFile('csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', '2365baeacb507f821a0c8120fcee3d484dba7a07', 'model.int8.onnx'), sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51', bytes: 239_233_841 },
      { name: 'tokens.txt', url: hfFile('csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', '2365baeacb507f821a0c8120fcee3d484dba7a07', 'tokens.txt'), sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc', bytes: 315_894 },
    ],
  },
  architecture: {
    type: 'sense-voice',
    model: 'model.int8.onnx',
    tokens: 'tokens.txt',
    language: 'auto',
  },
}

/** Non-streaming Whisper tiny model (multilingual). */
export const WHISPER_TINY: VoiceModelDefinition = {
  id: VoiceModelId('whisper-tiny'),
  name: 'sherpa-onnx-whisper-tiny',
  description: '90+ 语言 · 覆盖最广，精度较低',
  recommended: false,
  kind: 'non-streaming',
  approximateBytes: 152_969_611,
  download: {
    type: 'files',
    entries: [
      { name: 'tiny-encoder.onnx', url: hfFile('csukuangfj/sherpa-onnx-whisper-tiny', '65176e2deb88badc814a94058666cadccc29b61c', 'tiny-encoder.onnx'), sha256: '42c1d4cbf889632ba21ab6f0d4064c80209755f265ce5cd630db4a6793e7089c', bytes: 37_647_080 },
      { name: 'tiny-decoder.onnx', url: hfFile('csukuangfj/sherpa-onnx-whisper-tiny', '65176e2deb88badc814a94058666cadccc29b61c', 'tiny-decoder.onnx'), sha256: 'e144c07dc6b55cece24392811f2d934b97013811f5e677d1315d341a0a74a25d', bytes: 114_505_801 },
      { name: 'tiny-tokens.txt', url: hfFile('csukuangfj/sherpa-onnx-whisper-tiny', '65176e2deb88badc814a94058666cadccc29b61c', 'tiny-tokens.txt'), sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126', bytes: 816_730 },
    ],
  },
  architecture: {
    type: 'whisper',
    encoder: 'tiny-encoder.onnx',
    decoder: 'tiny-decoder.onnx',
    tokens: 'tiny-tokens.txt',
    language: 'en',
  },
}

/** The complete shipped roster for this vertical slice. */
export const SHIPPED_MODELS: readonly VoiceModelDefinition[] = [
  ZH_STREAMING_ZIPFORMER,
  BILINGUAL_STREAMING_ZIPFORMER,
  EN_STREAMING_ZIPFORMER_20M,
  BILINGUAL_STREAMING_PARAFORMER,
  SENSE_VOICE_MULTILINGUAL,
  WHISPER_TINY,
]
