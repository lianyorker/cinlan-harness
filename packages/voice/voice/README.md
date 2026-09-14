# @deepseek-ai/dsh-voice

English | [中文](README.zh.md)

This Service Definition owns the provider-neutral `ctx.voice` registry and execution facade for local voice dictation: model registration, download/cache status projection, and transcription dispatch. The engine Provider owns native-binding loading (degraded when the platform native addon is absent), model file loading, and inference; Consumers own microphone capture, permission prompts, the settings model list, and composer insertion of the transcript.

## Engine and model registration

Exactly one engine may register (`registerEngine`); a deployment does not choose between multiple competing local speech-to-text backends at runtime the way it might choose between several mobile-device Providers, so a swappable-multi-provider seam is not needed today. Each shipped model is registered independently (`registerModel`) and carries its own download source, expected size, encoded-archive SHA-256, and the sherpa-onnx `OnlineRecognizer` file layout its encoder/decoder/joiner/tokens paths resolve to inside the extracted archive.

`engineOrUndefined` lets a Consumer distinguish "no engine mounted" (composition gap — the settings page should show the missing-capability guidance) from "engine mounted but this model is not downloaded yet" (the model's own `VoiceModelStatus`).

## Model Experience

### Consumer-owned results

#### What the model sees

None. This package contributes no model-visible text; `VoiceRuntime.registerEngine`/`registerModel` and the transcription dispatch replace composer keystrokes before a prompt is ever sent, so dictated output is indistinguishable from typed text at the model boundary.

#### Token effect

None; the Service Definition adds no request or result tokens.

#### KV Cache effect

None; engine registration, model registration, and download/cache state never enter a model request prefix.

## Known Limitations and Deferred Work

- **Two shipped models only** — the first vertical slice registers one streaming Chinese-only model and one streaming bilingual (Chinese/English) model from the upstream sherpa-onnx release roster; the remaining reference model families (Parakeet, additional Zipformer languages, Whisper) are not yet registered.
- **No durable model-preference record** — the last-selected model is not persisted; each session starts from the settings page's default selection.
- **No streaming partial-result API** — `VoiceRecognizer.transcribe` returns one final transcript per submitted clip; incremental partial hypotheses during an in-progress utterance are not exposed.
