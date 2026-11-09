---
description: "Voice dictation preferences, microphone access, and local speech-model resources for the Web client."
kind: "package-reference"
---

# @cinlan/client-ui-voice-dictation

English | [中文](README.zh.md)

## Summary

Use Voice settings to choose a microphone, dictation mode, and preferred speech model. Install, reinstall, update, or remove model resources on the connected host, inspect its engine status, and test microphone capture and transcription. Dictation inserts recognized text into the text surface that had focus when recording started; the managed composer continues to use the initiating session's draft for review before sending. Preferences stay in the browser; audio processing and model resources belong to the host.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open Voice in Settings. Web and Desktop profiles include dictation without an optional voice plugin. The page keeps searchable fields visible when dictation is disabled; dependent controls remain disabled. The microphone button appears when dictation is enabled and a host model is ready. An app-frame status strip also appears during recording startup, recording, and transcription; it remains visible across session navigation, and its stop action is disabled during transcription. This browser plugin has no plugin configuration fields.

### Preferences and resources

| Control | Storage or authority | Consumer and effect |
|---|---|---|
| Enable voice dictation | Browser `dsh.voice.settings.enabled` | The composer button and shortcut accept new dictation gestures when enabled. |
| Dictation mode | Browser `dsh.voice.settings.dictationMode` | Settings shows the Ctrl+Shift+E shortcut. Toggle mode starts/stops with it; hold mode stops when E or a modifier is released, or the window loses focus. The button always toggles. |
| Terminal insertion confirmation | Browser `dsh.voice.settings.terminalConfirmBeforeInsert` | Off by default. When enabled, a completed transcript captured for a terminal asks for confirmation before insertion; declining leaves the terminal unchanged. Other text targets are unaffected. |
| Input device | Browser `dsh.voice.settings.microphoneDeviceId` | The next recording passes the selected device to `getUserMedia`; if it is missing or no longer satisfies the exact device constraint, that recording retries with the system default and reports the fallback without changing the saved preference. System default clears the preference. |
| Microphone permission | Browser/OS; origin-local fallback | Request access releases its temporary tracks and refreshes device labels. An authoritative Permissions API prompt clears a stale grant; unsupported queries use the last permission decision. |
| Speech model | Browser `dsh.voice.settings.sttModel` | Transcription uses the selected ready model, otherwise the first ready model; Automatic clears the preference. |
| Language | Browser `dsh.voice.settings.language` | `auto`, Chinese, English, Japanese, or Korean is forwarded to OpenAI, Whisper, and SenseVoice models; other local models use their catalog language. |
| OpenAI API key | Host credentials | The settings page stores, rotates, reports, and clears `OPENAI_API_KEY` without exposing its value; cloud models become ready while the credential is configured. |
| Engine and model resources | Connected host | Installation, reinstall, update, exact-task cancellation, and removal use the generated `voice` Remote over Web and desktop carriers. Removal requires an in-page confirmation. Operation failures show localized recovery guidance. |
| Microphone test | Page lifetime | An explicit click captures up to ten seconds from the selected device, displays input level, and sends bounded PCM to the selected ready model. The transcript stays on this page. |

Browser preference writes apply immediately. An unavailable saved microphone remains selected. When exact-device capture reports `NotFoundError` or `OverconstrainedError`, that recording retries once with the system default and reports the fallback in the initiating session; permission denial and other capture failures do not trigger fallback. The preference is not copied into Host settings. Denying permission does not clear it. If storage rejects a write, the current value remains usable but the change will not survive reload.

The Speech Model menu contains model selection and resource actions, with localized descriptions, language coverage, recognition family, and size. Only ready models are selectable; downloading does not change the preference. Expand Model details for source URLs, integrity, and installed and available manifest fingerprints. Versions identify pinned manifests, not upstream releases; Check model versions refreshes the Host catalog status. Update is enabled only when the Host reports an available update. A replacement can remain ready while its task runs; cancellation targets that exact task without removing the installed model. Leaving settings does not cancel Host installation tasks. A degraded engine supplies a copyable repair command. Failed initial queries offer Retry; later query failures retain the last reported rows.

The page can import a Host directory containing `clh-voice-model.json`; the Host validates and copies the model into managed storage while leaving the source directory unchanged. OpenAI cloud models use the Host credential and never expose a local cache directory.

