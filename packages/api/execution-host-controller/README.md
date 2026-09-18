---
description: "Expose authenticated SSH target management and directory inspection through the executionHosts Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-execution-host-controller

English | [中文](README.zh.md)

## Summary

This controller exposes saved SSH targets and bounded directory inspection to native settings through the authenticated `executionHosts` Remote namespace. It uses the same Connection carrier for HTTP, WebSocket streams and desktop shared Fetch. The target service owns persistence, SSH authentication, connection generations and remote operation settlement.

## Table of Contents

- [Use this package](#use-this-package)
- [Observe target changes](#observe-target-changes)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this controller beside Typert and the [saved-target service](../../execution-host/execution-host-targets/README.md), with Connection authentication configured by the owning app. The generated `executionHosts` client supplies target listing, revisioned saved-record mutations, explicit connection control and root-relative inspection. Use `executionHosts.removeTarget` to remove a saved record at its current revision. [Native host settings](../../client/ui-settings-hosts/README.md) consumes the API through injected callbacks. The controller accepts no credentials, arbitrary commands, endpoint URLs, local workspace IDs or remote profile patches.

Unary calls return generated `RemoteResult` values. Expected target failures use typed `execution-host/` error codes with sanitized messages. Persistent mutations check cancellation before admission and finish their admitted commit; connect and inspection propagate cancellation to the target service. That service determines whether remote settlement is confirmed.

<a id="observe-target-changes"></a>
## Observe target changes

`follow` returns a raw asynchronous sequence of complete management snapshots. It subscribes before producing the initial snapshot, coalesces changes while its consumer is paused, and releases its listener when cancelled or when the controller is disposed. Snapshots keep the managing process's provenance separate from saved target identities and remote worker incarnations. Transport loss remains visible to the client rather than leaving a usable stale ready observation.

The `./types` entry contains only DTO exports and can be imported by Client programs. No invariant companion is published: the controller adapts the authoritative target service and maintains no independent data projection.

<a id="model-experience"></a>
## Model Experience

None, as this controller contributes no Agent tools, prompts, or Session events.

#### KV Cache effect

None; Remote management traffic does not change model requests or reusable prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The API exposes saved SSH target management and directory metadata inspection only. Remote Workspace and Session authority, default execution routing, switch confirmation and task isolation are unavailable. Deployment requirements and unconfirmed cancellation outcomes belong to the [target service](../../execution-host/execution-host-targets/README.md#connection-ownership).

<a id="dev-note"></a>
### Dev Note

[Composition tests](tests/composition.spec.ts) boot real Loader rows with private durable storage, authentication and HTTP/shared-Fetch carriers. [Follow tests](tests/follow.spec.ts) exercise actual WebSocket streams and Gateway pull iteration, including baseline ordering, coalescing, cancellation, route disposal and reload.
