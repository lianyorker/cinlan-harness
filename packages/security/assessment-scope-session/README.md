---
description: "Session binding provider for authorized assessment scope decisions."
kind: "package-reference"
---
# @deepseek-ai/dsh-assessment-scope-session

English | [中文](README.zh.md)

## Summary
This provider binds the active Session to an assessment scope and records the scope decision used by assessment consumers. It preserves the typed authorization grant while keeping target and operation policy in the scope service. Use it when a session must carry one explicit assessment context through a run.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount it with dsh-assessment-scope and a Session provider. The provider resolves the session-owned scope binding for consumers that enforce target, action, host, egress, and evidence policy.

<a id="model-experience"></a>
## Model Experience

Indirectly, through assessment consumers that apply the bound authorization policy.

#### KV Cache effect

No direct effect; scope decisions reach a model only through a consumer that includes authorized assessment results.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The provider does not grant targets or operations; the mounted scope remains the authority.
- A session binding cannot outlive the scope or Session provider that owns it.

No runtime invariant companion is published because the provider has no independent projection apart from the scope and Session services.

<a id="dev-note"></a>
### Dev Note

Keep authorization references and branded ids typed at the service boundary.
