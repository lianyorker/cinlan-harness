---
description: "Execution-host identity providers for truthful artifact provenance."
kind: "package-group"
---

# execution-host/ — execution-host identity capability

English | [中文](README.zh.md)

## Summary

Publish a stable identity for each execution host and manage saved SSH targets for explicit bounded inspection. Local provenance remains separate from remote Session routing, which this group does not provide.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`execution-host/`](execution-host/README.md) | Execution-host identity contract used by provenance and authorization |
| [`execution-host-local/`](execution-host-local/README.md) | Local-process provider for immutable host identity facts |
| [`execution-host-targets/`](execution-host-targets/README.md) | Saved target records, strict OpenSSH connections, and live inspection ownership |
| [`execution-binding/`](execution-binding/README.md) | Durable Workspace/Session execution selection and leased official SSH provider composition |
| [`execution-host-worker/`](execution-host-worker/README.md) | Stdio worker with explicit exported roots and versioned inspection messages |

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [Execution Host subsystem reference](../../docs/subsystems/execution-host.md) lists the generated Cordis API and events; identity, target, and worker protocol contracts remain with the package READMEs.

</details>
