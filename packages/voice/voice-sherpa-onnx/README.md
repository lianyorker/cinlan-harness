# @deepseek-ai/dsh-voice-sherpa-onnx

English | [中文](README.zh.md)

This Service Provider mounts `sherpa-onnx-node` as the local speech-to-text engine on `ctx.voice` and owns the `/voice/api` loopback-only Host route the settings page and Ctrl+Shift+E dictation client call. Two shipped models prove the full pipeline: [`sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23`](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) (streaming, Chinese-only, ~74MB archive) and [`sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) (streaming, Chinese/English, ~511MB archive).

## Degraded mode

`sherpa-onnx-node`'s native addon (and its per-platform `optionalDependency` binary) is never imported at module top level — `sherpa-deps.ts` lazily `require`s it exactly once and caches the outcome, mirroring the `node-pty` lazy-load pattern in `@deepseek-ai/dsh-client-ui-better-sidebar`'s `pty-deps.ts`. A missing or broken native binding does not fail this plugin's load: `models.list` and `models.download` still work (cache status and download are pure Node/fetch logic with no native dependency), and only `transcribe` fails with a `VOICE_ENGINE_DEGRADED` diagnostic naming the load cause.

`engine-repair.ts` mirrors `pty-deps.ts`'s `findProfileDir`/`buildRepairCommand` pair exactly: it walks up from this plugin module to the nearest DSH profile root (falling back to `$DSH_HOME/profiles/web`) and builds a pasteable `dsh plugin --profile "<name>" install` command plus an `allowBuilds: sherpa-onnx-node: true` pnpm-workspace.yaml hint. The `engine.status` route method serves this exact repair hint to the settings page's Engine sub-section.

## Model cache

Each model downloads to `$DSH_HOME/models/voice/<id>/`. Sized archives use configurable concurrent HTTP ranges (`downloadSegmentBytes`, default 8 MiB; `downloadConcurrency`, default 4), retry transient failures up to `downloadMaxAttempts` (default 4) with exponential backoff starting at `downloadRetryDelayMs` (default 1,000 ms), abort a stalled range only after `downloadRequestTimeoutMs` (default 120,000 ms) without response bytes, retain complete ranges after an interruption, and resume only missing ranges; servers that ignore Range fall back to one whole-archive response. The assembled archive must match the model's pinned upstream SHA-256 before extraction begins; a mismatch deletes retained ranges so the next retry cannot reuse corrupted bytes. Archive bytes first assemble into a temporary file while the status is `downloading`; once the byte count completes, status changes to `extracting` and production delegates bzip2/tar extraction to the managed `ctx.subprocess` service (`tar -xjf ... --strip-components 1`) instead of burning Host CPU in the pure-JavaScript decoder. Tests retain an injectable pure-JavaScript extractor over the real bzip2/tar pipeline. One per-model operation and AbortController own cache inspection, download, extraction, and terminal cleanup; concurrent callers await that same operation. `models.remove` aborts and joins active work before clearing the cache and retained ranges, while Provider disposal aborts and joins active work but keeps completed ranges for a later resume. A `.dsh-voice-ready` sentinel is written only after extraction settles, and a failure becomes visible only after partial files are removed. A complete older extraction that lacks only that sentinel is adopted on restart after the Provider verifies every required encoder/decoder/joiner/tokens file is present and non-empty, so it does not download the archive again. `models.list` reports `not-downloaded`, byte-progress `downloading`, `extracting`, `ready`, or a retained `failed` reason that remains visible until the next retry.

## /voice/api route

Five methods, all POST, all loopback-only (the same DNS-rebinding / cross-site defense as `@deepseek-ai/dsh-client-ui-better-sidebar`'s `/sidebar/api`, copied rather than imported because that package does not export the helper):

- `engine.status` — the native-addon load state; `{ ok: true }` when `sherpa-onnx-node` loaded, otherwise `{ ok: false, cause, command, profile, note }` with the pasteable repair command.
- `models.list` — the shipped roster with live cache status.
- `models.download` — start (or await, if already in flight) a segmented, resumable model download.
- `models.remove` — cancel and join an active installation, then remove the installed model, retained failure, assembled archive, and resumable ranges.
- `transcribe` — decode a base64-encoded 16kHz mono PCM float32 clip and return its transcript; requires the target model to already report `ready`.

## Model Experience

### Transport-only Provider

#### What the model sees

None. This Provider contributes no model-visible text; the `/voice/api` `transcribe` method's result replaces composer keystrokes before a prompt is ever sent.

#### Token effect

None; the Provider adds no request or result tokens.

#### KV Cache effect

None; engine loading, model download/cache state, and transcription never enter a model request prefix.

## Known Limitations and Deferred Work

- **Two shipped models only** — see the group README's roadmap for the remaining upstream sherpa-onnx model families.
