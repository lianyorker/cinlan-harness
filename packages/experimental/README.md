---
description: "The experimental group map: public browser, computer-use, and Auto review imports alongside private prototypes, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/experimental

English | [中文](README.zh.md)

## Summary

Use this group to try experimental browser control, computer use, Auto review, Agent Teams, inspection, and alternate runtimes. The seven official imports in the [public release allowlist](../../scripts/experimental-package-policy.ts) publish with the shared dsh version; publication does not activate them by default or promise stable APIs. All other packages in this group remain private and excluded from official releases. Released packages may depend on the listed public imports, but must not require private packages.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-team-profile`](agent-team-profile/README.md) | Explicit source-checkout profile layer for Agent Teams | — |
| [`agent-team`](agent-team/README.md) | Named teammates with durable messages and a shared task board | `ctx.agentTeams` |
| [`agent-team-web-profile`](agent-team-web-profile/README.md) | Explicit source-checkout Web layer for Agent Teams | — |
| [`auto-review`](auto-review/README.md) | Per-call model authorization review for the Auto permission preset | — |
| [`browser-use-runtime`](browser-use-runtime/README.md) | Shared Session browser resources and MCP activation | library — no ctx key |
| [`browser-use-playwright-mcp`](browser-use-playwright-mcp/README.md) | Chromium tools through Playwright MCP | — |
| [`browser-use-chrome-devtools-mcp`](browser-use-chrome-devtools-mcp/README.md) | Chromium tools through Chrome DevTools MCP | — |
| [`browser-use-stagehand-native`](browser-use-stagehand-native/README.md) | Stagehand browser operations with explicitly configured models | — |
| [`client-ui-agent-team`](client-ui-agent-team/README.md) | Team roster, task board, and teammate navigation for Web | — |
| [`code-runtime-python`](code-runtime-python/README.md) | CPython subprocess backend for the code-execution seam | `ctx.codeRuntime` |
| [`computer-use-cua-driver-mcp`](computer-use-cua-driver-mcp/README.md) | Desktop tools through an installed Cua Driver MCP executable | — |
| [`computer-use-cua-driver-native`](computer-use-cua-driver-native/README.md) | Desktop tools through the Cua Driver native npm SDK | — |
| [`inspector`](inspector/README.md) | Cross-realm CDP hub for Host debugging, Client Runtime inspection, network capture, and Cordis trees | `ctx.inspector` |
| [`tool-agent-team`](tool-agent-team/README.md) | Nine tools that let the model create, message, and coordinate teammates | registers scoped tools on `ctx.tools` |
| [`webworker-packer`](webworker-packer/README.md) | Builds the gzip-compressed VFS image consumed by the browser worker preview | library and CLI — no ctx key |
| [`webworker-runtime`](webworker-runtime/README.md) | Runs the harness plugin tree inside a dedicated browser worker | library and worker entry — no ctx key |

-----

<a id="related-documentation"></a>
## Related documentation

- [Experimental package decision](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — private prototype placement and dependency isolation; the seven public imports follow the allowlist above.
- [Agent Teams subsystem](../../docs/subsystems/agent-team.md) — durable Team types and the `ctx.agentTeams` service API.
- [Experimental subtree rules](AGENTS.md) — what experimental status does and does not relax.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
