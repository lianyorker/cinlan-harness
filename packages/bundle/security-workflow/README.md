---
description: "Installable bundle for the security workflow system-prompt section."
kind: "package-bundle"
---
# @deepseek-ai/dsh-security-workflow

English | [中文](README.zh.md)

## Summary
This bundle loads the security workflow prompt contribution. It teaches the model to coordinate scan, record, triage, fix, retest, and report phases through existing workflow, finding, and vulnerability tools without granting a target or forcing a phase transition.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Load the bundle with dsh-system-prompt and the security research tool consumers. The prompt section is stable and its order is owned by the security-workflow-prompt package.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the security-workflow-prompt system-prompt contribution.

#### KV Cache effect

The loaded workflow section contributes stable system-prefix text until the prompt composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The bundle references external scanners but does not install or authorize them.
- Finding and assessment services remain responsible for typed evidence and authorization checks.

No runtime invariant companion is published because the bundle composes a prompt plugin and owns no independent mutable state.

<a id="dev-note"></a>
### Dev Note

Keep the prompt source and its model-facing README synchronized.
