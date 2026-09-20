---
description: "Workspace entity registry (ctx.workspaceRegistry) for hosts choosing, mounting, or debugging durable workspace records and header-validated session membership."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace

English | [中文](README.zh.md)

## Summary

Use this package to keep an ordered, persistent list of project directories and the sessions run in each directory. Hosts can build project sidebars, hide sessions from grouping without deleting their histories, and remove projects without deleting folders, files, or sessions. Re-adding a removed directory creates a fresh project, while sessions whose directories cannot be validated remain ungrouped. Choose it for GUI or host workflows that need durable project grouping; it is invisible to models and adds no prompt or request-context cost, but requires session persistence and storage backends.

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

Use this package to give the product a project list: named directories the user works in, the sessions that ran in each, a stable order, and a way to hide sessions without losing them. The API contracts behind each action live in the implementation section.

### When to use it

Use it when the product shows a persistent workspace surface — a sidebar, session grouping, or automation that names directories and orders them. It is invisible to the model, so it adds no token or request cost. Skip it when there is no grouping surface; nothing else in the harness needs it.

### Setting up

The package takes no configuration of its own; it needs a session store, a session persistence backend, and the storage rows that keep its records. A minimal composition:

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-workspace'
```

With these rows mounted, creating a project shows up in the list immediately and survives a restart; the first start also groups existing sessions by the directory they ran in. If a required peer is missing, the workspace feature stays unavailable until it is mounted.

### Creating and ordering projects

Create a local project from any fully qualified directory that exists: filesystem roots such as `C:\` and ordinary directories are valid. Relative paths, Windows drive-relative paths such as `C:work`, missing paths, and files are rejected without creating a project; creating a project for a directory that already has one returns the existing project unchanged. Rename a project at any time, and move it to any position in the list:

```text
// Host consumer code, after the composition above is loaded:
const project = await ctx.workspaceRegistry.create('/path/to/dir', 'My Project')
await project.setTitle('Renamed')
ctx.workspaceRegistry.list() // shows the project, newest first
```

Pass a captured SSH binding as the third argument to `create(path, title?, execution?)` to create a remote project. Remote creation verifies the directory through `executionBindings` and saves the canonical remote path alongside the configured-root snapshot. The same path on another target or revision identifies a different project. Omitting the binding selects local execution. `resolveByPath(path, execution?)` applies the same binding and path identity without creating a record.

### Grouping sessions under a project

A session joins a project only when its execution binding and canonical directory match. Newly attached sessions appear first, and each session belongs to at most one project. Attachment validates the published Session through its retained execution lease, so a later target edit does not retarget or invalidate that live Agent; missing directories and binding mismatches still reject. Startup groups remote history from recorded POSIX paths and durable execution metadata without reconnecting, while local history still requires an existing local directory.

### Hiding sessions and removing projects

Hide a session from the grouping when it should stop appearing there: it disappears from the visible list, while its session, history, and place in the project stay intact. Remove a project when it is no longer needed: it leaves the list, and its folder, files, and session histories are never touched — those sessions become ungrouped. Adding the same directory again afterwards starts a fresh project without the old sessions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the feature and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One record per execution binding and canonical path.** Local paths use Host `fs.realpath`; remote creation uses the lease canonical cwd. Binding identity includes the captured target, revision, endpoint, and deployment coordinates.
- **Membership is ownership plus a live cwd fact.** The record's ordered `sessionIds` is the ownership truth; attachment compares the retained Session lease and verifies its cwd through that lease's filesystem, then startup indexing and `sessionIds` filtering keep stale candidates out until the next mutation prunes them durably.
- **Execution-aware history reads.** With `executionBindings`, header cwd values pair with the service's live-or-durable Session metadata. Without it, startup folds `execution/bound` directly from each non-empty durable log and defaults to local only when the event is absent; an SSH event fails startup before Host `realpath`. Remote indexing never opens a connection.
- **Two-write mutations with an explicit marker.** Create and delete persist a `pendingMutation` marker before the record/order pair can diverge, so startup completes exactly the interrupted operation and unmarked divergence fails loud as corruption.
- **Serialized writes.** Registry operations run on one operation chain; entity mutations go through `table.update` on the domain write chain, stamping `updatedAt` and deciding membership at their chain slot.

### API behavior

The API is one small family with two owners: `WorkspaceRegistry` creates, orders, and deletes projects and manages their session accounting; the `Workspace` entity exposes the display title, directory status, and the session projection. Per-method contracts live in the code, not this README — see [src/index.ts](src/index.ts) and [src/entity.ts](src/entity.ts).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `WorkspaceRegistry` service, header index, bootstrap, operation serialization |
| [`src/entity.ts`](src/entity.ts) | Package-private `Workspace` implementation and its single `mutate` write path |
| [`src/spec.ts`](src/spec.ts) | Domain declaration: record schema, registry state, `defineDomain` spec |
| [`src/types.ts`](src/types.ts) | Public `Workspace` interface and `WorkspaceId` brand |
| [`src/paths.ts`](src/paths.ts) | Local canonical paths and platform-specific titles |
| [`src/execution.ts`](src/execution.ts) | Durable binding folding, execution/path identity, and leased directory verification |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: the entity cache mirrors the durable table |

### Durable shape

The registry opens the `workspace` domain (version 3, accepting version 2 records): a `workspaces` table keyed by `WorkspaceId` plus one global state holding `workspaceIds` (the authoritative display order), `archivedSessionIds`, and the optional `pendingMutation` marker. Absent `archivedSessionIds` parses as an empty set; absent record `execution` parses as local. SSH records retain their public snapshot without credentials.

### Lifecycle

On start, the registry opens the domain, completes a marked mutation if one is pending, validates stored state — duplicate binding/path identities, duplicate session accounts, and order drift all fail loud — and, when not yet initialized, bootstraps history from persisted Sessions before writing the initialized marker last, so an interrupted bootstrap resumes safely. When the execution service is absent, non-empty logs are read to distinguish an explicit binding from an event-free local Session. A fresh empty registry is real once initialized; it never re-bootstraps.

### Failure and recovery

A create or delete whose second write fails rolls the cache and the prior order back; when both the operation and its rollback fail, the durable marker still names the interrupted operation and the next startup completes or rolls it back. A committed delete whose marker cleanup fails still reports success, and the next startup clears the marker idempotently.

### Invariant

The `workspace-invariant` companion registers the owned relationship: every durable `domain/changed` for the `workspaces` table must name a record the entity cache already holds — the record must also retain the cached execution binding and canonical path. A delete is valid only after removal from the cache.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this package's view is not enough: the subsystem reference is the authoritative feature contract, and the Agent Notes record why projects start from session history and why removal is non-destructive.

- [Workspace subsystem](../../../docs/subsystems/workspace.md) — the feature contract for projects and their sessions, and the generated API for the workspace service.
- [Workspace package map](../README.md) — the group's single package and its repository position.
- [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) — why project records use the domain data form.
- [Workspace UI product-flow Agent Note](../../../.agents/notes/archived/feature/2026-07-25-workspace-ui-product-flow.md) — how the first start builds projects from session history and how the GUI orders them.
- [Workspace registration deletion decision](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md) — why removing a project never deletes its folder or sessions.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace records and session accounts

#### What the model sees

Nothing. `ctx.workspaceRegistry` serves workspace records to host-side consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the project list is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Removal never deletes data** — removing a project leaves its folder, files, and session histories in place; those sessions become ungrouped, and session deletion or folder removal are separate, absent capabilities ([decision](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)).
- **A session joins only with a recorded directory** — a session belongs to a project only when its record carries a directory that resolves to the project's path; sessions without one stay ungrouped, and a session from another directory cannot be moved in.
- **Remote access requires its captured binding** — remote creation and status checks require current admission; attachment uses the live Agent's retained lease and therefore survives later target edits, but rejects when that lease or provider is unavailable. Remote operations never use local providers, and startup refuses durable SSH history without `executionBindings`.
- **External changes are seen late** — local directory changes appear at refresh or restart; remote history indexing does not probe the directory.
- **Archiving only changes visibility** — archive and unarchive update the durable display filter without deleting Session history or changing Workspace membership. Unarchiving an absent id succeeds without a write.
- **Re-adding a directory starts fresh** — after removal, adding the same directory again creates a new project with an empty session list; the old sessions do not come back automatically.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

The Session log owns the captured execution event, the execution service owns admission and retained provider leases, and this package owns Workspace identity and membership.

</details>
