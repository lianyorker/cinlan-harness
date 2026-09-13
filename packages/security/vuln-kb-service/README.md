---
description: "Vulnerability knowledge-base service contract and provider runtime."
kind: "package-reference"
---
# @deepseek-ai/dsh-vuln-kb-service

English | [中文](README.zh.md)

## Summary
This package defines the vulnerability knowledge-base service and a runtime that delegates queries to the active provider. Callers can query by CVE or ecosystem/package/version and read one CVE with full details. Provider selection remains explicit, while the runtime keeps request and result types stable for tools and workflow consumers.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount one knowledge-base provider and dsh-tool-vuln-kb when model-facing vulnerability lookup is required. Keep upstream network policy in the provider configuration.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the vulnerability query consumer that owns model-visible schemas.

#### KV Cache effect

No direct effect; knowledge-base results enter model context only through a query consumer.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The service does not merge multiple providers or guarantee upstream freshness.
- Provider-specific credentials and rate limits remain outside this package.

No runtime invariant companion is published because this package owns the service contract and delegates mutable provider state.

<a id="dev-note"></a>
### Dev Note

CVE ids and package coordinates remain opaque typed values at the service boundary.
