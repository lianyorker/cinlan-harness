---
description: "Voice dictation preferences, microphone access, and local speech-model resources for the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-dictation

English | [中文](README.zh.md)

## Summary

Use Voice settings to choose a microphone, dictation mode, and preferred speech model. Install, reinstall, update, or remove model resources on the connected host, inspect its engine status, and test microphone capture and transcription. Dictation appends recognized text to the initiating session's current draft for review before sending. Preferences stay in the browser; audio processing and model resources belong to the host.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open Voice under AI and models in Settings. The page keeps searchable fields visible when dictation is disabled; dependent controls remain disabled. The microphone button appears when dictation is enabled and a host model is ready. This browser plugin has no plugin configuration fields.

### Preferences and resources

| Control | Storage or authority | Consumer and effect |
|---|---|---|
| Enable voice dictation | Browser `dsh.voice.settings.enabled` | The composer button and shortcut accept new dictation gestures when enabled. |
| Dictation mode | Browser `dsh.voice.settings.dictationMode` | Toggle mode starts/stops with Ctrl+Shift+E; hold mode stops when E or a modifier is released, or the window loses focus. The button always toggles. |
| Input device | Browser `dsh.voice.settings.microphoneDeviceId` | The next recording passes the selected device to `getUserMedia`; System default clears the device preference. |
| Microphone permission | Browser/OS; origin-local fallback | Request access releases its temporary tracks and refreshes device labels. An authoritative Permissions API prompt clears a stale grant; unsupported queries use the last permission decision. |
| Speech model | Browser `dsh.voice.settings.sttModel` | Transcription uses the selected ready model, otherwise the first ready model; Automatic clears the preference. |
| Engine and model resources | Connected host | Installation, reinstall, update, exact-task cancellation, and removal use the generated `voice` Remote over Web and desktop carriers. Removal requires an in-page confirmation. Operation failures show localized recovery guidance. |
| Microphone test | Page lifetime | An explicit click captures up to ten seconds from the selected device, displays input level, and sends bounded PCM to the selected ready model. The transcript stays on this page. |

Browser preference writes apply immediately. An unavailable saved microphone remains selected until the user chooses another device; it is never silently replaced or copied into host settings. A denied permission does not clear preferences. Storage rejection leaves the live settings usable, but changes cannot survive a reload.

The resource list displays the Host's source URLs, installation integrity, installed and available manifest fingerprints, and current task progress. Versions identify pinned manifests, not upstream releases; Check model versions refreshes the Host catalog status. Update is enabled only when the Host reports an available update. A replacement can remain ready while its task runs; cancellation targets that exact task without removing the installed model. Leaving settings does not cancel Host installation tasks. A degraded engine supplies a copyable repair command. Failed initial queries offer Retry; later query failures retain the last reported rows.

The microphone test remains disabled until the Host reports a ready engine and model. Stop releases microphone tracks before transcription; cancel, disabling dictation, and leaving the page release capture and suppress late results. A permission prompt that resolves after cancellation also releases its tracks. Audio is not saved, and the test never modifies or sends a Session draft. Empty transcripts and capture or Host failures show localized guidance.

### Dictation and drafts

The shortcut ignores editable fields, repeated keydown, composition events, and events already handled by another feature. The initiating session owns recording and insertion even if the user selects another session. Releasing a held shortcut also works when modifiers are released before E.

Stopping closes capture and releases microphone tracks before querying model availability or waiting for transcription. Recognized text is appended to the latest draft, including edits made during transcription. Empty transcripts leave it unchanged; permission, capture, missing-model, and host failures leave the draft intact and publish a composer error notice. Dictation does not send the draft.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[apply.ts](src/client/apply.ts) shares one browser-local preference store and dictation controller between settings, the shortcut, and the composer button, and supplies host operations as plain callbacks. Its section, six public metadata descriptors, and slot contribution share one declaration lifetime; disposal removes them together. Metadata contains localized labels, descriptions, and keywords without preference values, device identities, model paths, or transcripts. Stable anchors remain mounted so search navigation does not enable dictation as a side effect.

[VoiceSettingsSection.tsx](src/client/VoiceSettingsSection.tsx) owns permission prompts and device enumeration, consumes host resource status, and renders native settings rows within the shell's content width. [dictation-controller.ts](src/client/dictation-controller.ts) captures PCM, chooses the ready model, and appends through the conversation input API. Plugin disposal invalidates publication, aborts pending Remote calls, closes active capture, and awaits owned asynchronous operations before returning.

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
- Capture uses deprecated `ScriptProcessorNode`; some browser/audio-driver combinations can yield nearly silent samples and an empty transcript. Moving capture to `AudioWorkletNode` requires a served worklet module.
- Automatic punctuation and alternate insertion destinations are not preferences provided by this package.
