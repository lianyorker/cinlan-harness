# Voice dictation: six-model roster, ScriptProcessorNode capture, hf-mirror, friendly download errors

## Context

The voice dictation feature shipped with only two archive models from GitHub releases. Four additional HuggingFace-sourced models were registered but could not download because `huggingface.co` is unreachable in the operator's network. The original `MediaRecorder` + `decodeAudioData` audio capture pipeline produced near-zero amplitude samples, resulting in empty transcription. Download errors showed raw `fetch failed` messages with no actionable hint.

## Decision

1. **HuggingFace mirror**: Hardcode `hf-mirror.com` in `model-registry.ts` for all four file-download models. GitHub release archive models keep their original URLs (GitHub is reachable).

2. **Friendly download errors**: Add `friendlyDownloadError()` in `model-cache.ts` that pattern-matches `fetch failed`, `ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `Connect Timeout`, `UND_ERR_CONNECT_TIMEOUT` and returns a Chinese message prompting the user to check their network or enable a proxy. The retained failure string (shown in the settings UI) now uses this translation instead of the raw error message.

3. **ScriptProcessorNode capture**: Replace `MediaRecorder` + `decodeAudioData` with `ScriptProcessorNode` at the system's native sample rate, followed by linear-interpolation resampling to 16kHz. Disable browser audio processing (`echoCancellation`, `noiseSuppression`, `autoGainControl`) in `getUserMedia` constraints to prevent the browser from suppressing microphone input.

4. **Dropdown menu upward**: The model selector dropdown in `VoiceSettingsSection` now opens upward (`bottom: calc(100% + 4px)`) to avoid pushing down the settings panel content.

## Remaining issue

Transcription still returns empty on the operator's browser because `ScriptProcessorNode` produces near-zero samples (amplitude ~1e-11). This is a known browser/audio-driver issue; migration to `AudioWorkletNode` is tracked as future work. The `MediaRecorder` + `decodeAudioData` path also produced near-zero samples (~1e-35), confirming the issue is upstream of the capture API choice.

## Files

- `packages/voice/voice-sherpa-onnx/src/model-registry.ts` — `hfFile()` URL changed to `hf-mirror.com`
- `packages/voice/voice-sherpa-onnx/src/model-cache.ts` — `friendlyDownloadError()` added; failure retention uses it
- `packages/client/ui-voice-dictation/src/client/dictation.ts` — `ScriptProcessorNode` capture + `resampleToMono16k()`
- `packages/client/ui-voice-dictation/src/client/dictation-controller.ts` — disabled audio processing constraints; removed `decodeAndResample`
- `packages/client/ui-voice-dictation/src/client/VoiceSettingsSection.module.css` — dropdown opens upward
- READMEs updated for all three voice packages (EN + ZH)
