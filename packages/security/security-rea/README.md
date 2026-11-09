---
description: "Built-in REA reverse-engineering capability with runtime gating and a bundled skill."
kind: "package-reference"
---
# @cinlan/security-rea

English | [中文](README.zh.md)

## Summary
This package mounts the pinned `rea-agents` MCP server as the `securityRea` service. It launches REA only through the configured `nodeExecutable`, validates that executable against the installed `rea-agents` `engines.node` range before launch, and degrades to a non-blocking `disabled` or `unavailable` status instead of throwing. When the launch decision passes it also registers the bundled `reverse-engineer-anything` runtime skill with Chinese conversational trigger phrases.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount it inside a composition that already provides the `tools` and `skills` services. Configure `nodeExecutable` with the deployment's Node runtime — the security-research bundle derives it from the primary-runtime directory handed to the Host. Plain-language reverse-analysis requests route through the bundled skill and the `mcp__rea__*` tool catalog; `status()` and `doctor()` report readiness for diagnostics.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `mcp__rea__*` tools and the bundled reverse-engineering skill description, which carries Chinese trigger phrases such as 逆向分析, 反编译, and 帮我看看这个 exe 是干嘛的.

#### KV Cache effect

REA's full catalog is large: `rea-agents@6.8.0` lists 229 tools whose model-visible portion (name + description + compact input schemas) is about 271 KB — roughly **75k prompt tokens per request**. The service therefore filters the catalog before registration: the default allowlist (`REA_DEFAULT_TOOL_NAMES`) keeps **62 static-analysis tools** — session lifecycle, native inventory, function-level analysis, call-graph/reference tracing, artifact and format inspectors, evidence access, and analyst annotation — cutting the model-visible surface to about **69.5 KB ≈ 19k tokens (-74%)**. Dynamic lanes (adb, Frida, debuggers, live browser/Electron) stay out of the model catalog; `Config.additionalTools` admits extra raw tool names and `Config.toolAllowlist` replaces the default set outright.

REA server instructions (about 2.9 KB, ≈800 tokens) still join the system prompt. The much larger `outputSchema` payloads (≈3.2 MB over `tools/list`) never reach the model — and the service launches REA with `REA_MCP_OUTPUT_SCHEMA_PROFILE=off` by default (`Config.outputSchemaProfile`), so those bytes no longer cost child-process I/O or host memory either. These were measured against `rea-agents@6.8.0` on 2026-11-01; see `docs/dev/REA原生集成/plan.md` §8 for the full table, profile notes, and the deferLoading investigation.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- A missing or incompatible runtime leaves the service `unavailable` with plain-language guidance ("逆向分析需要更新运行时"); product startup is never blocked.
- Readiness is a spawn-and-engines check; host toolchain availability is reported separately by `doctor()`.
- When the `skills` service is absent the service still mounts tools but skips skill registration.

<a id="dev-note"></a>
### Dev Note

`nodeExecutable` is always the configured executable — `process.execPath` is never used as a fallback, because the Electron host Node may not satisfy `rea-agents` engines. State and scratch files stay under CLH paths; `.dsh` locations and forwarded `DSH_*` variables are rejected.
