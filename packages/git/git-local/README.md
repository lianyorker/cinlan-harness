---
description: "Run bounded, read-only Git repository observations through the configured subprocess execution world."
kind: "package-reference"
---
# @deepseek-ai/dsh-git-local

English | [中文](README.zh.md)

## Summary

Run bounded, read-only Git repository observations through the configured subprocess execution world.

## Table of Contents

- [Use this package](#use-this-package)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

`LocalGitRuntime` is the local Service Provider for [`@deepseek-ai/dsh-git`](../git). It executes one configured `git` executable through `ctx.subprocess`, so the command and repository use the same execution world selected by the composition.

The provider exposes only repository resolution, structured status, bounded diff, and bounded log. It does not commit, push, create branches, or create worktrees. Mutation and isolation remain separate Consumers and providers.

## Config

| Key | Meaning |
|---|---|
| `executable` | Git executable name or absolute path resolved by the subprocess provider |
| `maxOutputBytes` | Maximum collected output for status, diff, log, and diagnostics |
| `maxLogEntries` | Maximum commits returned by one log request |
| `graceMs` | Process termination grace period |

All fields are explicit deployment configuration. The provider never invokes a shell and never interpolates user input into a command string.

Every observation clears ambient `GIT_*` entries, disables global and system Git configuration, disables system attributes, sets `GIT_OPTIONAL_LOCKS=0`, and pins `LANG` and `LC_ALL` to `C`. Git 2.25-compatible command-scope `-c` arguments disable `core.fsmonitor`. Before status or diff, the provider enumerates every effective repository `filter.*.clean` and `filter.*.process` entry and replaces that driver with an identity-free disabled configuration; a filter name that `-c` cannot represent fails the observation instead of executing repository configuration. Diff also passes `--no-ext-diff` and `--no-textconv`. Repository configuration therefore cannot redirect an observation, refresh the index through an optional lock, run an fsmonitor hook, or execute clean, process, external-diff, or textconv commands.

Repository resolution verifies that the requested path is inside the work tree reported by Git; a `.git` indirection whose configured work tree points elsewhere is rejected. `diff` returns the retained bounded text with `truncated: true` when stdout exceeds the caller limit. Repository resolution, status, and log require complete structured output and fail with `OUTPUT_TOO_LARGE` when either collected stream is incomplete. Every command waits for both the direct outcome and whole process-tree exit; spawn and lifecycle failures become `COMMAND_FAILED`, while caller cancellation is rechecked after settlement and preserves the caller's abort reason.

Status uses NUL-framed porcelain v1 records, returns the branch name for an unborn repository and `undefined` for detached HEAD, and rejects empty, malformed, truncated, or unterminated output. Rename and copy records consume their separate origin path without interpreting path bytes as another status. Log output also uses NUL-delimited fields, so commit subjects containing other control separators remain intact instead of being split into records.

## Model Experience

### Request context and condition

#### What the model sees

Git Consumers may present structured `ctx.git` status, diff, or log observations. This provider contributes no model-visible text by itself.

#### Token effect

Consumer-owned; only the bounded observation selected by that Consumer enters the request.

#### KV Cache effect

None directly; the Consumer owns any logged observation and request-suffix change.

## Known Limitations and Deferred Work

- The provider observes only one repository per request and does not list repositories.
- The provider requires a Git executable in the selected execution world; a libgit or remote provider remains separate.
- Commit, push, checkout, branch creation, merge, and worktree mutation are intentionally absent.
- No runtime invariant companion is published because each Git observation validates its repository and command result within the provider operation.

<a id="dev-note"></a>
### Dev Note

The provider uses the configured subprocess world for both Git commands and repository paths.
