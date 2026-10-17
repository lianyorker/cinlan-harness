# Agent Note: Built-in dictation with host-owned speech models

Status: implemented

English | [中文](2026-10-07-builtin-voice-dictation.zh.md)

## Problem

GUI voice settings and an optional experimental recording control expose separate model preparation and preference flows. Composing both gives users duplicate microphone controls and makes the active recognizer unclear.

## Decision

GUI profiles compose the voice service, local sherpa-onnx provider, authenticated Remote, and dictation UI as built-in capabilities. Settings owns microphone and recognition preferences; the model menu contains selection and resource actions. The local catalog uses Orca's pinned ONNX models. Downloads remain explicit and verify exact byte counts and SHA-256 before publication. Only ready models are selectable.

The experimental voice bundle is retired from the official catalog and removed from selected profile bundles during loading. Installed packages and caches remain intact. Its retained source and provider semantics are documented by the [experimental voice decision](2026-09-16-experimental-voice-input.md); shipped GUI dictation uses the [voice subsystem](../../../../docs/subsystems/voice.md).

## Alternatives considered

**Keep experimental voice as a second optional control.** This preserves its independent preparation flow but leaves two recording controls and two preference stores in one GUI.

**Delete or silently import experimental caches.** This reduces apparent duplication but risks data loss or treating incompatible manifests and settings as verified built-in models. Retirement preserves the files; the [upgrade guide](../../../../docs/upgrade-guide/v0.2.1-alpha.1/builtin-voice/guide.md) defines the explicit replacement path.

## Consequences

The GUI has one dictation entry point while carrying the native runtime in its installation. Model downloads, microphone permission, and recording still require user action. Local processing means the connected Host, which can be remote. No cloud recognizer is imported from Orca, and transcription alone never starts a model turn.

Verification covers catalog pins, offline and streaming recognizer routing, verified resource publication, retirement, browser preference migration, menu interactions, and draft-only dictation followed by Session replay. Real-model recognition accuracy and packaged desktop microphone behavior require separate platform acceptance.
