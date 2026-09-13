---
description: "Installable bundle for the security research skill catalog."
kind: "package-bundle"
---
# @deepseek-ai/dsh-security-skills-bundle

English | [中文](README.zh.md)

## Summary
This bundle loads the security skill provider and its immutable reference assets into the Harness skill registry. It gives a profile reusable guidance for common application, infrastructure, mobile, binary, and supply-chain research workflows.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Load the bundle through a dsh profile with the skill registry. Skill content does not grant assessment targets or bypass the assessment-scope service.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the skill consumer that loads a selected skill into model context.

#### KV Cache effect

Only selected skill content affects model requests; the bundle itself contributes no additional prompt prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Skill assets are shipped with the bundle and are not edited through Web Settings.
- Guidance remains advisory; authorization and evidence requirements are enforced by other packages.

No runtime invariant companion is published because the bundle only composes an immutable skill contribution.

<a id="dev-note"></a>
### Dev Note

The bundle Loader root is an entry array; keep asset paths and skill ids synchronized.
