---
kind: upgrade-guide
description: Voice dictation is built into GUI profiles and replaces the optional experimental voice bundle and previous model selectors.
---

# Built-in Voice Dictation

English | [中文](guide.zh.md)

## Change

Web and Desktop profiles provide voice dictation through Settings > Voice. The official plugin catalog does not offer `@deepseek-ai/dsh-experimental-voice-input-bundle`; profile loading removes that retired bundle from the selected bundles. Its experimental `speechToText` settings and model cache are not imported into built-in dictation.

The built-in catalog uses Orca's ten local models. Four previous selectors change to Orca IDs, and Whisper Tiny uses automatic language detection. Browser model preferences migrate automatically; existing cache directories are not moved or deleted.

## Migration

1. Open the usual `web` or `desktop` profile. Remove experimental speech entries from custom `cordis.patch.yml` files; they are not part of built-in dictation.
2. Open Settings > Voice and download the desired model from the Speech Model menu. Renamed models need a new installation. SenseVoice retains its ID and verified installation; an installed Whisper Tiny exposes an update for its automatic-language configuration.
3. Select a ready model, test microphone transcription, and confirm text appears before using dictation in the composer. Dictation keeps the existing `Ctrl+Shift+E` shortcut and does not send the draft automatically.

See the [voice provider](../../../../packages/voice/voice-sherpa-onnx/README.md) for cache and verification semantics. Old experimental caches remain available for manual cleanup after the replacement is verified.
