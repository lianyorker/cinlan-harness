---
description: "Model-facing history_read and history_search recall tools over compacted session logs."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-recall

English | [中文](README.zh.md)

## Summary

`dsh-tool-recall` provides the model-facing `history_read` and `history_search` tools that allow agents to inspect original conversation history shadowed by compaction checkpoints. When long conversations are compacted, earlier user instructions, code fragments, command invocations, and tool results are preserved in durable session logs; this plugin equips the agent with direct read and search access to retrieve those exact details on demand.

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

Mount this plugin alongside `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-system-prompt` in your cordis configuration:

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-tool-recall'
  config:
    readBudgetChars: 8000
    searchLimit: 25
```

### Registered tools

| Tool | Purpose | Key Parameters |
|---|---|---|
| `history_read` | Retrieves full transcripts of original messages shadowed by a specific compaction checkpoint, with character budget pagination. | `checkpoint` (string, required), `offset` (integer, optional) |
| `history_search` | Performs a case-insensitive literal scan across all compacted conversation spans for exact keywords, paths, or errors. | `query` (string, required), `checkpoint` (string, optional), `limit` (integer, optional) |

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `readBudgetChars` | `number` | `8000` | Soft character budget per `history_read` page before producing a continuation cursor. |
| `searchLimit` | `number` | `25` | Default maximum number of matching snippet occurrences returned by `history_search`. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This package bridges model tool calls to immutable session event projections.

### Checkpoint resolution and transcript reconstruction

Checkpoints are identified by their summary sequence ID (e.g. `c42` corresponding to `compaction/summary` at sequence 42). When `history_read` or `history_search` targets a checkpoint, the plugin resolves the checkpoint through `session.surface.nodes` or durable `compaction/summary` log events.

To reconstruct the shadowed transcript faithfully, the engine traverses the durable event stream between `shadowedRange.start` and `shadowedRange.end`. Non-message envelope events are skipped, while message events (`user/message`, `assistant/message`, `tool/result`, `system/message`) are formatted with clear speaker labels. If a span itself shadows an earlier state checkpoint, that state checkpoint is labeled `[prior state checkpoint]` to maintain causal history while avoiding circular dereferencing.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: cordis plugin definition, tool definitions, and system prompt registration |
| [`src/types.ts`](src/types.ts) | Type definitions and Schemastery configuration schema |
| [`src/errors.ts`](src/errors.ts) | Branded `RecallError` with typed diagnostic codes |
| [`src/transcript.ts`](src/transcript.ts) | Checkpoint resolution, message reconstruction, and rendering logic |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Compaction seam](../compaction/README.md) — the condensation and checkpoint architecture.
- [Tools runtime](../../core/tools/README.md) — tool execution pipeline and presentation.
- [Recallable compaction Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-recallable-compaction.md) — architectural specification for recallable checkpoints.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`history_read` and `history_search` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-recall): `history_read` takes a checkpoint identifier and optional character offset; `history_search` takes a literal query string, optional checkpoint filter, and result count limit.

#### Token effect

Fixed schema cost on requests where recall tools are registered; schemas remain stable for the session lifetime.

#### KV Cache effect

Prefix-stable across turns while tool definitions remain unchanged; read results append to conversation tail only when the model explicitly invokes recall.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **In-process linear scan** — `history_search` executes a case-insensitive literal line scan over durable session log events in memory. Highly saturated sessions with tens of thousands of compacted events do not use a persistent full-text index.
- **Agent caller required** — Both tools require an active agent context with an attached `Session`; standalone tool calls without an agent context fail with `NON_AGENT_CALLER`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The recall tools intentionally do not introduce new storage sidecars or external vector databases; they read directly from the canonical immutable session log.

</details>
