---
description: "Revisioned MCP management Remote and cancellable live snapshots."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-controller

English | [中文](README.zh.md)

## Summary

The `mcp` Remote namespace exposes the [current-profile MCP manager](../../mcp/mcp-management/README.md) to Settings. It returns desired definitions with credential references, observed lifecycle state, and discovered Tools. It never rewrites external compositions, returns credential values, or invokes MCP tools.

## Table of Contents

- [Use the Remote](#use-the-remote)
- [Publication and lifetime](#publication-and-lifetime)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-the-remote"></a>
## Use the Remote

Read a complete snapshot, or open `watch` for an immediate snapshot followed by complete replacements. The stream coalesces updates while its consumer is paused and closes on caller cancellation or controller disposal. Read the profile revision before saving, removing, or changing desired enablement; a conflict requires a fresh read and a new explicit edit.

Save, removeServer, setEnabled, reconnect, and probe delegate to the manager's corresponding operations. Probe means Refresh tools on an initialized owned connection. It starts no disabled server and executes no tool. A successful save confirms durable desired configuration, not readiness; the snapshot's observed phase reports activation success or failure independently.

The [request and response types](src/types.ts) re-export the manager's definitions. Expected operation failures use fixed `mcp/*` codes. Unclassified failures use a fixed internal diagnostic; upstream exception text and credentials are not copied to Remote errors. External rows expose their real owner and have no mutation operation in this API.

<a id="publication-and-lifetime"></a>
## Publication and lifetime

The Host service depends on `typert` and `mcpManagement`. Its generated `./typert` and `./remote` entries publish Host descriptors and the Client namespace. The controller keeps only stream lifetimes and queued replacement snapshots; the manager owns durable state, connection ownership, and validation. No invariant companion is published because this controller has no independent durable projection.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the MCP manager, which owns the connection changes requested by this Remote.

#### KV Cache effect

The controller assembles no model request. Tool-set changes have the bridge's ordinary tool-schema prefix effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This API covers the active profile's managed root servers and read-only external root observations. It exposes no cross-profile selector, OAuth flow, MCP Resources, or MCP Prompts. Complete snapshots favor current state over a historical transition log.
