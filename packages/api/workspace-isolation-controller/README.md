---
description: "Host Remote owner for local Workspace Isolation lease management."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-isolation-controller

English | [中文](README.zh.md)

## Summary

This package always registers the Host `workspaceIsolation` Remote namespace while treating `ctx.workspaceIsolation` as an optional provider. Local Web clients can list, inspect, compare, integrate, export, activate, hibernate, safely tear down, or prune leases through opaque ids; no command accepts a filesystem path, target branch, or force flag.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount this controller with the Typert Gateway. Mount a Workspace Isolation provider when lifecycle commands should succeed; without one, every method returns `workspace-isolation/unavailable` instead of removing the namespace.

The generated `./remote` contribution is selected by `@deepseek-ai/dsh-api-remotes`. Responses are detached field-by-field DTOs. Inspection, comparison, integration, export, and activation forward caller cancellation to provider work; operations without a provider cancellation parameter check the signal before admission. Safe teardown projects either removal or a retained `review` lease.

## Model Experience

None, as this Host controller registers no prompt, tool, Session event, or model-request input.

#### KV Cache effect

None; Remote lease administration does not alter model requests.

## Known Limitations and Deferred Work

- The namespace manages existing provider leases; creating a lease remains owned by Session and task execution paths.
- Orphan discovery remains bounded by the mounted provider's scan policy.

<a id="dev-note"></a>
### Dev Note

Typert generates `lib/typert.host.*` and `lib/typert.remote-client.*`; edit `src/index.ts` and `src/types.ts`, not generated artifacts.

No runtime invariant companion is published because this controller keeps no mutable projection; every response reads the provider's authoritative lease state.
