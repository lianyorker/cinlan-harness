---
description: "Provider-neutral registry and desktop observation/action requests."
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use

English | [中文](README.zh.md)

## Summary

Provider-neutral registry and desktop observation/action requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This Service Definition owns the provider-neutral `ctx.computerUse` registry and execution facade for local desktop applications. Providers own platform transport, capability discovery, application and window identity, accessibility observations, screenshot bytes, and action execution; Consumers own permission policy, model schemas, attachment persistence, and presentation.

## Provider selection

The optional `provider` config pins one provider id. Without it, every call selects exactly one currently available provider. Selection failures are structured `ComputerUseError` values:

| Condition | Code |
|---|---|
| Configured provider is not registered | `COMPUTER_PROVIDER_CONFIGURED_MISSING` |
| Configured provider is unavailable | `COMPUTER_PROVIDER_CONFIGURED_UNAVAILABLE` |
| No usable provider exists | `COMPUTER_PROVIDER_UNAVAILABLE` |
| More than one usable provider exists | `COMPUTER_PROVIDER_AMBIGUOUS` |
| Provider id is blank or duplicated | `COMPUTER_PROVIDER_ID_INVALID` / `COMPUTER_PROVIDER_DUPLICATE` |

Selection occurs for every call, so provider disposal and availability changes do not leave a cached backend selection.

## Identity and observations

`ComputerAppId` and `ComputerWindowId` are opaque provider-issued selectors. `ComputerObservationId` identifies one short-lived accessibility observation, and each `ComputerElementId` is valid only inside that exact observation. Every mutation requires the application, window, and observation ids; a successful action returns a fresh observation that replaces the prior element scope.

The service exposes capability discovery, application and window listing, observation, click, secondary accessibility action, scroll, drag, literal typing, key press, hotkey, paste, and value setting. `ComputerUseProvider` returns structured values and optional validated PNG bytes; it does not decide tool schemas, approval text, model visibility, or attachment retention.

## Model Experience

### Consumer-owned desktop results

#### What the model sees

The package contributes no model text directly. [`@deepseek-ai/dsh-tool-computer-use`](../tool-computer-use/README.md) renders `ctx.computerUse` results and preserves `ComputerUseError` failures through the ordinary tool-result path.

#### Token effect

The Service Definition adds no request or result tokens; the model-facing Consumer owns those costs.

#### KV Cache effect

Provider registration, selection, capabilities, and observation state do not change the model request prefix; Consumer configuration owns prompt and schema changes.

## Known Limitations and Deferred Work

- The service has no display identity, Execution Host binding, remote-host generation, or durable desktop-resource record; the current Provider uses its own runtime generation and short-lived observations.
- Capability descriptors are advisory provider facts. The current model Consumer keeps six fixed schemas and unsupported actions fail through the selected Provider rather than disappearing from the tool catalog.
- The service does not cover persistent Browser pages, Mobile Device control, Android or iOS simulators, Speech/Audio, downloads, network inspection, or credential entry workflows.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
