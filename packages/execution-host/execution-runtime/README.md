---
description: "Configure pinned SSH runtime installation, immutable release generations, and Host-owned task observation."
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-runtime

English | [中文](README.zh.md)

## Summary

Install or update a remote Harness runtime through an explicit SSH endpoint with a pinned host key. Follow the installation by task ID, and recover retained observations after a Client reload connected to the same Host. Activation selects a verified generation for subsequent execution bindings while existing Sessions retain their captured deployment. Installation requires a complete release payload and an existing remote Node executable.

## Table of Contents

- [Use this package](#use-this-package)
- [Task ownership](#task-ownership)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service beside [execution-host-targets](../execution-host-targets/README.md) in a supported Harness profile. Deployment configuration selects the release; management requests supply the explicit endpoint and remote paths.

The endpoint specifies host, port, username, an absolute Host private-key-file reference, and a lowercase hexadecimal SHA-256 host-key pin. Installation uses no personal SSH configuration, ambient alias, or agent forwarding. Supply an absolute remote Node executable meeting `^22.19.0 || >=24.0.0`, an existing canonical private installation root owned by the SSH account, and a separate existing workspace; neither directory may contain the other. Remote payloads target Linux/macOS x64 or arm64; Windows can control installation but is not a remote payload target.

The default selection reads the package's release index for the detected remote platform and architecture. A deployment-owned artifact override requires both its absolute directory and its manifest digest. Browser requests cannot select arbitrary Host artifact files. An absent release index or target entry produces the stable `release-unavailable` category; invalid payloads fail verification before activation.

The [configuration schema](src/config.ts) owns accepted fields and defaults:

| Field | Default | Meaning |
|---|---|---|
| `artifactDirectory` / `manifestSHA256` | Unset | Paired deployment-owned override and exact manifest pin. |
| `operationTimeoutMs` / `shutdownTimeoutMs` | 300000 / 10000 | Total operation deadline and cancellation cleanup grace in milliseconds. |
| `maxManifestBytes` / `maxFileBytes` | 16777216 / 536870912 | Manifest and individual payload-file byte limits. |
| `maxTotalBytes` / `maxFiles` | 4294967296 / 100000 | Complete payload byte and file-count limits. |
| `maxResponseBytes` / `maxRetainedTasks` | 65536 / 256 | Installer control-output bytes and retained Host task receipts. |

All numeric limits are positive safe integers; deadlines also fit Node timers. The [service API](src/index.ts) and [request types](src/types.ts) own detection, installation, observation, and explicit cancellation.

-----

<a id="task-ownership"></a>
## Task ownership

`start` captures install/update intent, the exact saved target ID/revision, and deployment coordinates, then immediately returns a Host-issued `RuntimeTaskId`. Only one running installation is admitted per target. Task receipts omit credentials and deployment execution configuration.

`get` and `follow` observe that explicit ID. Closing or aborting a follow stream detaches the observer without cancelling the task. After a Client reload, `listTasks` recovers the bounded inventory retained by the same running Host. When capacity is reached, the oldest settled receipt is evicted; running tasks are not evicted.

`cancel` names one task and waits for its outcome. A committed target activation remains successful when cancellation arrives afterward. Host disposal cancels and joins owned operations. Receipts are in memory: Host process restart neither preserves tasks nor resumes unfinished installations. Read-only `detect` has its own cancellable observation lifetime.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [release producer](scripts/materialize-runtime.ts) materializes already installed production, peer, and available optional dependencies into a complete release tree. It selects package-declared files, pins dependency versions, and seals a manifest for each target. The producer refuses tracked or untracked worktree changes before recording the source revision. Production builds and matching target system/PTY binaries are prerequisites; the producer neither installs dependencies nor downloads executables. The [native payload selector](scripts/native-payload.ts) uses the canonical system-prebuild verifier and checks the selected PTY binary headers. Executable permissions belong to target metadata, not the controller filesystem's mode bits, including on Windows. Binary headers alone do not establish target ABI compatibility.

The [artifact verifier](src/artifact.ts) checks the pinned manifest, complete regular-file inventory, hashes, and size limits. SSH authentication, connection, channel, and SFTP failures use the stable `connection-failed` category without exposing raw transport diagnostics; artifact and authenticated supervisor failures use `verification-failed`. The [SSH transport](src/transport.ts) rechecks transferred bytes and uploads through SFTP into an operation-owned staging directory. The [remote supervisor](assets/remote-operation.mjs) verifies target identity and dependency resolution, evaluates deployed PTC code, checks helper identity, and verifies read access plus denied writes under helper-prepared confinement. It runs a native PTY probe in a child Node process when node-pty is present; production release generation requires that dependency. The supervisor then publishes an immutable directory named `generations/<manifest SHA-256>`. Publication and target activation are separate operations; a stale target revision can leave an unused complete generation.

Target activation uses revision-checked persistence as its commit point. Managed activation retains predecessor configurations for captured Session bindings; ordinary target edits clear that retained authorization. Existing live leases keep their captured helper/PTC paths and hashes. The installer never replaces or collects old generations, and transport loss cannot prove remote cleanup or reconstruct an interrupted outcome.

No invariant companion is published: manifest verification, remote probes, and target revision checks enforce the owned relationships at the operation that consumes them. The [installation decision](../../../.agents/notes/implemented/architecture/2026-09-20-remote-runtime-installation.md) owns rationale and verification requirements.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Saved execution targets](../execution-host-targets/README.md): target identity and activation persistence.
- [SSH execution](../../ssh/ssh/README.md): helper transport, streams, and disconnection semantics.
- [Immutable Session bindings](../../../.agents/notes/implemented/architecture/2026-09-20-immutable-session-execution-binding.md): captured deployments and lease ownership.

-----

<a id="model-experience"></a>
## Model Experience

### Runtime management observations

#### What the model sees

The `executionRuntimes` service adds no model tool, prompt, or Session content. Provisioning receipts remain management observations; execution consumers own their ordinary model-visible results.

#### Token effect

Installation contributes zero request tokens. Consumers account for any later execution output.

#### KV Cache effect

Installation does not modify a model request prefix. Session execution bindings retain their captured deployment independently of management observations.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits affect deployment and recovery:

- Real Linux/macOS endpoint acceptance requires deployed helper, PTC, native PTY, and sandbox enforcement evidence. Windows SSH/SFTP fixtures alone do not establish POSIX execution acceptance.
- The producer requires matching native binaries and rejects conflicting installed package versions. It does not compile foreign targets, upgrade remote Node, or provision accounts and installation roots.
- Generations remain indefinitely; safe garbage collection requires cross-Host reference knowledge. Task persistence across Host restart and automatic recovery after transport loss are not implemented.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Non-authoritative integration context: real POSIX acceptance is not recorded. Native system/Landlock payloads remain incomplete. The integration owner reports valid binary headers for installed node-pty prebuilds on all four POSIX targets; ABI execution remains unverified. The integration owner is obtaining a Linux guest for complete artifact production and native validation.

</details>
