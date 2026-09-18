---
description: "Manual sidebar Git actions, commit review, cached-ref comparison, and Session repository authority."
kind: "package-reference"
---

# @deepseek-ai/dsh-sidebar-git

English | [中文](README.zh.md)

## Summary

Inspect repository changes and history, stage or unstage files, switch local branches, and explicitly commit, discard, revert, or cherry-pick from the sidebar. Review the complete commit message and repository state before committing. Comparisons use locally cached refs without fetching. Each sidebar action selects its repository from the attached Session's authoritative working directory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service beside Session, Subprocess, Settings, and the [Git settings namespace](../git-settings/README.md). The [Remote controller](../../api/sidebar-git-controller/README.md) and sidebar Fetch routes call the same operations. Callers provide an attached Session id; a client-supplied directory cannot replace a missing Session working directory.

| Field | Default | Meaning |
| --- | --- | --- |
| `executable` | `git` | Git executable name or path. |
| `timeoutMs` | `30000` | Deadline for each Git subprocess. |
| `graceMs` | `1000` | Graceful process termination interval. |
| `maxOutputBytes` | `8388608` | Maximum bytes per output stream and serialized response. |
| `maxMessageBytes` | `65536` | Maximum commit-message bytes, including added attribution. |
| `defaultLogEntries` | `30` | Default history page size. |
| `maxLogEntries` | `500` | Maximum history page size. |

Limits must be positive safe integers, and the default history page cannot exceed its maximum. Output overflow rejects the operation rather than returning truncated Git data. Cancellation and service disposal terminate and await owned subprocesses.

### Review a commit

Stage files, then prepare a commit message for review. Preparation rejects an empty message, an empty staged diff, a detached HEAD, or unresolved index conflicts. When attribution is enabled, it appends `Co-authored-by: Cinlan IDE <noreply@cinlan.online>` unless that trailer is already present, and shows the complete resulting message. Confirmation carries that message and the observed Session directory, repository, Git directory, branch, HEAD, and index fingerprint. Execution refuses changed facts and requires a new review.

Git receives the reviewed message through stdin with `--cleanup=verbatim`. User hooks, identity, and signing configuration remain active. The result returns the commit id and the message actually recorded by Git, including any hook edits. These explicit user commits do not change Worktree Task checkpoint behavior.

### Compare committed changes

With upstream comparison enabled, the service first selects the configured upstream. If it cannot select one, it reports fallback use and tries the locally cached `origin/HEAD` target, then local `main`, then local `master`. With the preference disabled, the same default-branch order applies directly. The result pins both commit ids and compares changes from their merge base. Unborn or detached HEAD, a missing default branch, and unrelated histories produce explicit unavailable reasons. Comparison never fetches remote refs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[The service](src/index.ts) derives repository authority from Session state, validates literal paths and revisions, serializes its own mutations per repository, and repeats admission checks after waiting in the queue. Stage, unstage, checkout, and commit require the displayed repository; discard and history mutations also pin the displayed HEAD. Discard restores one tracked worktree path from the index and leaves the index intact. Git conflict outcomes remain repository state for the user to resolve.

[The subprocess owner](src/process.ts) uses argument arrays with `--literal-pathspecs`, disables pagers, color, filesystem-monitor integration, and optional read locks, and removes ambient repository redirection. It retains user hooks and signing policy. [Shared request types](src/types.ts) carry the same facts through Fetch and Remote without adding a client-selected working directory.

No invariant companion is published because the service owns no persisted cache independent of Git and Session state. The operation executor enforces process lifecycle and preflight validation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Git preferences](../git-settings/README.md) — shared settings and defaults.
- [Sidebar Git Remote controller](../../api/sidebar-git-controller/README.md) — typed transport and error codes.
- [Worktree Task Git](../../workspace/worktree-task-git/README.md) — managed checkouts and checkpoint policy.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the service exposes only explicit sidebar actions and adds no model-facing mutation tools, turn-end behavior, or model input.

#### KV Cache effect

None; the service does not assemble model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Git and the surrounding sidebar retain these constraints:

- DiffTab reads untracked file contents through the shared sidebar filesystem Fetch route. File contents belong to that filesystem operation, separately from Git status and diff queries.
- Local base refresh is unavailable. The service performs no fetch, pull, push, or GitHub API operation.
- The mutation queue coordinates this service only. Admission checks and subsequent Git writes are not one atomic transaction with external Git processes.
- Attribution insertion uses Git’s trailer formatter to preserve existing trailers. Preview refuses configured trailer commands and formatting that cannot produce the canonical co-author trailer.
- User hooks or signing can reject a commit. A hook may edit its message; the returned message records Git's actual result.
