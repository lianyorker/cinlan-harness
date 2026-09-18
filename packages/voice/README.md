---
description: "Local voice transcription Service Definition and sherpa-onnx Provider packages."
kind: "package-group"
---

# voice/ — local voice transcription

English | [中文](README.zh.md)

## Summary

The `voice/` group owns the engine, model, and shared operation interfaces for local speech transcription and the sherpa-onnx Provider. Microphone capture and authenticated Remote projection belong to their consuming packages.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`voice/`](voice/README.md) | Service Definition for engine/model registration and cancellable model/transcription operations |
| [`voice-sherpa-onnx/`](voice-sherpa-onnx/README.md) | Local engine Provider, model cache/download lifecycle, and recognition |

<a id="related-documentation"></a>
## Related documentation

- [Voice subsystem reference](../../docs/subsystems/voice.md) — model definitions, operation results, engine interfaces, and the Cordis API.
- [Voice Controller](../api/voice-controller/README.md) — authenticated human Remote requests and PCM validation.
