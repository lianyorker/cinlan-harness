---
description: "Recallable conversation compaction with frozen index stubs, mutable state checkpointing, and keyless replay."
kind: "package-reference"
---

# @deepseek-ai/dsh-compact-recallable

English | [中文](README.zh.md)

## Summary

This package provides the recallable compaction engine for deepseek-harness. Instead of condensing conversation history into a single lossy summary paragraph, it partitions stale turns into fine-grained frozen index stubs and a structured working memory state checkpoint. When combined with @deepseek-ai/dsh-tool-recall, models can recall full verbatim message transcripts from past turns on demand without hallucination, while maintaining zero data loss, keyless replay, and strict context window limits.

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

Mount this package as an alternative to dsh-compaction-basic in a Cordis composition providing LLM, session persistence, and token measurement:

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-compaction-compact-recallable'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    chunkTokens: 4000
    stubTokens: 200
- name: '@deepseek-ai/dsh-tool-recall'
- name: '@deepseek-ai/dsh-command-compact'
```

### What you get

Automatic recallable compaction triggers during agent/pre-step when priced tokens exceed the configured threshold, partitioning staled turns into independent index chunks and an active state checkpoint. It also handles agent/request-error for context window overflow recovery, supports manual on-demand compaction via compactNow or /compact, and integrates transparently with tool-output pruners.

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| thresholdRatio | number | 0.8 | Context window fraction triggering automatic pre-step compaction. |
| retainRatio | number | 0.16 | Fraction of context window kept verbatim in recent tail; mutually exclusive with retainTokens. |
| retainTokens | number | undefined | Explicit token budget kept verbatim in recent tail; mutually exclusive with retainRatio. |
| chunkTokens | number | 4000 | Target token size per frozen index chunk slice. |
| stubTokens | number | 200 | Estimated token size per generated index stub for inflation calculations. |
| summarizationProvider | string | undefined | Provider override for compaction summarization model calls. |
| summarizationModel | string | undefined | Model override for compaction summarization model calls. |
| maxTokens | number | 8192 | Maximum output tokens permitted for summarizer responses. |
| compactionRetries | number | 1 | Retry attempts if token count remains above threshold after a compaction pass. |
| maxOverflowRetries | number | 1 | Maximum consecutive retries authorized on provider context overflow. |
| modelPolicies | array | [] | Per-model policy overrides matching provider and model name. |
| auto | boolean | true | Whether automatic pre-step and overflow compaction listeners are mounted. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The recallable compaction engine implements a three-phase architecture that preserves keyless replay and recallability:

1. Partitioning: selectPartitionPlan identifies the system message, preserves the recent verbatim tail according to retainRatio or retainTokens, respects tool pairing balance boundaries, and partitions the middle staled history into frozen index chunks (~chunkTokens) and a trailing slice.
2. Concurrent Summarization: summarizeChunk processes each chunk independently with prior state and keyword directories injected as background guidance, while summarizeState summarizes active working memory. If a chunk contains only recall tool calls and results, it degrades to a zero-LLM deterministic pointer; if chunk LLM fails, it degrades to a code-composed fallback stub.
3. Inflation Guard & Sequential Commit: Before committing, the engine asserts that estimated new tokens are strictly lower than shadowed tokens. If verified, it commits compaction/start, compaction/summary, user/message surface replacement, and compaction/end events sequentially for each stub, followed by the mutable state checkpoint.
4. Successive Passes & Fold-in: On subsequent compaction passes, the previous mutable state checkpoint is folded into the new compaction range and converted into an index chunk, while all earlier index stubs remain immutable at their original surface positions.

### Source map

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Engine lifecycle, Cordis service registration, automatic listeners, and sequential commit |
| [src/types.ts](src/types.ts) | Public configuration, slice models, and result interfaces |
| [src/config.ts](src/config.ts) | Configuration parsing, validation rules, and per-model policy resolution |
| [src/chunking.ts](src/chunking.ts) | Conversation partitioning, tool boundary balance, and index checkpoint identification |
| [src/summarizer.ts](src/summarizer.ts) | Concurrent LLM summarization, layered prompts, and degradation ladders |
| [src/prompts.ts](src/prompts.ts) | Prompt templates for index stub and state checkpoint summarizers |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Recall tools](../tool-recall/README.md) — model-facing history_read and history_search tools.
- [Compaction seam](../compaction/README.md) — shared compaction service definition and types.
- [Recallable compaction Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-recallable-compaction.md) — architectural specification for recallable checkpoints.

-----

<a id="model-experience"></a>
## Model Experience

### Conversation history

#### What the model sees

After automatic or manual compaction, stale conversation turns are replaced by frozen index stubs and a mutable state checkpoint. Each stub carries keyword anchors and a deterministic footer pointing to the shadowed message span, followed by the state checkpoint with current goals, decisions, constraints, and next steps.

#### Token effect

Frozen stubs condense past turns into ~100–200 token index cards while the mutable state checkpoint preserves working memory under the configured cap. Future input history shrinks substantially, leaving headroom for ongoing turns.

#### KV Cache effect

Frozen index stubs are byte-identical across subsequent compaction passes, preserving prefix prompt cache hits across passes. Only the rewritten state checkpoint and new conversation turns require fresh prompt evaluation.

### Auxiliary summarizer request

#### What the model sees

The summarization model receives chunk slices or prior state context replayed with deterministic prompts, producing structured index stubs with keyword anchors or consolidated working memory updates.

#### Token effect

Summarizer requests run concurrently across stale chunks, bounded by `chunkTokens` and `stubTokens` configuration caps.

#### KV Cache effect

Auxiliary requests share a common preamble and pass-start state prefix across concurrent chunk calls, earning cached token read rates from supporting providers.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- In-process LLM summarization: Summarization runs concurrently within the harness process. Very large conversations with dozens of chunks may saturate provider concurrency limits.
- Indivisible single messages: A single oversized message (e.g. huge file dump exceeding chunk tokens) cannot be sub-partitioned by chunking; it occupies its own chunk.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Recallable compaction maintains the strict invariant that all historical surface replacements are logged as canonical session events, enabling deterministic keyless replay without external databases.

</details>
