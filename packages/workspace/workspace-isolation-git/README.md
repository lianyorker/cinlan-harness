---
description: "Managed Git worktree leases, hibernation, reactivation, and cleanup."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-isolation-git

English | [中文](README.zh.md)

## Summary

This Provider creates managed worktrees from clean Git workspaces and associates leases with Sessions. Hibernation preserves the branch and checkpoints staged and non-ignored changes while reclaiming the checkout. Inspection, bounded comparison, merge, cherry-pick, patch export, and safe teardown operate only on Provider-owned lease state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Cinlan profile mounts this Provider; standalone composition requires agents, storageDomain, and subprocess. New leases reject source workspaces with staged, unstaged, or untracked changes. Consumers protect active work with acquire and release the reservation after work stops.

<a id="understand-the-implementation"></a>
## Understand the implementation

Leases are stored in storageDomain. Defaults are <DSH_HOME>/worktrees/v1 for the root, git for the executable, 4 active checkouts, 1048576 bytes per output stream, 120000 ms per command, and 2000 ms termination grace. Configure them through root/dshHome, executable, maxActiveCheckouts, maxOutputBytes, commandTimeoutMs, and graceMs respectively.

Before hibernation, the Provider verifies Git registration against its durable lease and commits a checkpoint with hooks, filters, signing, and interactive credentials disabled. Capacity reclamation leaves leases with live Agents or reservations intact. merge and cherryPick require the recorded base branch in a clean source checkout and abort detected conflict state. teardown uses non-forcing branch deletion only after ancestry proves integration; otherwise it retains a hibernated lease with `reviewState: 'branch-retained'`.

<a id="model-experience"></a>
## Model Experience

### Session working directory

#### What the model sees

This package adds no prompt text. When a Consumer uses the lease `checkoutPath` as Session cwd, ordinary working-directory context reflects that path.

#### Token effect

No direct token cost from this package.

#### KV Cache effect

The fixed Session cwd does not change when its lease is hibernated and reactivated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Ignored files are not checkpointed and disappear with a reclaimed checkout. Active untracked files are omitted from patch text but become part of a later hibernation checkpoint.
- cherryPick creates different commit identities, so safe teardown normally retains the original managed branch for explicit review.
- Git orphan scans cover only repositories referenced by durable leases, not repositories with no records.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

Keep hibernation separate from explicit teardown; preserving source attribution does not authorize arbitrary path cleanup.

</details>

No runtime invariant companion is published because lease operations validate Git registration and owned paths before changing the checkout.
