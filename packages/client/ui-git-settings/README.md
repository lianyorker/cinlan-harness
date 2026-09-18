---
description: "Native Git preferences, persistence feedback, and runtime-consumer limitations."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-settings

English | [中文](README.zh.md)

## Summary

Configure new Worktree Task branch prefixes and Source Control group order, upstream comparison, and commit attribution from the Development settings group. The page edits the durable `git-source-control` namespace owned by [Git settings](../../git/git-settings/README.md). Local base refresh is unavailable; its saved value remains visible and resettable.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Choose a branch-prefix mode and source-control group order, or change upstream comparison and attribution. The disabled base-refresh switch preserves its saved state; Reset removes its user override. Custom-prefix text stays local until Save; a rejected save retains the draft. Its starting revision fences the save, and Discard reveals the latest Host value. The custom field remains visible but disabled outside Custom mode. Reset removes an explicit user override, including one equal to the inherited value. Read-only and memory-mode connections cannot write.

Settings search indexes the six localized field labels and descriptions. Each result targets its owning row; stored prefixes and other current values do not enter the index.

<a id="implementation"></a>
## Implementation

The renderer binds the namespace snapshot through the standard injected hook. Writes and resets fence the revision read by the operation and report success only when authoritative readback confirms the requested value or override removal. A settled SettingsScope mutation alone does not imply persistence. The page disables concurrent controls while saving and clears a custom draft only after a successful save or reset.

The `settings.section` contribution, Development group metadata, and six search descriptors share one `slots.inject` lifetime. The section id remains `git-source-control` with order 36. The [settings domain](../ui-settings/README.md) owns transport and persistence; [operations](src/client/settings-operations.ts) own this page's confirmed outcome callbacks.

No runtime invariant companion is published: the page derives live values from its settings scope and owns no independent durable projection.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Worktree Task and Source Control preferences edited by this page.

#### KV Cache effect

None; the package does not assemble provider requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The page describes each preference's runtime scope:

| Preference | Runtime behavior |
| --- | --- |
| `branchPrefix`, `branchPrefixCustom` | [Worktree Task Create](../../workspace/worktree-task-git/README.md) prepends the selected prefix to `dsh/task/<uuid>`. Username mode has no fabricated preview; Create reads local repository configuration. |
| `refreshLocalBaseRefOnWorktreeCreate` | Unavailable. Create neither fetches nor fast-forwards a local base ref. |
| `sourceControlGroupOrder` | Orders Source Control change groups. |
| `compareAgainstUpstream` | Selects upstream comparison in Source Control; an unavailable upstream is reported. |
| `enableGitHubAttribution` | Adds attribution to explicit Source Control commits, excluding Worktree Task checkpoints, pull requests, and issues. |

The visual reference's automatic naming, sign-off, AI commit-message, and commit-language fields have no corresponding settings or operations here. They are not exposed by this page.
