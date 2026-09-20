---
description: "Run TypeScript programs in fresh Node processes with the session filesystem sandbox, managed cleanup, and configurable execution and output limits."
kind: "package-reference"
---

# @deepseek-ai/dsh-ptc-runtime-node

English | [中文](README.zh.md)

## Summary

Execute model-written TypeScript under the same platform sandbox policy as Bash, with host-provided functions available as async bindings. Each call starts a fresh Node process and returns captured logs, an exact JSON value, or a structured failure. Direct Node APIs remain available within the selected restrictions. Elapsed deadlines, output bounds and a V8 heap limit constrain execution; cancellation and completion terminate the managed process range. A requested restricted mode fails when its sandbox backend is unavailable.

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

Mount this optional provider in a composition that supplies `fs`, `subprocess`, `sandbox` and `sandboxPolicy`. Direct consumers call `ctx.ptcRuntime.resolve(request)` before execution. Existing `dsh-tools` consumers use the separate CodeRuntime adapter described below.

### Configuration

Configure the provider row after its required services are available:

```yaml
- name: '@deepseek-ai/dsh-ptc-runtime-node'
  config:
    timeoutMs: 120000
    maxTimeoutMs: 600000
    maxOutputBytes: 67108864
    maxOldGenerationSizeMb: 512
    maxMessageBytes: 134217728
    maxPendingCalls: 128
    graceMs: 3000
```

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120,000` | Default elapsed execution deadline, including nested tool and approval waits |
| `maxTimeoutMs` | `600,000` | Elapsed deadline ceiling applied by the resolver |
| `maxOutputBytes` | `67,108,864` | Combined serialized logs and completion or diagnostic budget |
| `maxOldGenerationSizeMb` | `512` | V8 old-generation heap limit in MiB |
| `maxMessageBytes` | `134,217,728` | Limit for a control frame, outstanding argument bytes and queued control writes |
| `maxPendingCalls` | `128` | Maximum simultaneous host binding calls |
| `graceMs` | `3,000` | Managed termination and output-drain grace |
| `nodeExecutable` | Current Node executable | Executable resolved in the subprocess execution world |
| `bootstrapPath` | Package bootstrap | Optional absolute path to a preinstalled built bootstrap in that world |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-ptc-runtime-node) defines accepted config fields. `resolve(request)` supplies cwd, the numeric or null deadline choice and the execution policy; `run(spec)` accepts those resolved inputs and does not fill missing values.

<a id="optional-coderuntime-adapter"></a>
### Optional CodeRuntime adapter

Custom profiles using the existing `ctx.codeRuntime` API can mount `@deepseek-ai/dsh-ptc-runtime-node/code-runtime` alongside this provider and `sandboxPolicy`, in place of their CodeRuntime provider. The package main entry registers only `ptcRuntime`; the adapter registers `codeRuntime` and delegates execution without another worker. The shipped worker-thread provider remains the default.

The adapter resolves the initiating Session's workspace and standing sandbox policy through the optional `agents` service; agentless calls use deployment policy. It forwards bindings, cancellation, logs and JSON values. Its own disposal aborts its calls and waits for PTC cleanup without unloading the provider. The existing CodeRuntime API has no per-call timeout or sandbox options and no sandbox result metadata; `protocol` and `sandbox-unavailable` become `worker-exit` with their diagnostic text preserved. Direct PTC consumers retain the full API.

For SSH, configure `nodeExecutable` and the absolute `bootstrapPath` of a compatible preinstalled built `process.js` in the remote execution world. Bootstrap installation belongs to the deployment; this provider does not upload host files. The [SSH package](../../ssh/ssh/README.md) owns supported host and remote platforms.

### Execution and results

Programs are async function bodies: top-level `await` and `return` work, and only erasable TypeScript is accepted. A successful call returns its lossless-JSON value as `result.value` and captured text as `result.logs`. `result.sandbox` reports the selected mode, observed denial and the backend's full or partial enforcement independently of the program outcome.

Direct filesystem, network and subprocess operations remain Node operations, subject to the selected OS sandbox. Nested host bindings cross the control channel; PTC tool calls retain the registry's visibility, ordering, logging and approval rules. Running a program does not change the Session's standing policy or automatically replay it after a denial.

### Deadlines and cancellation

Direct PTC consumers can read the readonly `timeout` descriptor for the effective default and maximum. `executionInstructions` describes fresh Node state, direct Node APIs, the empty program environment and file policy. The optional CodeRuntime adapter uses configured defaults and leaves the existing tool schema unchanged.

Omitting `timeoutMs` uses the configured elapsed default; numeric requests are validated and capped. Direct service callers can explicitly pass `timeoutMs: null` to omit the elapsed timer. An enabled deadline covers runtime setup and execution, including time awaiting nested tools or approval. It is not a CPU meter. Timeout or cancellation stops a synchronous loop through the host's managed process owner; successful completion also cleans that managed range. The timer stops when an outcome is selected, before cleanup, so the returned call can take longer than its execution deadline while cleanup settles.

### Failures

Program parse errors and thrown exceptions are `exception`; deadline expiry is `timeout`; cancellation is `abort`; malformed or excessive control traffic is `protocol`; unavailable confinement is `sandbox-unavailable`; early process exit or failed managed cleanup is `worker-exit`. The substrate-independent failure name remains `worker-exit` for process providers. Lossy completions are `invalid-output`, and an oversized outer result is `output-limit`, retaining the fitting log prefix. Invalid or unsupported options and calls after disposal reject as caller misuse.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The host owns policy, deadlines, binding lookup and process cleanup. The child owns program evaluation and binding proxies; model-written code is an untrusted peer even when its messages use the expected control descriptor.

### Launch and control

The host strips erasable types, resolves the executable and bootstrap in the configured execution world, awaits argv confinement through `ctx.sandbox`, then spawns through `ctx.subprocess`. Cancellation is checked again after confinement, so a provider returning after cancellation cannot start the program. After adopting the inherited control channel, the child retains only executable-search, Windows system, and temporary paths in its OS environment and replaces the program-visible `process.env` with an empty dictionary. Windows ACL setup receives the parent's distinct `TEMP` and `TMP` values for shared grant locks, then replaces both with its private directory before starting the program. These native paths keep nested process creation and native temporary-file APIs functional. The host preserves `ELECTRON_RUN_AS_NODE` only for child startup so the Desktop executable runs the Node bootstrap; the bootstrap removes the selector before evaluating model code. The heap limit uses Node argv or a provider-created `NODE_OPTIONS` value for packaged executables; ambient loader and inspector flags are discarded.

Length-framed JSON travels separately from stdout/stderr. The host bounds frames and queued writes, validates call identity and declared binding names before dispatch, and refuses invalid traffic. The child flushes its terminal frame and keeps the control channel open until the host closes it. After submitting that frame, it ignores later binding replies and sends no further program control messages. Output capture meters serialized logs plus the completion or diagnostic; fixed result-envelope fields and sandbox metadata are outside that ledger.

### Source and built bootstraps

Source execution loads an erasable-only bootstrap closure without relying on sibling built exports. Built execution uses the packaged `process.js` entry. An execution world that cannot map the host bootstrap requires a preinstalled compatible `bootstrapPath`; a host path is never assumed to name the same remote file.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Configuration, resolution, policy, bindings and managed execution |
| [`src/launch.ts`](src/launch.ts) | Executable/bootstrap arguments and execution-world asset mapping |
| [`src/code-runtime.ts`](src/code-runtime.ts) | Optional adapter for existing CodeRuntime consumers |
| [`src/process.ts`](src/process.ts) | Child handshake, environment clearing and program lifecycle |
| [`src/bootstrap.ts`](src/bootstrap.ts) | Program evaluation, binding proxies and output capture |
| [`src/channel.ts`](src/channel.ts) | Framing, bounded writes and protocol failures |
| [`src/output-ledger.ts`](src/output-ledger.ts) | Host accounting for the outer result |
| — | No runtime invariant companion is published; framing and process cleanup are enforced across the process boundary rather than through independent same-process observations. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read the service contract before using the provider directly; the decisions explain policy and consumer ownership.

- [PTC runtime service](../ptc-runtime/README.md) — requests, resolved specs and results.
- [Sandbox service](../../sandbox/sandbox/README.md) — file policy and enforcement guarantees.
- [PTC foundation](../../../.agents/notes/implemented/feature/2026-06-15-ptc.md) — registry presentation and nested tool dispatch.
- [Subprocess provider](../../subprocess/subprocess-local/README.md) — managed process ranges and platform limitations.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through PTC mode in `dsh-tools` when the optional CodeRuntime adapter is mounted. That consumer presents program outcomes through its tool results. Intermediate binding traffic stays outside model history; the outer result follows the ordinary tool spill policy.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits qualify the execution guarantees and retained output.

- **Confinement inherits the selected backend's limits** — full and partial enforcement are reported separately; sandbox policy and managed-process containment are distinct guarantees.
- **The heap cap is not a process-tree memory limit** — native allocations and descendant memory are outside the V8 old-generation bound. No process-tree CPU meter is supplied.
- **Cleanup inherits subprocess observability** — escaped descendants on a fallback platform may remain outside the managed range; see the subprocess provider's stated limits.
- **Execution is one-shot** — no yield/wait API, live result stream or retained program state exists between calls.
- **Output caps reject rather than retain every byte** — spill can preserve only the bounded result delivered by this provider.
- **Bindings are bounded at transport admission** — control limits do not bound the memory a host binding allocates while producing its result.
- **The console shim has five methods** — `log`, `info`, `warn`, `error` and `debug`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