The microphone test remains disabled until the Host reports a ready engine and model. Stop releases microphone tracks before transcription; cancel, disabling dictation, and leaving the page release capture and suppress late results. A permission prompt that resolves after cancellation also releases its tracks. Audio is not saved, and the test never modifies or sends a Session draft. Empty transcripts and capture or Host failures show localized guidance.

### Dictation and drafts

The shortcut ignores editable fields, repeated keydown, composition events, and events already handled by another feature. The initiating session owns recording and insertion even if the user selects another session. Releasing a held shortcut also works when modifiers are released before E.

The selected ready model is resolved before microphone access. Online models stream resampled PCM in bounded 100 ms chunks over the authenticated `voice` Remote; partial hypotheses appear in the app status strip, while only a completed final transcript can be inserted. If the stream is cancelled or fails, partial text is discarded. Offline models retain the complete recording and use the existing unary transcription call. Stopping closes capture and releases microphone tracks before ending the uplink or waiting for transcription. The target is captured before the microphone request: inputs and textareas receive the text at their original selection, `contentEditable` surfaces receive it at their original range, and the sidebar terminal receives a local insertion event. Terminal confirmation is off by default and applies only to captured terminal targets. The managed composer continues to append to the latest draft, including edits made during transcription. Existing whitespace is preserved. A separating space is added between adjacent non-CJK letters or numbers, or after Latin punctuation before a word; CJK edges, brackets, and closing punctuation do not gain a space. Empty transcripts leave the target unchanged; permission, capture, missing-model, and host failures leave the draft intact and publish a composer error notice. Dictation does not send the draft.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[apply.ts](src/client/apply.ts) shares one browser-local preference store and dictation controller between settings, the shortcut, the composer button, and the app-level status strip, and supplies host operations as plain callbacks. Its section, public metadata descriptors, and slot contributions share one declaration lifetime; disposal removes them together. Metadata contains localized labels, descriptions, and keywords without preference values, device identities, model paths, or transcripts. Stable anchors remain mounted so search navigation does not enable dictation as a side effect.

[VoiceSettingsSection.tsx](src/client/VoiceSettingsSection.tsx) owns permission prompts and device enumeration, consumes host resource status, and renders native settings rows within the shell's content width. [dictation-controller.ts](src/client/dictation-controller.ts) resolves the ready model before microphone access, streams online PCM uplink, and routes only final text to the captured insertion target or the conversation input API. [dictation.ts](src/client/dictation.ts) resamples worklet frames continuously and batches them into bounded chunks. [insertion-target.ts](src/client/insertion-target.ts) restores selections and emits `input` events for controlled text surfaces. Plugin disposal invalidates publication, aborts pending Remote calls, closes active capture, and awaits owned asynchronous operations before returning.

[Package tests](tests/) cover metadata lifetime and locale changes, preferences across remounts, microphone/device outcomes, host resource operations, and dictation draft preservation.

</details>

-----

<a id="dev-note"></a>
## Dev Note

None.

-----

<a id="model-experience"></a>
## Model Experience

### Draft-only dictation

#### What the model sees

None until the user sends the draft. Submitted text follows the ordinary composer path as a `user` message; this package contributes no prompt, schema, or tool.

#### Token effect

None from settings, recording, or transcription. Sent draft text consumes ordinary user-message tokens.

#### KV Cache effect

None from voice preferences, permissions, or model resources; those facts do not enter the model request prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because slot, locale, and shortcut registrations use owner-managed effects; the dictation UI keeps no independent copy of those registrations.

Voice depends on browser capture and a reachable host provider.

- Web and Desktop share the generated `voice` Remote. Engine readiness still depends on the local sherpa-onnx native module and model files; the page reports degradation and repair guidance.
- Browser microphone permissions and device identities do not synchronize across devices or origins. A stored permission fallback cannot grant browser or OS access.
- Capture uses an inline `AudioWorkletNode` processor and linearly resamples received frames to 16 kHz. Chromium browser coverage verifies Blob module loading and nonzero frames from its fake microphone. This does not establish physical-device amplitude or model accuracy; those remain separate acceptance checks.
- Streaming models provide partial hypotheses while recording. Offline models retain a complete recording and transcribe after stop; no separate startup buffer is used.
- If a microphone track ends during dictation, capture is closed, the incomplete audio is discarded, and the initiating session receives an error notice. A later attempt can retry the saved device or use the reported system-default fallback when exact-device acquisition says that device is missing.
- Automatic punctuation remains deferred.
