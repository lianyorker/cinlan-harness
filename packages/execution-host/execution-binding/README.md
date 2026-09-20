---
description: "Bind Workspaces and Sessions to one leased local or official SSH execution world."
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-binding

English | [中文](README.zh.md)

## Summary

This service retains the filesystem, subprocess, sandbox, shell, Git, PTY and PTC providers selected for a Session. The controlling Host continues to own the Agent loop, model transport, permissions and durable Session. A remote connection never becomes a second Session writer and never falls back to local execution.

## Table of Contents

- [Use this package](#use-this-package)
- [Lease and admission ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#limitations)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the service beside the Session query engine and projection registry. A local-only composition does not need the saved target registry; mount that registry whenever the composition admits SSH selections, and absence then fails admission. Capture an execution snapshot from a configured target, then create a [Workspace](../../workspace/workspace/README.md) with that snapshot. Existing Workspaces and Sessions without an execution selection are local. Remote paths are canonicalized by the remote filesystem, independently of the controller operating system.

An SSH target requires an explicit endpoint with a pinned host key, a Host-owned private-key file reference, and absolute remote Node, helper, workspace and PTC bootstrap paths. Both helper and bootstrap digests are required. The [SSH provider](../../ssh/ssh/README.md) verifies the installed deployment; this package does not upload credentials or copy the local workspace.

| Configuration | Default | Purpose |
|---|---|---|
| sandboxMode | read-only | Default remote file-effect policy, beneath Session policy overrides |
| connectionTimeoutMs | 30000 | SSH administrative request deadline |
| shellTimeoutMs / shellMaxTimeoutMs | 120000 / 600000 | Default and maximum one-shot shell duration |
| maxOutputBytes / maxSpillBytes | 1048576 / 67108864 | Shell output and retained spill bounds; Git uses the output bound |
| graceMs | 3000 | Process termination grace |
| gitExecutable / gitMaxLogEntries | git / 1000 | Remote Git lookup and history bound |
| shellPath | /bin/bash | Remote interactive shell executable |

<a id="ownership"></a>
## Lease and admission ownership

Consumers acquire a lease for a captured binding and directory, or resolve one by Session identity. The lease supplies one provider context, canonical directory, remote platform, incarnation and lifetime signal. Retained processes keep their lease until their actual cleanup settles. Releasing a lease is idempotent; the final holder joins provider disposal. Consumers use strict context lookup through `ctx.get(name)`, reject missing services, and use these captured providers for every file, command and terminal operation.

Agent setup mounts the selected execution providers before its consumers and holds a saved-target authorization reservation through the synchronous publication commit. Ordinary target edits and removal racing that interval return `conflict`; callers can retry after commit or rollback releases the reservation. Session-id lookup rejects pending admission, including already-readable durable logs, until the exact Agent enters the public registry. A cold lookup validates the admission generation and identities after every await; it restarts or retains the published Agent lease when admission changes, never treating a stale empty observation as local. The immutable execution event records deployment identity without the credential path. Resume and fork preserve that event; editing a saved target cannot move a running Agent. Existing live Session leases retain their admitted world. Managed runtime activation preserves explicitly retained predecessor deployments for resume; ordinary target edits invalidate historical selections. A disconnected world rejects work until its old lifetime is released; it is never repaired by switching providers.

Remote filesystem policy, shell defaults, PTC, Git, terminal registry and preset consumers mount in a scope owned by the Agent. A cold Session operation captures its recorded policy in a private scope owned by that lease. Local presets retain their shared standing composition. The [Agent preset owner](../../preset/agent-presets/README.md) controls platform-sensitive rows, child inheritance and preset changes. The publication invariant compares the durable selection with the exact Agent's admitted provider world.

<a id="model-experience"></a>
## Model Experience

This package registers no model tool. Tool availability and execution instructions come from the selected preset and its providers. The execution selection is a durable Session event and client projection; it does not add a system-prompt prefix. Files, commands and PTC programs consume the selected execution directory and policy.

#### KV Cache effect

No stable prompt text is added. Existing provider instructions and logged runtime context determine any prompt changes; replay retains the Session's execution selection.

<a id="limitations"></a>
## Known Limitations and Deferred Work

Remote execution requires a preinstalled compatible Linux or macOS deployment. Windows controllers use the explicit SSH2 endpoint; Windows remote endpoints are unsupported. Runtime installation and upgrades are separate deployment operations. A connection loss can leave remote cleanup unconfirmed until the helper lease expires; process receipts do not survive reconnection.

Remote Workspace isolation and worktree-task creation are refused until their consumers use the same execution world. Preset consumers that construct project paths with controller-specific Node path APIs require explicit remote support; the shipped remote composition excludes project instruction and filesystem skill discovery while that support is absent. Custom presets remain trusted deployment code and must consume the paired execution providers. A real SSH deployment, rendered terminal and cross-machine PTC acceptance require an explicitly configured endpoint; controlled transport fixtures do not establish that evidence.

<a id="dev-note"></a>
## Dev Note

The [execution-host subsystem](../../../docs/subsystems/execution-host.md) owns API references. The [binding decision](../../../.agents/notes/implemented/architecture/2026-09-20-immutable-session-execution-binding.md) records ownership and migration rationale. Loader tests retain real target storage, Agent admission and official execution providers while controlling the external SSH peer; they distinguish local and remote roots and exercise lease loss, stale publication and durable selection.
