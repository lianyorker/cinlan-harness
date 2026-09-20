---
description: "The MCP package group: attach external Model Context Protocol servers so their tools are callable as native tools."
kind: "package-group"
---

# MCP — Model Context Protocol

English | [中文](README.zh.md)

## Summary

The `mcp/` group connects the harness to the Model Context Protocol (MCP) ecosystem of tool servers. Its client attaches external servers so their tools are available under stable server-qualified names, and its resource service lets the model discover and read server content on demand. Each server is one configuration entry; nothing ships enabled, so you opt in per server. MCP prompt templates are not supported. This page maps the group; the package README owns the per-package contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

This group contains the MCP transport bridge and current-profile management; their READMEs own package-specific behavior.

| Package | What it provides |
|---|---|
| [`mcp-client/`](mcp-client/README.md) | Attach one external MCP server so the model can call its tools as native tools |
| [`mcp-resources/`](mcp-resources/README.md) | Discover resource pages and URI templates, then read content through shared tools |
| [`mcp-management/`](mcp-management/README.md) | Persists current-profile server definitions and owns their connection lifetimes |

-----

<a id="related-documentation"></a>
## Related documentation

Try the worked example configurations to see the plugin in action, then read the Agent Note for the behavior decisions behind it.

- [MCP client plugin Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.md) — the bridge's design: server-qualified naming, discovery, execution, and environment scrubbing.
- [Third-party memory MCP guide](../../docs/user/guide/mcp-memory.md) — runnable overlay rows and setup instructions.
- [MCP subsystem reference](../../docs/subsystems/mcp.md) — connection snapshots, revisioned management requests, and the Cordis API.
- [Tools subsystem reference](../../docs/subsystems/tools.md) — the `ToolRuntime` that receives the registered tools.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
