---
description: "Opt-in native Work Items composition with external writes disabled by default."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-work-items

English | [中文](README.zh.md)

## Summary

This bundle composes native GitHub/Linear providers, the Work Items registry and write ledger, model tools, a Host Remote controller, and a localized Web Settings page. The optional work-items profile includes it; ordinary Web profiles do not mount it.

## Table of Contents

- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="composition"></a>
## Composition

Apply this bundle after dsh-base and dsh-web-app. Provider scopes remain deployment-owned: GitHub requires owner/repository; Linear requires team or project. Credentials resolve through Host credential references. Missing scopes leave providers unavailable, not connected to guessed accounts.

The repository command below prints the supported profile composition without starting a server:

~~~sh
pnpm dsh --profile work-items --dump-config
~~~

Both providers start with allowWrites: false. A later patch may enable a provider, but each mutation still requires a durable preview and separate confirmation. Uninstalling the bundle removes its tools and Settings page without deleting stored associations or receipts.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [tool Consumer](../../work-items/tool-work-items/README.md), which contributes list/get and prepare/confirm/cancel/history tools and stable guidance.

#### KV Cache effect

The tool schemas and guidance add a fixed request-prefix contribution while the bundle is mounted.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Provider scope discovery, dedicated credential/setup UI, GitHub Enterprise origins, and automatic synchronization are not provided.
- Live GitHub/Linear accounts require separate verification; local tests substitute external HTTP, not the native providers.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because this bundle owns static composition and no independent runtime state. Service, persistence, and UI behavior remain in their owning packages.
