# @deepseek-ai/dsh-client-ui-voice-dictation

English | [中文](README.zh.md)

This Cinlan Web product Consumer contributes a Voice Settings section with one settings panel whose microphone, engine, and model rows share spacing, separators, and status treatment. The panel retains the two shipped sherpa-onnx models, exposes download and install/extraction progress for each model, and shows the native engine repair command when degraded. The microphone permission control rehydrates from the browser permission or a persisted WebView fallback and changes that fallback to denied only after an actual permission rejection. The package also contributes one always-visible microphone button in the composer's `conversation.input.right` tool-row slot. The button and global Ctrl+Shift+E shortcut share one DictationController: either starts/stops recording, sends the clip to [`@deepseek-ai/dsh-voice-sherpa-onnx`](../../voice/voice-sherpa-onnx/README.md), and appends the transcript to the current session's composer draft.

## Voice Settings Panel

The panel reads `/voice/api/engine.status` and `/voice/api/models.list` independently. The microphone, engine, and model rows use the same settings-panel spacing and separators. The Engine row renders a ready state or, when the native addon failed to load, the exact pasteable repair command and allowlist hint computed by the Host's `engine-repair.ts`, with a one-click copy control. The two Models rows stay visible while polling through byte download and extraction, ignore stale responses, and keep current rows when a later status refresh fails; a rejected download remains visible on its model row. A degraded engine never blocks model loading because downloading and caching a model has no native dependency.

## Ctrl+Shift+E dictation

The first Ctrl+Shift+E press or microphone-button click requests microphone access (`getUserMedia`) and starts a `MediaRecorder`; the second gesture from the same session stops it. The initiating session owns the active recording, and controls in other sessions remain disabled until it settles. The button shows microphone, stop, and processing states from the shared controller. The clip is decoded through `AudioContext.decodeAudioData`, resampled to 16kHz mono (this package's own linear resampler — no native audio library), base64-encoded, and POSTed to `/voice/api/transcribe` against the first model the Host reports `ready`. The transcript is appended through `ctx.conversation` — the same funnel `@deepseek-ai/dsh-client-ui-better-sidebar` uses for @-references. A missing model or failed operation leaves an error state on the controller instead of mutating the draft. Plugin teardown invalidates all pending publication, releases active tracks, and waits for microphone acquisition or transcription to settle before disposal completes.

## Model Experience

### Transport-only settings page

#### What the model sees

None. The dictated transcript inserted through `input.for(actx).setDraft(...)` is indistinguishable from typed composer text at the model boundary; this package contributes no prompt, schema, or tool of its own.

#### Token effect

None; the settings page and Ctrl+Shift+E trigger add no request or result tokens.

#### KV Cache effect

None; model download state, microphone permission, and dictation transcription never enter a model request prefix.

## Known Limitations and Deferred Work

- **No automatic re-check after a repair command runs** — the Engine sub-section reads `engine.status` once on mount; a user who runs the repair command must reload the settings page to see it reflect the fix.
- **No cross-device permission synchronization** — microphone state follows the current WebView's Permissions API; persisted fallback is local to that WebView origin and cannot grant OS permission by itself.
- **Fixed model choice** — dictation always targets the first model the Host reports `ready`; there is no per-session or persisted model preference when more than one is downloaded.
- **Two shipped models only** — see [`@deepseek-ai/dsh-voice`](../../voice/voice/README.md)'s Known Limitations for the roadmap toward the rest of the upstream sherpa-onnx model roster.
