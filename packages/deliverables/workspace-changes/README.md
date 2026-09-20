---
description: "Per-turn changed-file summaries and comparisons from git snapshots and file-tool captures; configuration, live Session lifetime, and coverage limits."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-changes

English | [中文](README.zh.md)

## Summary

See which files a top-level turn changed, with line counts and a comparison of each file before and after the turn. Git snapshots exclude earlier uncommitted changes, while whole-file captures cover paths changed by file tools outside the snapshots. Without git or a repository, only file-tool edits are listed. Summaries and comparison content remain available in the Host process until the Session is disposed, and use temporary disk space for that lifetime.

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

Mount the plugin with a Session store and a local subprocess provider. Git enables working-tree snapshots; its absence leaves file-tool capture available.

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-workspace-changes'
```

All bounds must be positive safe integers.

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `30000` | Milliseconds allowed for each git command |
| `outputMaxBytes` | `8388608` | Retained git stdout bytes; an oversized diff listing abandons the turn's record |
| `maxFiles` | `500` | Listed files per summary; totals include omitted files |
| `maxFileBytes` | `2097152` | Inclusive byte cap for a captured file or a snapshot side read for comparison |
| `diffTimeoutMs` | `100` | Milliseconds for line comparison before whole-file replacement |

The recorder observes Sessions with a working directory, excluding subagent origins and positive delegation depths. It captures each path before the turn's first `write`, `edit`, or mutating `str_replace_editor` call. Paths covered by snapshots use git counts; ignored paths and paths outside the repository use captured content. Without snapshots, every file-tool edit uses captures. Repeated edits count once, including subsequent shell edits to a captured path. Unchanged captures are omitted; two oversized sides remain listed because their contents are unknown.

Each `workspace/changes` event carries the turn number. `ctx.workspaceChanges.summary(sessionId, seq)` returns its summary, and `ctx.workspaceChanges.diff(sessionId, seq, index, signal)` compares the file at that summary index. The service returns undefined for unavailable records or files. Caller cancellation rejects a pending read; Session disposal makes it unavailable. Text comparisons have three context lines, `binary` and `oversized` results carry no text, and `coarse` marks a comparison that exceeded its time budget. See the [service types](src/types.ts) for all returned fields.

Files sort by their slash-separated `display` path: relative to the working directory, `../` for repository files above it, `~/` under the home directory, otherwise absolute. The file's `path` is relative inside the working directory and absolute elsewhere; absolute Windows paths retain native separators.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [recorder](src/recorder.ts) serializes baseline snapshots, captures, and turn-end records for each Session. Tools wait for queued work before executing. A private index and object store isolate snapshot writes from the repository's ordinary index and object store; committed objects are read through an alternate. Captured copies are content-addressed and bounded reads consume at most `maxFileBytes + 1` bytes. Comparisons read retained snapshots or copies, so later edits do not alter their contents.

[Git commands](src/git.ts) run through the subprocess provider with scrubbed environment, bounded stdout and stderr, cancellation, and deadlines. `GIT_CONFIG_COUNT=0` excludes ambient indexed configuration whose key entries the credential scrub removes. Recording failures warn and skip that attempt; later turns retry. Session and plugin disposal abort queued work and remove retained records and temporary data.

`agent/turn-stopping` records before the turn closes. A later tool result permits another record after `turn/end`; the latest event for that turn supersedes earlier records, including an empty result after changes were reverted.

**Runtime invariant:** No companion is published. The recorder owns the summaries, snapshots, and captures together; there is no independently maintained observation to reconcile.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web deliverables](../../client/ui-deliverables/README.md) — renders changed files and comparisons.
- [Subprocess capability](../../subprocess/README.md) — executes git commands and owns their processes.
- [Architecture](../../../docs/architecture.md) — Session events and turn extension points.

<a id="model-experience"></a>
## Model Experience

None, as the recorder appends a log-only `workspace/changes` event that only clients read and registers nothing model-facing.

#### KV Cache effect

Nothing enters model requests, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The recorder reports observed turn changes within these limits:

- Records survive only for the live Session in this Host process; reopening after a Host restart cannot recover earlier summaries or comparisons.
- Nested repositories and submodule contents are excluded. Outside snapshot coverage, files changed only through shell commands are absent; changes before a path's first file-tool call are also absent.
- Scratch paths under temporary roots are excluded outside the workspace. Edits by another actor during the turn are attributed to that turn.
- Snapshot storage includes every untracked, non-ignored file and has no aggregate disk cap. Git split indexes can write `sharedindex.*`, and git-lfs clean filters can write `.git/lfs` in the repository.
- Oversized captured files have no counts or comparison; oversized snapshot files retain git counts. Binary files serve no text. Captured comparisons ignore a missing final newline; git counts may still include it.
- Comparisons can disclose ignored files and files outside the workspace to the client. Deployments that must keep this content on the Host omit this plugin.
- A coarse comparison includes both files' lines, with input content up to twice `maxFileBytes` plus hunk metadata and line prefixes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
