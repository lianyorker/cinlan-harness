---
description: "Work Items capability family for normalized provider-backed issues."
kind: "package-group"
---

# Work Items

English | [中文](README.zh.md)

## Summary

The Work Items group provides normalized provider reads, durable approved external writes, Host Remote projection, and Workspace-scoped local associations.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

External Work Items capability: normalized GitHub Issues and Linear issues, fixed credentialed Providers, a durable preview/confirm write protocol, Host API projection, model-facing tools, and an optional Web Consumer. The subsystem reference is [docs/subsystems/work-items.md](../../docs/subsystems/work-items.md).

## Packages

| Package | Role | ctx key |
|---|---|---|
| `@deepseek-ai/dsh-work-items` | Service Definition — provider registry and list/get contract | `ctx.workItems` |
| `@deepseek-ai/dsh-work-items-github` | Service Provider — fixed GitHub REST origin and Issue mapping | — |
| `@deepseek-ai/dsh-work-items-linear` | Service Provider — fixed Linear GraphQL endpoint, issue mapping, and opt-in writer | — |
| `@deepseek-ai/dsh-tool-work-items` | Consumer — model-facing normalized reads and durable write approvals | `ctx.tools` |

## Architecture

The service and providers own provider selection, bounded parsing, Host-only credentials, and durable external-write semantics; the browser consumes the normalized Remote projection, while the tool Consumer projects a separate model-facing contract.

Provider results are not session events, prompts, or attachments. The model-facing Consumer exposes only rebuilt normalized fields, structured scopes, and the service-owned prepare/confirm/cancel protocol; it does not expose transport or credential metadata.

## Model Experience

The service and Provider packages contribute no prompt or model tool. `@deepseek-ai/dsh-tool-work-items` contributes six tools for normalized reads, durable write previews, exact confirmation, cancellation, and receipt history; the Web Settings Consumer remains for human inspection and local associations.

## Known Limitations and Deferred Work

- Provider writes remain disabled unless deployment configuration enables `allowWrites`; every model-facing write still requires a durable preview and exact confirmation.
- Repository/team discovery, synchronization, webhooks, comment history, attachments, GitHub Enterprise origins, and arbitrary saved views are not supported.
- Workspace context is display metadata and does not create a persisted remote link or mutate a local lease.


<a id="dev-note"></a>
### Dev Note

Provider response data and credentials remain Host-owned; generated catalogs are the source of API inventory.
