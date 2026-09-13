---
description: "Installable bundle for vulnerability knowledge-base service, providers, and tools."
kind: "package-bundle"
---
# @deepseek-ai/dsh-vuln-kb

English | [中文](README.zh.md)

## Summary
This bundle composes the vulnerability knowledge-base service, its provider adapters, and the model-facing lookup tools. A profile can query CVEs and package coordinates through one typed namespace while keeping upstream network policy and freshness in the selected provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Load the bundle with a provider such as NVD and the core tool registry. Configure network access and request limits explicitly in the profile.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the vulnerability lookup tools inserted by this bundle.

#### KV Cache effect

The tool schemas may contribute stable model tool-prefix content; provider data enters requests only after a query.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Upstream availability, rate limits, and freshness remain provider concerns.
- Knowledge-base results do not prove exploitability or authorize remediation.

No runtime invariant companion is published because this bundle composes service and consumer packages without a separate mutable projection.

<a id="dev-note"></a>
### Dev Note

Keep the Loader patch as an insert list and regenerate the tool catalog after schema changes.
