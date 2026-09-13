---
description: "Service definition for per-Session working directory isolation."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-isolation

English | [中文](README.zh.md)

## Summary

This service definition lets Consumers acquire, inspect, compare, integrate, retain, and reactivate isolated working directories per Session. Providers choose checkout paths and validate every lifecycle operation; Consumers use lease identities rather than arbitrary repository, branch, or deletion paths.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount a concrete Provider rather than instantiating the abstract service. See [workspace-isolation-git](../workspace-isolation-git/README.md) for the Git implementation. Consumers use ensure or acquire for a ready path; sourceFor maps only a matching lease Session id and exact cwd to its source Workspace.

Client-safe type consumers can import the provider-neutral vocabulary from `@deepseek-ai/dsh-workspace-isolation/types`; this subpath emits no runtime service or Host augmentation.

<a id="understand-the-implementation"></a>
## Understand the implementation

find and list expose lease snapshots; activate materializes an existing lease, hibernate reclaims the checkout while preserving its branch, and inspect or compare returns bounded review data. merge and cherryPick integrate through the recorded source checkout, exportPatch returns content without accepting a destination path, and teardown returns either removed or review when an unmerged branch must remain durable. The Provider owns admission, integration, cleanup, and orphan discovery.

The Workspace registry validates managed checkout provenance through sourceFor without reading Session event bodies. Compositions without a Provider validate membership against ordinary cwd.

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

- The service does not decide whether a new Session is isolated; Consumers must explicitly perform admission and lifecycle operations.
- Patch text omits active untracked files; comparison and export report that omission.
- Git orphan scans cover only repositories referenced by durable leases, not repositories with no records.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

Keep hibernation separate from explicit teardown; preserving source attribution does not authorize arbitrary path cleanup.

</details>

No runtime invariant companion is published because concrete providers own lease persistence and exact-path validation.
