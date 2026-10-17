---
description: "Retired experimental speech-input composition retained for source development."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-voice-input-bundle

English | [中文](README.zh.md)

## Summary

This retired bundle composes a speech Service Definition, local SenseVoice provider, authenticated Remote and browser microphone control. Shipped profiles use [built-in dictation](../../client/ui-voice-dictation/README.md); the official plugin list excludes this bundle.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use Settings > Voice for shipped Web and Desktop profiles. Profile loading removes this retired bundle from the selected bundle list while preserving installed packages and cached assets. See the [upgrade guide](../../../docs/upgrade-guide/v0.2.1-alpha.1/builtin-voice/guide.md) for migration details. The retained experimental source is not the shipped dictation path.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The retained `cordis.patch.yml` adds four experimental voice rows, selects `sensevoice-local` as the default recognizer and supplies the provider cache directory with `dshHomePath`. The browser contribution owns its generated Remote mount; stable API Remotes do not import experimental code. Shipped profiles do not compose these rows.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as recordings and preparation remain outside model requests; ordinary user submission owns any later text.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The initial bundle supplies one local recognizer. Additional providers register with the same service under distinct ids; cloud recognition requires an explicit new provider and credential configuration. The bundle does not add a model tool or change the agent loop.
- The retained source requires `sherpa-onnx-node` and its platform-specific native runtime, including ONNX Runtime. Model preparation has separate disk and download costs; native package size varies by platform and version.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
