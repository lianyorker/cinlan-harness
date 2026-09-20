---
description: "Provider activation defaults for Web and Desktop profile composition."
kind: "package-bundle"
---
# Web capability defaults

English | [中文](README.zh.md)

## Summary

This configuration-only bundle keeps the configured Browser and Computer Use providers disabled until the user enables them. It contains two patches and no plugin entrypoint.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The default Web and Desktop profiles apply this bundle after [Browser](../cinlan-browser/README.md) and [Computer Use](../cinlan-computer-use/README.md), and before user patches. It sets `disabled: true` on `browser-playwright` and `computer-use-cua-driver-native`; it inserts no entries and changes no provider configuration. The service, resource management, permission policies, and Settings remain composed.

Enable a configured provider through Settings and the official Plugin Manager. Its profile patch follows this bundle, so `disabled: false` overrides the shipped default. A later home or command-line patch can still override that choice. Enabling a provider does not grant action permission or prove browser/native readiness.

The explicit `browser` and `device-control` profiles omit this layer and retain their enabled providers. Mobile device composition is unaffected.

<a id="model-experience"></a>
## Model Experience

#### What the model sees

Only tools registered by active providers and consumers. This bundle contributes no model-visible text.

#### Token effect

No direct tokens; enabling a provider may expose its tools.

#### KV Cache effect

No direct prefix changes; the active tool catalog determines downstream changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

Both target entries must already exist. This bundle supplies activation defaults only; provider installation, resource integrity, readiness, and action authorization remain with their owners. No runtime invariant companion is published because the package only applies two Loader patches and holds no runtime state.

## Dev Note

The [native CUA decision](../../../.agents/notes/implemented/architecture/2026-09-20-native-cua-readiness-and-policy.md) records default composition and user activation ownership.
