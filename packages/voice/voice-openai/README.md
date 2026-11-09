---
description: "Use OpenAI cloud transcription models through the shared Voice runtime and Host credentials."
kind: "package-reference"
---

# OpenAI voice provider

English | [中文](README.zh.md)

## Summary

Select OpenAI transcription models from Voice settings and send complete 16 kHz mono clips to the configured API endpoint. The provider reads `OPENAI_API_KEY` from the Host credential service; clients can save, rotate, clear, and inspect credential presence without receiving the secret. Cloud calls require network access and do not support streaming or local model installation.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider beside [`voice`](../voice/README.md), a credentials provider, and the [authenticated Voice Controller](../../api/voice-controller/README.md). Add the package to the active bundle and register it in the Loader manifest. No API key belongs in `cordis.yml`.

```yaml
- name: '@cinlan/voice-openai'
  config:
    baseURL: https://api.openai.com/v1
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://api.openai.com/v1` | HTTP endpoint origin and version prefix without credentials, query, or fragment. |
| `requestTimeoutMs` | `120000` | Maximum transcription request duration. |
| `responseMaxBytes` | `1048576` | Maximum accepted JSON response bytes. |

The provider registers GPT-4o mini Transcribe and GPT-4o Transcribe. Voice settings stores the key through the authenticated Host Remote; the provider sends WAV multipart requests with `response_format=json` and an optional language hint. An upstream error body is never returned to the client.

<a id="model-experience"></a>
## Model Experience

None, as transcription returns editable draft text and does not submit a Session message or add tools or prompt context.

#### KV Cache effect

None until the user submits the resulting text through the ordinary conversation flow.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The provider accepts complete clips only; it does not expose streaming transcription, local downloads, or model removal.
- A configured credential is required before cloud models report ready. The provider does not validate key usability until the upstream request runs.

### Dev Note

The [voice resource decision](../../../.agents/notes/implemented/feature/2026-09-14-voice-dictation-models-and-capture.md) records provider routing, credential ownership, and imported model lifecycle.
