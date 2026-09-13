---
description: "Typed security finding model, evidence rules, and lifecycle service contract."
kind: "package-reference"
---
# @deepseek-ai/dsh-finding

English | [中文](README.zh.md)

## Summary
This package defines durable security findings and their lifecycle states. A finding identity combines a rule, targets, and locations; revisions protect transitions; evidence and reachability fields distinguish observations from reproduced vulnerabilities and remediation. Providers own persistence while tools own model-facing access.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the service with dsh-finding-session or another provider. Use typed evidence for reproduction and remediation transitions, and keep artifact authorization aligned with the finding scope.

<a id="model-experience"></a>
## Model Experience

Indirectly, through finding tools that own model-visible schemas and result rendering.

#### KV Cache effect

No direct effect; finding state enters model context only when a consumer queries or exports it.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The service does not reproduce vulnerabilities or validate scanner claims by itself.
- Artifact retention and storage durability remain provider responsibilities.

No runtime invariant companion is published because this package defines the finding service contract and owns no persistence projection.

<a id="dev-note"></a>
### Dev Note

State transitions require the exact revision and typed prerequisite evidence; repeated identities increment occurrences rather than creating duplicates.
