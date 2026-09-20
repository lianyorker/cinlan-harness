---
description: "Installable bundle for the security research skill catalog."
kind: "package-bundle"
---
# @deepseek-ai/dsh-security-skills-bundle

English | [中文](README.zh.md)

## Summary
This bundle loads the security skill provider into the Harness skill registry; the provider discovers the resource manager’s active installation. It gives a profile reusable guidance for common application, infrastructure, mobile, binary, and supply-chain research workflows.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Load the bundle through a dsh profile with the skill registry and the [resource manager](../../security/security-skills/README.md). The Web bundle supplies the manager; other compositions explicitly mount `@deepseek-ai/dsh-security-skills/resources` once at the Host root. Install resources through Security Research settings before loading their skills. Skill content does not grant assessment targets or bypass the assessment-scope service.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the skill consumer that loads a selected skill into model context.

#### KV Cache effect

Only selected skill content affects model requests; the bundle itself contributes no additional prompt prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Packaged assets are an explicit installation source. Network download requires a configured release manifest URL; the bundle does not infer a public endpoint.
- Guidance remains advisory; authorization and evidence requirements are enforced by other packages.

No runtime invariant companion is published because the bundle only composes the provider; installation state and retention belong to the resource manager.

<a id="dev-note"></a>
### Dev Note

The bundle Loader root is an entry array; keep asset paths and skill ids synchronized.
