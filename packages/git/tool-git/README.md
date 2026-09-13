---
description: "Give the model three bounded, read-only tools for repository status, diff, and log observations."
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-git

English | [中文](README.zh.md)

## Summary

Give the model three bounded, read-only tools for repository status, diff, and log observations.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

This package is the model-facing Consumer for the read-only [`ctx.git`](../git) capability. It registers three operation-specific tools and delegates every repository observation to the configured provider:

| Tool | Arguments | Result |
|---|---|---|
| `git_status` | none | Canonical repository root and `HEAD`, plus branch, upstream divergence, staged, unstaged, untracked, conflicted, and clean fields |
| `git_diff` | optional `max_bytes` | Canonical repository root and `HEAD`, plus the bounded diff observation and truncation state |
| `git_log` | optional `limit` | Canonical repository root and `HEAD`, plus bounded commit entries with hash, author, commit time, and subject |

The model cannot select a path. Every execution requires the exact calling Agent to remain registered in `ctx.agents` and its Session header to carry `cwd`; that execution-world workspace path is the only value passed to `ctx.git.resolveRepository()`. Agentless, unregistered, stale, and missing-`cwd` calls fail before provider access, so a model cannot use these tools to inspect another repository visible to the harness process. `max_bytes` maps only to `GitDiffRequest.maxBytes`; `limit` maps only to `GitLogRequest.limit`. Omitting either leaves default resolution to the provider, and the tool forwards the call's `AbortSignal` to repository resolution and the selected observation.

All three definitions are concurrency-safe model reads and use generic read presentation cards without file locations because the operation observes a repository, not one file. The package never invokes a shell and cannot commit, checkout, create branches, push, merge, reset, clean, or create worktrees. Those effects and optional workspace isolation require separate plugins and approval policy.

## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`git_status`, `git_diff`, and `git_log` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-git). The workspace path is absent from every schema. Status has no arguments; diff exposes only `max_bytes`; log exposes only `limit`. Descriptions state that the tools are read-only and restricted to the calling Agent's workspace repository.

#### Token effect

Three fixed schemas are added to every request in the plugin scope. No repository observation is injected until the model calls a tool.

#### KV Cache effect

Prefix-stable while the plugin and tool view are unchanged. Enabling, disabling, or filtering any definition changes the tool-schema prefix.

### Tool results

#### What the model sees

Every success starts with the canonical repository root and either the current `HEAD` or `(unborn)`. Status renders explicit counts and uses `(detached)` when no branch is attached. Diff renders its truncation flag followed by the retained text or `(no diff)`. Log renders one tab-delimited line per commit and JSON-quotes author names and subjects so embedded separators remain unambiguous. The canonical result values remain structured objects matching the output schemas.

#### Token effect

Status is constant-size. Diff and log are bounded by the provider and optional caller limits; their retained results remain in model history until compaction.

#### KV Cache effect

Append-only. Each observation follows the reusable request prefix, while a changed repository affects only later tool-result tokens.

## Known Limitations and Deferred Work

- The Consumer observes only the repository containing the calling Session's workspace `cwd`; it cannot inspect a second repository in one call.
- The current service has no staged, untracked-file content, revision-range, or path-filtered diff operation; those observations require explicit future service methods.
- Repository mutation, publication, and worktree isolation remain intentionally absent and must not be added as hidden modes of these read tools.
- No runtime invariant companion is published because tool registration metadata does not form an independently observable owned relation.

<a id="dev-note"></a>
### Dev Note

The Consumer does not add mutation or path-selection modes to the read-only Git tools.
