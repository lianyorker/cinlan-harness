---
description: "Save OpenSSH aliases and inspect exported remote directories with process provenance."
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-host-targets

English | [中文](README.zh.md)

## Summary

This plugin owns saved SSH targets and their live connections. It authenticates through the Host's OpenSSH configuration, starts the target's fixed execution-host profile, and verifies a real exported-root inspection before publishing readiness. Saved target identity remains separate from process provenance. Directory inspection carries the current connection generation and remote worker identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Connection ownership](#connection-ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this service beside `storageDomain`, the local subprocess provider, and `executionHost`. The [Remote controller](../../api/execution-host-controller/README.md) consumes it for native settings. Each saved record contains a display label and one concrete OpenSSH inspection alias. Optional `execution` settings select an explicit endpoint and installed deployment for the [official SSH provider](../../ssh/ssh/README.md); they store a private key file path, never key contents. The inspection alias continues to use OpenSSH configuration and its local agent.

The remote machine needs the [worker profile](../../bundle/execution-host-app/README.md) and explicitly configured exported roots. Empty roots produce `roots-unconfigured`. Connections use batch authentication, strict known-host verification, no agent forwarding, no forwarding listeners or shared control socket, and the fixed command `dsh --profile execution-host`. Verify trust and authentication in the Host's OpenSSH configuration before connecting.

| Configuration | Default | Meaning |
|---|---|---|
| `sshExecutable` | `ssh` | Host-owned OpenSSH executable or absolute path. |
| `sshConfigFile` | unset | Optional Host-owned configuration file; otherwise OpenSSH uses its normal configuration. |
| `connectTimeoutMs` | `15000` | Executable lookup and worker negotiation deadline. |
| `operationTimeoutMs` | `30000` | Inspection deadline before acknowledged cancellation starts. |
| `shutdownTimeoutMs` | `5000` | Acknowledgement deadline and local termination grace period. |
| `maxFrameBytes` | `262144` | Maximum UTF-8 protocol frame size. |
| `maxDiagnosticBytes` | `8192` | Retained local SSH diagnostic tail. |
| `maxTargets` | `100` | Maximum durable saved targets. |
| `maxConcurrentInspections` | `16` | Simultaneous inspections per connection. |

Timeouts must fit Node's timer range; the inspection timeout plus two shutdown deadlines must also fit. Saved labels and aliases are validated before persistence. Updating or removing a target requires its exact saved revision and settles its connection first. Reopening the registry restores saved records as disconnected.

Execution settings require `endpoint` (`host`, `port`, `username`, `privateKeyFile`, `hostKeySHA256`), `node`, `helper`, `helperHash`, and `workspace`. Remote paths are absolute POSIX paths; `privateKeyFile` is an absolute Host path. Hashes use lowercase SHA-256 hex. `bootstrapPath` and `bootstrapHash` must be supplied together, and both are required for `snapshotExecution`. Alias-only records remain valid for inspection. An update replaces all editable settings; omitting `execution` removes it.

`snapshotExecution` synchronously captures a deeply frozen configuration and deployment identity without the private key path. `resolveExecution` validates the durable snapshot and synchronously returns an independent official SSH configuration with that path. `reserveExecution` validates the same snapshot and returns a caller-owned synchronous authorization for Agent publication. While held, ordinary updates and removal return `conflict`; reservation also returns `conflict` when either mutation has already started. Release is idempotent. Deleted targets, unretained revisions, and altered public fields produce `conflict`; malformed snapshots produce `invalid-request`, and incomplete execution settings produce `incompatible`. Configuration edits cannot retarget a configuration already returned to a caller. Snapshots identify saved deployments, not worker process `hostId` values.

`activateExecution(request, execution)` selects a complete verified runtime deployment at the exact current target revision. It advances the revision and atomically retains predecessor execution configurations for cold Session resume, including their original credential-file references. It does not disconnect active operations. Only this activation operation permits historical resolution; ordinary edits, credential or trust rotations through `update`, and removal invalidate all retained selections. `snapshotExecution` admits only the current revision, and management responses omit retained history. A failed revision comparison changes neither selection nor history.

<a id="connection-ownership"></a>
## Connection ownership

Ready observations contain the negotiated worker identity, exported roots and a connection generation. Reconnect creates a fresh generation. Requests naming an older generation, a different worker incarnation, or an unexported root are refused. Remote relative paths stay in the worker's filesystem; `executionHost.current()` continues to describe the managing Host process.

Cancellation sends an explicit worker request and waits for both settlement acknowledgement and the original result. An unavailable acknowledgement produces `outcome-unconfirmed`. Disconnect withdraws readiness before draining admitted work; its return confirms completion of local cleanup. Protocol loss withdraws readiness and starts cleanup immediately. Target plugin disposal joins its work; whole-Host shutdown can close the subprocess provider before a remote acknowledgement arrives and reports that outcome as unconfirmed.

The durable domain is `execution_host_targets`; connection observations remain transient. The `execution-host-targets/changed` notification runs after saved or transient state commits. Observer throws and returned-promise rejections are logged independently; they cannot change the operation result or prevent later observers from running. No invariant companion is published: persisted records are validated at admission, and one connection lifecycle owns each transient observation without an independent projection.

<a id="model-experience"></a>
## Model Experience

None, as this plugin registers no Agent tools, prompts, or Session events.

#### KV Cache effect

None; saved target metadata and directory inspections do not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This package owns directory metadata inspection and saved execution configuration; callers own execution connections and Session routing. It supplies no task isolation, arbitrary execution, file editing, or automatic worker installation. The [worker's filesystem limitations](../execution-host-worker/README.md#known-limitations-and-deferred-work) also apply. SSH authentication and host trust must be configured outside the browser. Runtime activation retains deployment references without deleting remote generations; generation collection requires a separate owner.

<a id="dev-note"></a>
### Dev Note

[Real SSH tests](tests/targets.spec.ts) use independent keys, known-host files, ports, storage and Loader worker compositions. They exercise authentication refusal, separate target roots, cancellation settlement, reconnect generations, protocol loss and unload admission. The temporary Windows key ACL grants only its owner access; POSIX fixtures use mode 0600.

The [browser acceptance](tests/ssh-settings.e2e.ts) drives the shipped Settings page through authenticated Remote into an isolated SSH server that starts an actual `dsh --profile execution-host` child process. Run `node packages/execution-host/execution-host-targets/tests/run-ssh-acceptance.mjs` from the repository root after building the Web client. It owns temporary credentials, trust files, storage, ports, and exported files, and writes sanitized evidence under `.artifacts/native-migration`. This verifies the local encrypted SSH management path; it does not establish an external-machine deployment, POSIX remote execution, or Session authority routing.
