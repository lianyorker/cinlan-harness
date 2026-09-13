---
description: "Host Remote owner for Work Items and Workspace-scoped associations."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-work-items-controller

English | [中文](README.zh.md)

## Summary

This package owns the Host `workItems` Remote namespace. It exposes write preview/confirm/cancel/history through the service-owned ledger, reads normalized provider items and persists explicit item-to-Workspace or item-to-Session associations without storing credentials, provider response bodies, or checkout paths.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the package after `dsh-work-items`, `dsh-workspace`, and `dsh-storage-domain`. The generated `./remote` contribution is consumed by the official `dsh-api-remotes` assembly.

<a id="understand-the-implementation"></a>
## Understand the implementation

The [Settings UI](../../client/ui-work-items/README.md) consumes the generated Remote methods.

The controller validates Workspace ownership before accepting an association, serializes local writes, and projects only registered Workspaces and unarchived owned Sessions. Provider failures are converted to classified `RemoteError` values without exposing response bodies or credential values.

<a id="model-experience"></a>
## Model Experience

None, as this Host Remote controller registers no prompt, tool, or model request mutation.

#### KV Cache effect

None; the controller does not alter model request prefixes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- External writes require an enabled Provider; the controller exposes no automatic retry or arbitrary HTTP operation.
- The controller does not discover provider scopes or expose arbitrary provider URLs.

<a id="dev-note"></a>
### Dev Note

The generated Host and Remote artifacts are produced by the repository Typert build; edit `src/types.ts` and `src/index.ts`, not `lib/typert.*`.

No runtime invariant companion is published because storageDomain commits association writes atomically and branch projections read authoritative leases; the controller keeps no independent business projection to compare.

prepareWrite/confirmWrite/cancelWrite/listWrites delegate to the service-owned durable approval API. Confirmation carries an operationId, never replacement fields. Local associate/disassociate remains separate from external issue mutation.
