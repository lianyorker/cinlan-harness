---
description: "Strict configuration provider for assessment target and operation authorization."
kind: "package-reference"
---
# @deepseek-ai/dsh-assessment-scope-static

English | [中文](README.zh.md)

## Summary
This provider loads one operator-defined assessment grant and exposes it through the assessment-scope service. It validates time bounds, execution-host ids, target selectors, action permissions, egress rules, credential references, and evidence policy before publishing the grant. An empty grant is valid and denies assessment work.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the provider with an explicit root grant under the assessment-scope service. Keep authorized targets, operations, execution hosts, and evidence rules in a later profile patch rather than relying on defaults.

<a id="model-experience"></a>
## Model Experience

Indirectly, through assessment consumers that apply the configured authorization policy.

#### KV Cache effect

No direct effect; scope configuration reaches a model only through a consumer that includes authorized assessment results.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The provider does not execute assessment actions or attest target ownership.
- Scope changes require a new provider configuration and do not mutate an active grant in place.

No runtime invariant companion is published because the provider publishes one validated immutable grant and has no separate mutable observation.

<a id="dev-note"></a>
### Dev Note

The security-research profile intentionally mounts an empty non-authorizing grant.
