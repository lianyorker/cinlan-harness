---
description: "Current-profile MCP configuration, credential references, and owned connection lifetimes."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-management

English | [中文](README.zh.md)

## Summary

MCP management persists server definitions for the current profile and runs them through the existing [MCP client bridge](../mcp-client/README.md). Saved enablement and observed readiness are independent: a missing credential or unavailable endpoint keeps its enabled record and reports the actual activation failure.

## Table of Contents

- [Configure management](#configure-management)
- [Manage servers](#manage-servers)
- [Lifetime and persistence](#lifetime-and-persistence)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configure-management"></a>
## Configure management

Mount the bridge's registry, the storage-domain stack, credentials, tools, and this service. The required `profile` config is the application's actual profile identity. Definitions live in the `mcp_management` storage domain, version 1, under its `profiles` table. They do not rewrite composition YAML or the home-wide settings document.

A stdio definition contains an executable, literal arguments, working directory, and environment-variable-to-credential-reference mapping. A Streamable HTTP definition contains an endpoint and header references, each with a non-secret prefix such as `Bearer `. URLs exclude userinfo, query strings, and fragments. Authentication values belong in the [credential provider](../../credentials/credentials/README.md), never in arguments or literal header fields. Missing timing options use the bridge's existing timeout and reconnect defaults; invalid overrides fail before persistence.

<a id="manage-servers"></a>
## Manage servers

The [public request and snapshot types](src/types.ts) keep a durable record id separate from its tool namespace. Save, remove, and enablement changes compare the current profile revision with the caller's expected revision. A stale editor receives a conflict. Connection errors do not increment that revision.

Save commits the desired definition before applying it. Reconnect replaces only an enabled manager-owned child and resolves credential references again. Automatic reconnect also resolves them for every attempt. Disable stops that child. Remove stops it before committing deletion. An unconfirmed shutdown reports a fixed failure and retains the record; replacement is refused while that lifetime cannot be proven closed.

Refresh tools uses the initialized connection's serialized `tools/list` path. It does not start a stopped server or invoke `tools/call`. A connected error state can recover through successful discovery; a disconnected server requires enablement or reconnect. Externally composed root connections appear with their actual Loader entry or plugin owner and remain read-only. Agent-scoped connections are excluded using the scope identity carried by their context.

<a id="lifetime-and-persistence"></a>
## Lifetime and persistence

One service-owned operation queue serializes revision checks and durable writes. The authoritative domain record is published only after persistence succeeds. Observed connection phases and tool descriptors come from the bridge supervisor, without a second transport client or independently reconstructed readiness state. Registry observation does not grant mutation authority over external Loader entries.

Manager unload stops its children and drains writes before closing the domain. Its `./invariant` companion compares settled desired records with independently registered root connections before tool execution; the bridge owns the separate discovery-to-tool-registration invariant. The manager's public snapshots and errors exclude resolved credentials and upstream exception text.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the MCP client bridge, which contributes the managed servers' discovered Tools.

#### KV Cache effect

Changing a connection's discovered tool schemas can change the model's tool prefix. The manager does not create provider requests or independently alter Session logs; the ordinary tool runtime records calls and results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Management covers the current profile's root connections only. External compositions and Agent-scoped servers keep their own lifecycle authority. Authentication uses static environment or header references; OAuth is unsupported. Arguments and endpoint paths are public configuration and must not contain secrets. A transport whose shutdown cannot be confirmed requires Host recovery before its quarantined namespace can be reused.
