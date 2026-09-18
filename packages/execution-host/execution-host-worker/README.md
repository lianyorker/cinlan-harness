---
description: "Inspect directories on an execution host through bounded JSON-RPC requests and explicitly exported roots."
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-host-worker

English | [中文](README.zh.md)

## Summary

Inspect directories inside explicitly named roots on a connected execution host. Results include the process host identity and report truncation when entry or byte limits apply. Cancellation waits for the filesystem operation to settle. The worker serves newline-delimited JSON-RPC over standard input and output in a dsh profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside execution-host, filesystem, and subprocess providers in the worker profile. Reserve stdout for protocol frames; logging belongs on stderr.

### Configuration

The empty root list exports no filesystem access. Each root has a unique `id`, a nonempty `label`, and an absolute `path` that resolves to a directory.

| Field | Default | Meaning |
|---|---|---|
| `roots` | `[]` | Explicit named directories available for inspection. |
| `operationTimeoutMs` | `30000` | Deadline that aborts an operation and waits for settlement. |
| `maxFrameBytes` | `262144` | UTF-8 bytes per complete JSON-RPC line, excluding newline. |
| `maxResultBytes` | `131072` | UTF-8 bytes for a complete operation result, including result metadata. |
| `maxEntries` | `1000` | Directory entries per inspection result. |
| `maxConcurrentOperations` | `16` | Active inspections before new work is refused. |
| `maxCompletedOperations` | `256` | Recently settled operation IDs retained for cancellation races. |

### Requests and results

Initialize with protocol version 1 before inspecting directories. Use a returned root ID and a relative path; an empty path or `.` names the root. Absolute paths, parent traversal, and symlinks resolving outside the root are refused. A request must name the host identity returned by initialization. Errors contain stable machine codes and sanitized messages.

Cancel an active or retained completed operation ID. The acknowledgment means its filesystem work has settled; an unknown or evicted ID is refused. Shutdown and input EOF abort owned operations, await settlement, and request the launcher's bounded shutdown.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [protocol leaf](src/protocol.ts) supplies DTO schemas and bounded transport for both worker and connector. The [plugin](src/index.ts) owns standard-stream serving as a Cordis effect. It requires launcher readiness and exit services, starts reading only after successful startup commits, and waits for Loader settlement before initialization. Directory inspection uses the injected filesystem's canonical resolution and containment. Process provenance comes from `executionHost.current()`.

No invariant companion is published: the worker owns request processing and operation lifetimes, with no independently maintained projection that could diverge.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Execution host identity](../execution-host/README.md)
- [Filesystem capability](../../fs/fs/README.md)
- [Application launch](../../../docs/architecture.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this worker exposes no Agent tools, prompts, or model requests.

#### KV Cache effect

The worker contributes no model context and does not affect reusable model prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The worker supports directory metadata inspection only.

- Filesystem providers list the complete directory before the worker caps returned entries; provider cancellation determines settlement latency.
- Canonical containment prevents resolved symlink escapes, but path-based filesystem APIs do not provide an atomic defense against concurrent hostile directory replacement.
- Completed operation IDs expire when the configured retention bound is exceeded. Clients must use fresh IDs for each operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
