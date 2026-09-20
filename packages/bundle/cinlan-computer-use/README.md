---
description: "Opt-in native Cua Driver desktop tools with approval required by default."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-computer-use

English | [中文](README.zh.md)

## Summary

Add native Cua Driver desktop tools to an explicitly selected profile. Every native call asks for approval by default. The SDK runs inside the Harness host and requires its desktop permissions and a logged-on graphical session.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Compose this opt-in profile patch layer after [dsh-base](../base/README.md). Profiles that do not name the bundle do not gain desktop input. Profile installation and layer ordering are owned by [app-boot](../../boot/app-boot/README.md#profiles).

The [patch](cordis.patch.yml) selects `cua-driver-native` on the [computer-use service](../../computer-use/computer-use/README.md), mounts the [native Cua Driver provider](../../experimental/computer-use-cua-driver-native/README.md), and configures the [permission policy](../../computer-use/computer-use-permission-policy/README.md) with `native: ask`. These are the three rows in this layer. CUA publishes its discovered upstream tools; the layer contains neither an Orca provider nor `tool-computer-use`.

A later profile patch replaces the complete `computer-use-permission-policy` row config to set `native` to `allow`, `ask`, or `deny`. The `computer-use-cua-driver-native` row has no provider configuration fields. Switching providers requires unloading the current provider and waiting for owned work to close.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This bundle owns composition only. The service owns exclusive registration, the provider owns SDK discovery and lifecycle readiness, and the policy guards every `cua_driver_native__*` execution, including future upstream additions. The [architecture decision](../../../.agents/notes/implemented/architecture/2026-09-20-native-cua-readiness-and-policy.md) explains why readiness and authorization remain separate.

No runtime invariant companion is published: this layer declares rows and retains no independent runtime state to compare.

</details>

<a id="model-experience"></a>
## Model Experience

### Native desktop tools

#### What the model sees

The model receives the discovered `cua_driver_native__*` tools and [native provider guidance](../../experimental/computer-use-cua-driver-native/README.md#model-experience). Approval and denial text belongs to the permission policy. The bundle adds no model text of its own.

#### Token effect

The discovered schemas and native guidance contribute request tokens. Text, accessibility observations, and admitted screenshot attachments add operation-dependent result tokens.

#### KV Cache effect

A fixed catalog and guidance preserve the request prefix. Changing the provider or discovered catalog can reduce prefix reuse.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The profile must supply tools, system-prompt, and approval services. Screenshots require an attachment store and a model route that declares image input.
- A profile without an approval answerer cannot approve the default `ask` calls.
- The SDK is packaged through platform optional dependencies. Native library placement, licenses, and host requirements belong to the provider; catalog readiness does not prove GUI actions or packaged loading.
- Desktop control shares the host process and desktop. The layer does not add a native client shell, reserve windows per Session, or supply mobile-device capabilities.

### Dev Note

Profile installation and controlled GUI smoke verification are owned by the integrating task; this documentation update does not assert either result.
