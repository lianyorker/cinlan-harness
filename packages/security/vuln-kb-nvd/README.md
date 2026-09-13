---
description: "NVD-backed vulnerability knowledge-base provider."
kind: "package-reference"
---
# @deepseek-ai/dsh-vuln-kb-nvd

English | [中文](README.zh.md)

## Summary
This provider retrieves vulnerability entries from the NVD service and adapts them to the vulnerability knowledge-base contract. It supports CVE reads and ecosystem/package queries through the runtime service while preserving bounded result fields and cancellation. Use it when a security profile has network access to NVD.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the provider with dsh-vuln-kb-service and configure the NVD endpoint and request limits. Mount dsh-tool-vuln-kb to expose the service to the model.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the vulnerability query consumer that owns model-visible schemas.

#### KV Cache effect

No direct effect; only a consumer vulnerability result can enter a model request.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- NVD availability, rate limits, and response freshness depend on the upstream service.
- The provider does not infer authorization for a target or remediation action.

No runtime invariant companion is published because the provider owns no independent mutable projection beyond the knowledge-base service.

<a id="dev-note"></a>
### Dev Note

Keep network access and endpoint configuration explicit in the profile.
