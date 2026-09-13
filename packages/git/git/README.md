---
description: "Define read-only repository observations for consumers that need Git state without mutation or workspace isolation."
kind: "package-reference"
---
# @deepseek-ai/dsh-git

English | [中文](README.zh.md)

## Summary

Define read-only repository observations for consumers that need Git state without mutation or workspace isolation.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

This package defines the read-only Git capability seam (`ctx.git`). It owns repository identity, structured status, bounded diff, and bounded log observations without choosing a Git implementation or a workspace-isolation policy.

The service definition is intentionally separate from mutation and isolation:

| Package or Consumer | Role |
|---|---|
| `@deepseek-ai/dsh-git` | Service Definition and provider-neutral vocabulary |
| `@deepseek-ai/dsh-git-local` | Local provider backed by the selected execution world's `git` executable |
| Git mutation Consumers | Future approval-controlled commit, branch, checkout, push, and publication actions |
| Workspace isolation provider | Optional worktree or runtime lease; never implied by `ctx.git` reads |

`resolveRepository()` returns a canonical root and opaque repository id. `status()`, `diff()`, and `log()` return structured, bounded observations. Providers must reject non-repositories, command failures, and output beyond configured limits. Consumers must not parse provider-specific paths or infer that a task needs a branch.

## Model Experience

### Request context and condition

#### What the model sees

Consumers may present `ctx.git` status, diff, and log observations. Git output is not model-visible until a tool or workflow Consumer records it through the normal tool path.

#### Token effect

Consumer-owned; only the bounded observation selected by that Consumer enters the request.

#### KV Cache effect

Consumer-owned; a changed status or diff observation changes only the request suffix that includes it.

## Known Limitations and Deferred Work

- This seam does not mutate repositories, create branches, push, merge, or create worktrees.
- Repository identity is provider-owned and does not promise a particular Git object database representation.
- A remote provider and a structured libgit implementation remain future providers.
- No runtime invariant companion is published because the Service Definition owns no independently observable provider relation.

<a id="dev-note"></a>
### Dev Note

Provider and Consumer packages own executable Git behavior; this package owns the shared service vocabulary.
