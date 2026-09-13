---
description: "Settings-backed mutable assessment scope Provider for operator-owned grants."
kind: "package-reference"
---

# @deepseek-ai/dsh-assessment-scope-settings

English | [中文](README.zh.md)

## Summary

This Provider stores the operator-owned assessment root grant in the Harness Settings document and exposes the canonical grant through `ctx.assessmentScope`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount `dsh-settings` and a writable Settings Provider before this package. The `assessment-scope` namespace accepts only grant metadata and credential references; it never stores secret values. Every update is schema-validated and canonicalized before the live root grant changes.

Root reads resolve the committed Settings value directly; asynchronous watchers cannot delay policy revocation. Existing Session grants never acquire expanded authority. Narrowing, changing target definitions, or changing grant/engagement identity can invalidate existing bindings; create a new Session after changing assessment authority. No independent policy state or invariant companion is retained.

<a id="model-experience"></a>
## Model Experience

### Assessment policy input

#### What the model sees

No prompt or tool is registered here. A Consumer may read the canonical `ctx.assessmentScope` policy before exposing an effect.

#### Token effect

No tokens are added by this Provider; any model-visible decision text belongs to the effect-owning Consumer.

#### KV Cache effect

No cache prefix is changed by assessment-scope settings.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- This package stores the root grant but does not provide a settings UI, authorization document workflow, or effect guard for arbitrary Consumers.
- Existing Session bindings remain subject to the assessment-scope-session restore and revalidation rules.

No runtime invariant companion is published because root reads derive directly from committed Settings and retain no independent policy projection.

<a id="dev-note"></a>
### Dev Note

Use path-addressed Settings mutations when a redacted configuration surface edits one field; do not replace the whole section from a redacted view.
