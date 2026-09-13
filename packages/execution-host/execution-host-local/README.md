---
description: "Local process execution-host provider for artifact provenance."
kind: "package-reference"
---
# @deepseek-ai/dsh-execution-host-local

English | [中文](README.zh.md)

## Summary
This provider creates one execution-host identity for the current local process. It records a generated opaque id together with hostname, PID, platform, and creation time, then serves that immutable record through ctx.executionHost. Use it in local profiles that need truthful evidence provenance without external attestation.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the provider as the executionHost implementation before artifact and assessment consumers. The provider has no configuration and returns the same record for the lifetime of its Cordis service.

<a id="model-experience"></a>
## Model Experience

None, as the local execution-host provider registers no prompt, tool, or Session event.

#### KV Cache effect

None; local host metadata does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The generated id is process-local and is not a durable machine identity.
- Remote hosts require a different provider that implements the execution-host service.

No runtime invariant companion is published because the provider owns one immutable identity record and exposes no diverging observation.

<a id="dev-note"></a>
### Dev Note

The provider derives its host id internally; callers cannot configure or override it.
