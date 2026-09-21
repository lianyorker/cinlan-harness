# Workspaces

English | [中文](workspace.zh.md)

A workspace is the persistent record of a directory the user works in: a stable id over a canonical path, a display title, and the ordered account of sessions that belong to it. The registry lives in [dsh-workspace](../../packages/workspace/workspace) (`ctx.workspaceRegistry`) — an optional host-side capability, not part of the agent-loop spine, and invisible to models (no tools, no prompt text, no session events). It stores its records through the [storage domain form](storage.md) and validates session membership against [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log), so `storageDomain` and `sessionPersistence` are mandatory startup dependencies: an unavailable persistence peer leaves the plugin pending rather than being mistaken for an empty history. Design record: [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md); bootstrap and GUI ordering: [Workspace UI product-flow Agent Note](../../.agents/notes/archived/feature/2026-07-25-workspace-ui-product-flow.md).

Workspace-file previews also use the [Office conversion service](../../packages/document/office-to-pdf/README.md), `ctx.officeToPdf`. It converts authorized Office sources to bounded, cached PDF results without changing source files. The [Workspace Files service](../../packages/api/workspace-files/README.md) owns local Session authorization before conversion or cache access; the converter owns queued work, cancellation and result bytes. The package README defines its API, limits and native-engine requirements.

Source: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## Identity

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` is a [branded id](core.md#branded-ids). Path identity is separate: `realpathNormalize` (`fs.realpath`; trailing slashes, `..`, and symlinks resolved) is the one uniqueness canon — workspace paths are stored canonicalized, uniqueness is string equality of canonical paths (a symlink to an owned directory collides), and attach-time session cwd checks go through the same canon.

## The workspace entity

Consumers see only the `Workspace` interface; the implementation stays package-private.

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path in the captured execution filesystem; local
   * realpath or the remote lease resolves symlinks at creation. Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Captured execution selection; configured SSH root remains distinct from the canonical path. */
  readonly execution: ExecutionBinding

  /** Display title. Defaults to the final path segment, or a filesystem root's own spelling; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * execution binding differences, and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * published execution lease (or durable local fallback when the optional
   * service is absent) must match, and its provider must verify a cwd equal to
   * {@link path}; unknown ids, missing or invalid cwd values, and mismatches
   * reject without writing. The lease is released after validation.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * Remote checks acquire and release the captured execution binding; attachment
   * instead retains the published Session lease through provider verification.
   * An unavailable service, target, or connection rejects without a local fallback.
   * @returns `'ok'` for a directory, `'missing-dir'` when a successful lease's
   * filesystem reports absence/non-directory or a local stat fails. Lease admission failures reject.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

Ownership truth is the record's ordered `sessionIds`, never derived from session cwd — but membership requires both: an id on the account and a header whose canonical cwd equals the workspace path, so one session structurally belongs to at most one workspace. Failed writes reject (`insertSessionBefore` account errors as `WorkspaceMoveInvalidError`, storage failures as plain errors); every accepted mutation stamps `updatedAt` and durably prunes candidates that no longer pass the membership check.

## The registry: `ctx.workspaceRegistry`

`WorkspaceRegistry` ([signatures](#ctxworkspaceregistry--workspaceregistry)) owns registration and resolution. `create(path, title?)` requires a fully qualified path, canonicalizes it, rejects a nonexistent path (the original `ENOENT`) or a non-directory, returns the existing entity unchanged when the canonical path is already owned, and otherwise creates a record with `title ?? defaultWorkspaceTitle(path)` prepended to the durable registry order (different canonical paths may share a display title, and a path with no final segment uses its root spelling). `get(id)` and the ordered `list()` are synchronous cache reads; `resolveByPath(path)` applies the same fully qualified realpath canon without creating. `delete(id)` removes only the registration, order entry, and session account — the directory, user files, live sessions, and persisted logs are never touched, so those sessions become Ungrouped ([decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)); unknown ids return `false`. Create and delete persist a pending-mutation marker before their two writes (record + order) can diverge; startup resolves exactly the marked mutation — by deleting the marked table row, which completes an interrupted delete and rolls back an interrupted create (the registration is re-creatable, so rollback is the safe direction) — and an unmarked order/table mismatch fails loud as corruption.

Sessions get their cwd at create time from whoever creates them, not from this registry — the API gateway resolves a new session's cwd from the chosen workspace's `path` (falling back to an explicit or default cwd), creates the session so the cwd lands in its immutable [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log), then calls `attachSession`, which re-validates that stored header cwd against the workspace path. On the first successful start, the registry bootstraps history from persisted headers alone (`id`, `cwd`, `createdAt` — never event bodies), grouping sessions with a valid canonical cwd into per-directory workspaces, newest first; the initialized marker is written last so an interrupted bootstrap resumes safely. The bootstrap is one-time: cwd-less legacy sessions stay Ungrouped, and sessions created afterwards join a workspace only through `attachSession`.

## Consumers

[`dsh-workspace-controller`](../../packages/api/workspace-controller) serves workspace CRUD to GUI clients over `ctx.workspaceRegistry`, and [`dsh-session-controller`](../../packages/api/session-controller) performs the create-session-then-attach flow above. [dsh-agent-instructions](../../packages/context/agent-instructions) is **not** a consumer despite the name: it discovers AGENTS.md-style instruction files under an agent's own cwd and never touches `ctx.workspaceRegistry` — the shared word refers to the user's working directory, not to this registry's entities.

## Isolation leases

`WorkspaceIsolation` at `ctx.workspaceIsolation` manages one isolation lease per Session. Providers choose checkout paths and accept cleanup by lease id. The branded `WorkspaceIsolationLeaseId` and `WorkspaceIsolationLease` snapshot are declared in [`workspace-isolation/src/types.ts`](../../packages/workspace/workspace-isolation/src/types.ts). API consumers reuse these domain values; [service operations](../../packages/workspace/workspace-isolation/src/index.ts) use the same identity.

| `WorkspaceIsolationLease` fields | Meaning |
|---|---|
| `id`, `sessionId` | Provider-issued lease identity and the Session that exclusively owns it. |
| `sourcePath`, `checkoutPath` | Canonical registered Workspace directory and the Session cwd inside the managed worktree. |
| `branch` | Provider-owned branch retained when the checkout directory is reclaimed. |
| `phase` | `WorkspaceIsolationPhase`: `active` or `hibernated`; hibernation retains the branch without its directory. |
| `reviewState` | `WorkspaceIsolationReviewState`: `none` or `branch-retained`, the durable marker for unmerged work retained by teardown. |
| `baseBranch`, `baseHead` | Source branch name and creation commit. |
| `head` | Latest checkpoint commit known to the provider. |
| `createdAt`, `updatedAt` | ISO-8601 creation time and latest successful lifecycle transition. |

`EnsureWorkspaceIsolationRequest` carries `sessionId`, the registered `sourcePath`, and optional `signal` for provider work. `ensure` returns an active lease; `acquire` also returns a `WorkspaceIsolationReservation` with `lease` and an idempotent `release()` callback. The reservation protects that lease from hibernation, teardown, and capacity reclamation until the consumer stops its work and releases protection.

For a managed Session, the registry resolves the exact header `(sessionId, cwd)` through `workspaceIsolation.sourceFor` before its canonical membership check. An owned checkout maps to the registered source directory; an unrelated path returns `undefined`. The immutable Session cwd remains the checkout path.

### Inspection and comparison

Inspection reports live checkout state separately from the persisted lease phase. Review results distinguish divergence against the current base branch from changes since the lease was created.

| Type | Fields and semantics |
|---|---|
| `WorkspaceIsolationCheckoutState` | `absent`, `clean`, or `dirty`, describing current checkout availability and cleanliness. |
| `WorkspaceIsolationFileChange` | `kind`, repository-relative `path`, and optional `previousPath` for a rename or copy. |
| `WorkspaceIsolationFileChangeKind` | `added`, `modified`, `deleted`, `renamed`, `copied`, `type-changed`, `unmerged`, `untracked`, or `other`. |
| `WorkspaceIsolationInspection` | Detached `lease`, `checkoutState`, current `branchHead`, active `workingTreeChanges`, and `hasUntrackedFiles`. Inspection does not mutate the lease. |
| `WorkspaceIsolationCommit` | Commit `id` and first-line message `summary`. |

`WorkspaceIsolationComparison` contains a detached `lease` and the following review fields:

| Fields | Comparison meaning |
|---|---|
| `targetHead`, `branchHead` | Current base-branch and managed-branch commits. |
| `ahead`, `behind` | Managed commits absent from the current base branch, and base commits absent from the managed branch. |
| `commits` | `WorkspaceIsolationCommit` values after `baseHead`, oldest first. |
| `changedFiles` | `WorkspaceIsolationFileChange` values from the comparison, plus active untracked paths. |
| `patch`, `patchTruncated` | Patch against the creation commit `baseHead`, and whether it exceeded the provider output limit. |
| `includesWorkingTree`, `hasUntrackedFiles` | Whether tracked active-checkout content is included, and whether untracked files exist whose contents are omitted from the patch. |

`WorkspaceIsolationPatch` contains `leaseId`, a safe suggested `fileName`, bounded complete patch `content`, `includesWorkingTree`, and `hasUntrackedFiles`. The Git provider rejects export when the comparison patch is truncated; the untracked-files flag still reports omitted content. `WorkspaceIsolationIntegrationResult` contains the hibernated `lease`, receiving `targetBranch`, and resulting `targetHead` after merge or cherry-pick into the clean source checkout.

### Safe teardown and failures

`WorkspaceIsolationTeardownResult` distinguishes confirmed removal from retained work. Teardown accepts only a provider-issued lease identity.

| `status` | Fields and result |
|---|---|
| `removed` | `leaseId`; the checkout, branch, and durable lease were removed. |
| `review` | Hibernated `lease` and `reason: 'unmerged-branch'`; the checkout was reclaimed while the branch and durable lease remain for review. |

`WorkspaceIsolationError` carries a `WorkspaceIsolationErrorCode`: `UNAVAILABLE`, `NOT_REPOSITORY`, `SOURCE_DIRTY`, `LEASE_CONFLICT`, `LEASE_BUSY`, `CAPACITY`, or `COMMAND_FAILED`. In the [Git provider](../../packages/workspace/workspace-isolation-git/README.md), a live owning Agent or reservation keeps the lease busy; teardown retains an unmerged branch with `reviewState: 'branch-retained'`.

`GitWorkspaceIsolationRecord`, declared in the [provider record schema](../../packages/workspace/workspace-isolation-git/src/spec.ts), stores the lease fields plus `repositoryPath` and the whole-worktree `checkoutRoot`. The durable `leases` table is keyed by Session id, while public cleanup still uses the branded lease id.

## Worktree Tasks

`WorktreeTaskService` at `ctx.worktreeTask` manages named tasks with a dedicated branch, checkout, and bound Sessions. [`worktree-task/src/types.ts`](../../packages/workspace/worktree-task/src/types.ts) declares `WorktreeTaskId`, `WorktreeTaskStatus`, `WorktreeTask`, and the request/result types below; the [service definition](../../packages/workspace/worktree-task/src/index.ts) declares operations and failures.

| `WorktreeTask` fields | Meaning |
|---|---|
| `id`, `name` | Branded `WorktreeTaskId` and task display name. |
| `workspaceId`, `sourcePath` | Associated Workspace identity and source directory. |
| `baseRef`, `branch`, `checkoutPath` | Creation ref, managed task branch, and checkout directory available to bound Sessions. |
| `status` | `WorktreeTaskStatus`: `active` has a checkout; `hibernated` retains the branch without its checkout; `archived` has reclaimed its checkout and permits review and safe deletion. |
| `cleanupReceipt` | Optional durable cleanup claim or settlement; an unsettled claim prevents mutation, and successful cleanup prevents renewed Session work. |
| `linkedIssue` | Optional linked issue URL. |
| `sessionIds` | Sessions bound to the task. |
| `createdAt`, `updatedAt` | Creation and latest mutation timestamps. |

| Type | Fields and semantics |
|---|---|
| `CreateTaskRequest` | `name`, `workspaceId`, `sourcePath`, optional `baseRef`, and optional `linkedIssue`; creates an active task. |
| `ActivateTaskRequest` | `taskId`; restore the task checkout. |
| `HibernateTaskRequest` | `taskId`; reclaim the checkout while retaining the branch, without cleanup execution. |
| `ArchiveTaskRequest` | `taskId`; run captured cleanup, checkpoint, and reclaim the checkout. |
| `DeleteTaskRequest` | `taskId`; archive through cleanup, then request safe branch removal. |
| `BindSessionRequest` | `taskId` and `sessionId`; bind a Session to the task checkout. |
| `BindSessionResult` | Updated `task` and the `checkoutPath` granted to the Session. |
| `DeleteTaskResult` | `deleted`, optional `retainedBranch`, and optional `cleanupReceipt`; an unmerged branch returns `deleted: false` and remains archived and reviewable. |
| `WorktreeTaskHook` | Executable and separate literal `args`; shell interpretation requires an explicitly selected shell. |
| `WorktreeTaskDefaults` | Relative `defaultDirectory`, `baseRef`, and nullable `setup`/`cleanup` programs for future tasks. |
| `WorktreeTaskSettings` | Defaults `value`, current `revision`, and deployment-owned `managedRoot`. |
| `UpdateWorktreeTaskSettingsRequest` | Complete defaults `value` and `expectedRevision`; stale writes reject without running programs. |
| `WorktreeTaskReview` | `taskId`, `baseHead`, `head`, `checkoutRoot`, `dirty`, tracked `patch`, untracked names, captured programs, and optional `cleanupReceipt`; bounded read without activation. |
| `WorktreeTaskCleanupReceipt` | Captured `hook`, requested `operation` (`archive` or `delete`), `startedAt`, and `status`; only settled `succeeded`/`failed` receipts include `finishedAt`, while `running` also represents an unknown outcome. |

Bound Sessions prevent hibernation, archival, and deletion. `WorktreeTaskError` carries `code`, `message`, and optional `context`; its `WorktreeTaskErrorCode` is `unavailable`, `not-found`, `busy`, `conflict`, `invalid-workspace`, `invalid-path`, `git-failed`, or `operation-failed`. An unknown task lookup rejects rather than returning an empty task.

`GitWorktreeTaskRecord`, declared in the [Git task record schema](../../packages/workspace/worktree-task-git/src/spec.ts), stores task fields plus `repositoryPath`, `checkoutRoot`, `baseBranch`, `baseHead`, checkpoint `head`, and optional captured `launch` defaults. The durable `tasks` and separate `cleanup_receipts` tables are keyed by task id; receipts survive deletion of the task record. The [Git task provider](../../packages/workspace/worktree-task-git/README.md) owns execution, settlement, checkout, and branch lifecycle details.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxdirectorypickercontroller--directorypickercontroller"></a>

### `ctx.directoryPickerController` — `DirectoryPickerController`

Host service backing the generated `ctx.remote.directoryPicker` namespace. The seam it exports is abstract and therefore never a Loader entry of its own, so this controller carries the wire verbs: one composed backend serves either the native chooser or the browse primitives, and a verb the composition cannot serve is refused rather than approximated.

```ts cordis-catalog
/**
 * Open the host's OS chooser for a Remote caller.
 * @param signal - caller lifetime; abort terminates the chooser.
 * @returns the chosen absolute path, or null when the operator cancels.
 */
@Remote('pick') async pick(signal: AbortSignal): Promise<string | null>

/**
 * List one directory level for a Remote caller's in-app browser.
 * @param path - absolute directory to list; absent lists the home directory.
 * @param signal - caller lifetime; abort stops the backend's scan instead of
 *   letting it outlive a disconnected caller.
 * @returns the level's listing with its ancestry.
 */
@Remote('list') async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing>

/**
 * Create one child directory for a Remote caller's in-app browser.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment.
 * @returns the created directory's absolute path.
 */
@Remote('createDirectory') async createDirectory(path: string, name: string): Promise<string>
```

Source: [`packages/api/workspace-controller/src/directory-picker.ts`](../../packages/api/workspace-controller/src/directory-picker.ts)

<a id="ctxofficetopdf--officetopdf"></a>

### `ctx.officeToPdf` — `OfficeToPdf`

A provider lifetime owns all converters, queued calls, and temporary files.

```ts cordis-catalog
/**
 * Convert Office bytes without modifying the source or writing Session events.
 * @param request - authorized metadata and deferred bounded source read.
 * @param signal - caller cancellation; provider disposal also stops active work.
 * @returns caller-owned PDF bytes after conversion and scratch cleanup settle; canceled readers reject independently.
 * @throws {OfficeToPdfError} Invalid input, unusable output, or engine failure; cancellation rejects with its reason.
 */
convert(request: OfficeToPdfRequest, signal?: AbortSignal): Promise<OfficeToPdfResult>

/**
 * Read and convert one Office file using the Session's ordinary filesystem authorization.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - absolute or workspace-relative Office path.
 * @param priority - foreground preview or speculative background work.
 * @param signal - Remote cancellation; disposal also cancels outstanding reads and conversions.
 * @returns complete base64 PDF with original source identity and missing font families.
 */
@Remote async render( agent: Agent, path: string, priority: OfficeToPdfPriority, signal: AbortSignal, ): Promise<RenderedDocumentBytes>

/**
 * Read the current rendering generation before reusing a Client PDF.
 * @param signal - Remote caller cancellation.
 * @returns provider lifetime, replaced with rendering, font, or engine configuration.
 */
@Remote('generation') getGeneration(signal: AbortSignal): OfficeToPdfGeneration
```

Types: [Agent](core.md) · [OfficeToPdfGeneration](../../packages/document/office-to-pdf/README.md#use-this-package) · [OfficeToPdfPriority](../../packages/document/office-to-pdf/README.md#use-this-package) · [OfficeToPdfRequest](../../packages/document/office-to-pdf/README.md#use-this-package) · [OfficeToPdfResult](../../packages/document/office-to-pdf/README.md#use-this-package) · [RenderedDocumentBytes](../../packages/document/office-to-pdf/README.md#use-this-package)

Source: [`packages/document/office-to-pdf/src/index.ts`](../../packages/document/office-to-pdf/src/index.ts)

<a id="ctxworkspacecontroller--workspacecontroller"></a>

### `ctx.workspaceController` — `WorkspaceController`

Host service backing the generated `ctx.remote.workspace` namespace.

```ts cordis-catalog
/**
 * Create or idempotently resolve one Workspace over an existing directory.
 * @param request - directory path to register.
 * @returns the Workspace and whether this call created it.
 */
@Remote('create') create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue>

/**
 * Rename one Workspace to a unique non-blank title.
 * @param request - Workspace identity and proposed title.
 * @returns the updated Workspace projection.
 */
@Remote('rename') rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue>

/**
 * Remove one Workspace registration while retaining files and Sessions.
 * @param request - Workspace identity to remove.
 * @returns deletion confirmation.
 */
@Remote('delete') delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue>

/**
 * Move one Workspace within the registry display order.
 * @param request - moved Workspace and optional anchor.
 * @returns the complete resulting Workspace order.
 */
@Remote('insertBefore') insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue>

/**
 * Move one accounted Session within a Workspace.
 * @param request - Workspace, Session, and optional anchor identities.
 * @returns the updated Workspace projection.
 */
@Remote('insertSessionBefore') insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue>

/**
 * Hide one known Session from Workspace grouping surfaces.
 * @param request - Session identity to archive.
 * @returns the complete resulting archive set.
 */
@Remote('archiveSession') archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Restore one archived Session to Workspace grouping surfaces.
 * @param request - Session identity to unarchive.
 * @returns the complete resulting archive set.
 */
@Remote('unarchiveSession') unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Stream a complete Workspace baseline followed by ordered increments.
 * @param signal - generation cancellation.
 * @returns baseline followed by ordered Workspace increments.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame>
```

Types: [WorkspaceUnarchiveSessionRequest](../../packages/api/workspace-controller/README.md#use-this-package)

Source: [`packages/api/workspace-controller/src/index.ts`](../../packages/api/workspace-controller/src/index.ts)

<a id="ctxworkspacefiles--workspacefiles"></a>

### `ctx.workspaceFiles` — `WorkspaceFiles`

Host Remote service over the composed filesystem, confined to one workspace.

```ts cordis-catalog
/**
 * Read one page of lines from a UTF-8 text file inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the line window; omitted fields take the page defaults.
 * @param signal - caller cancellation.
 * @returns the page, the file's version at the stat before it, and whether it reaches the last line.
 */
@Remote async read(agent: Agent, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>

/**
 * Read one byte window of a regular file inside the Agent's workspace: raw
 * bytes, no text decoding and no binary rejection.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the byte window; omitted fields take the window defaults.
 * @param signal - caller cancellation.
 * @returns the window in base64, the file's version and size at the stat before it, and whether it reaches the last byte.
 */
@Remote async readBytes(agent: Agent, path: string, range: WorkspaceByteRange, signal: AbortSignal): Promise<WorkspaceFileBytes>

/**
 * Report one regular file's identity, version, and size without its content.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the file's absolute path, current version, and byte size.
 */
@Remote async stat(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFileStat>

/**
 * List the direct children of one directory inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the directory's children in the backend's stable name order, bounded by the entry cap.
 */
@Remote async list(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>

/**
 * Stream every `fs/observed` observation of a file inside the Agent's
 * workspace. Only Agent filesystem operations report here; the OS is not
 * watched.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param signal - generation cancellation.
 * @returns `ready` once the Host observation queue is active and the workspace
 *   root is resolved, then queued and live observations in emission order.
 */
@Remote({ mode: 'stream' }) async *changes(agent: Agent, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
```

Types: [Agent](core.md)

Source: [`packages/api/workspace-files/src/index.ts`](../../packages/api/workspace-files/src/index.ts)

<a id="ctxworkspaceisolation--workspaceisolation-abstract-seam"></a>

### `ctx.workspaceIsolation` — `WorkspaceIsolation` (abstract seam)

Provider-neutral lease service. Providers alone choose checkout paths and accept cleanup by lease id; Consumers cannot submit a deletion path.

```ts cordis-catalog
/**
 * Create or reactivate the Session's lease.
 * @param request - Session identity, registered source directory, and cancellation.
 * @returns the active lease whose checkoutPath is ready for Session use.
 */
abstract ensure(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationLease>

/**
 * Create or reactivate a lease and protect it atomically for an asynchronous consumer.
 * @param request - Lease owner, source directory, and cancellation during acquisition.
 * @returns the active lease and an idempotent release callback; release only after work stops.
 */
abstract acquire(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationReservation>

/**
 * Reactivate an existing lease by provider-issued identity.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns the active lease whose checkoutPath is ready for Session use.
 */
abstract activate( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationLease>

/**
 * Checkpoint one inactive checkout and reclaim its directory while retaining its branch.
 * @param leaseId - Provider-issued lease identity.
 * @returns the hibernated lease after the directory is removed.
 */
abstract hibernate(leaseId: WorkspaceIsolationLeaseId): Promise<WorkspaceIsolationLease>

/**
 * Inspect checkout ownership and working-tree state without changing the lease.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns current checkout and managed-branch state.
 */
abstract inspect( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationInspection>

/**
 * Compare one managed branch and active checkout with its base branch.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns bounded commits, changed paths, and patch text.
 */
abstract compare( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationComparison>

/**
 * Merge one managed branch into its clean source checkout and hibernate the lease.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns resulting base-branch commit and retained lease.
 */
abstract merge( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationIntegrationResult>

/**
 * Cherry-pick the managed branch's linear commits into its clean source checkout.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns resulting base-branch commit and retained lease.
 */
abstract cherryPick( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationIntegrationResult>

/**
 * Export one complete bounded patch without accepting a browser-supplied path.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns patch content and omission metadata.
 */
abstract exportPatch( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationPatch>

/**
 * Reclaim one managed checkout and delete its branch only after safe integration.
 * @param leaseId - Provider-issued lease identity.
 * @returns removal acknowledgement or a retained branch requiring review.
 */
abstract teardown(leaseId: WorkspaceIsolationLeaseId): Promise<WorkspaceIsolationTeardownResult>

/**
 * Clean up provider-detected orphaned worktrees within the repositories in scope.
 * Providers may limit discovery to repositories represented by durable lease records.
 * @returns the count of orphaned worktrees removed.
 */
abstract pruneOrphans(): Promise<number>

/**
 * Find the lease owned by a Session without filesystem work.
 * @param sessionId - Session identity.
 * @returns the current lease snapshot, or undefined when the Session is shared.
 */
abstract find(sessionId: SessionId): WorkspaceIsolationLease | undefined

/**
 * Verify that an exact Session cwd belongs to its managed lease and return
 * the registered source directory used for Workspace membership.
 * @param sessionId - Session identity from the immutable header.
 * @param cwd - Exact cwd from the same header.
 * @returns the source directory, or undefined for an unrelated path.
 */
abstract sourceFor(sessionId: SessionId, cwd: string): string | undefined

/**
 * List detached snapshots of every provider-owned lease.
 * @returns all current lease snapshots.
 */
abstract list(): readonly WorkspaceIsolationLease[]
```

Types: [SessionId](core.md)

Source: [`packages/workspace/workspace-isolation/src/index.ts`](../../packages/workspace/workspace-isolation/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, folds each durable Session's execution event when the optional execution service is absent, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The fully qualified
 * path is canonicalized in its execution filesystem; a relative, nonexistent, or
 * non-directory path rejects. Repeated calls for the same binding and canonical path
 * return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in a fully qualified path spelling.
 * @param title - Display title used only when a new record is created.
 * @param execution - Captured execution selection; omitted means local. SSH requires executionBindings.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string, execution: ExecutionBinding = { kind: 'local' }): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Unarchive one session durably by dropping it from the registry-global
 * archive set; the accounting slot was never touched, so the session
 * returns to its recorded position. Unarchiving runs no session-existence
 * check because removing an id cannot introduce an unknown one, so an
 * entry whose session is gone still resolves. An id that is not archived
 * resolves without writing.
 * @param sessionId - The session to unarchive.
 * @returns resolution after durability.
 */
unarchiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve a Workspace by execution binding and canonical directory without
 * creating or mutating it. Local paths use realpath; remote paths require
 * a verified directory lease. Missing paths or unavailable execution reject;
 * an existing unowned directory returns `undefined`.
 * @param path - Existing directory path in a fully qualified spelling.
 * @param execution - Captured execution selection; omitted means local.
 * @returns the workspace owning that binding and canonical path, when one exists.
 */
async resolveByPath(path: string, execution: ExecutionBinding = { kind: 'local' }): Promise<Workspace | undefined>
```

Types: [ExecutionBinding](../../packages/execution-host/execution-binding/README.md) · [SessionId](core.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)

<a id="ctxworktreetask--worktreetaskservice-abstract-seam"></a>

### `ctx.worktreeTask` — `WorktreeTaskService` (abstract seam)

Abstract Worktree Task service. Providers create Git worktrees, manage branch lifecycle, bind sessions, and persist task state.

```ts cordis-catalog
/**
 * Create a new task with a dedicated branch and worktree checkout.
 * @param request - Task name, workspace, source path, and optional base ref.
 * @param requestSignal - Cancels queued work and setup; process settlement precedes checkout rollback.
 * @returns The created task in active status.
 * @throws WorktreeTaskError when workspace is invalid or Git operation fails.
 */
abstract create(request: CreateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * List all tasks managed by this provider.
 * @returns All task records.
 */
abstract list(): WorktreeTask[]

/**
 * Get one task by id.
 * @param taskId - Task identifier.
 * @returns The task record.
 * @throws WorktreeTaskError with code 'not-found' when unknown.
 */
abstract get(taskId: WorktreeTaskId): WorktreeTask

/**
 * Read the defaults captured by future task creation.
 * @returns The durable defaults and their revision.
 */
abstract settings(): WorktreeTaskSettings

/**
 * Replace defaults without running hooks or modifying existing task launch facts.
 * @param request - Complete defaults and the revision observed by the editor.
 * @param requestSignal - Cancels queued work before the settings write.
 * @returns the persisted defaults and their new revision.
 */
abstract updateSettings(request: UpdateWorktreeTaskSettingsRequest, requestSignal?: AbortSignal): Promise<WorktreeTaskSettings>

/**
 * Read tracked changes against the captured base and list untracked paths without mutating Git.
 * @param taskId - Provider-issued task identity.
 * @param requestSignal - Cancellation of queued and active read work.
 * @returns the complete review; exceeding the provider's byte bound rejects.
 */
abstract review(taskId: WorktreeTaskId, requestSignal?: AbortSignal): Promise<WorktreeTaskReview>

/**
 * Bind a session to an active task, granting it the checkout path.
 * @param request - Task and session identifiers.
 * @param requestSignal - Cancels queued work before binding the Session.
 * @returns The updated task and checkout path.
 * @throws WorktreeTaskError when task is not active or binding fails.
 */
abstract bindSession(request: BindSessionRequest, requestSignal?: AbortSignal): Promise<BindSessionResult>

/**
 * Unbind a session from a task.
 * @param taskId - Task identifier.
 * @param sessionId - Session identifier.
 * @param requestSignal - Cancels queued work before removing the binding.
 * @returns The updated task.
 * @throws WorktreeTaskError with code 'not-found' when unknown.
 */
abstract unbindSession(taskId: WorktreeTaskId, sessionId: SessionId, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Find the task bound to a session, if any.
 * @param sessionId - Session identifier.
 * @returns The bound task, or undefined.
 */
abstract findForSession(sessionId: SessionId): WorktreeTask | undefined

/**
 * Activate a hibernated task by restoring its worktree.
 * @param request - Task identifier.
 * @param requestSignal - Cancels queued work and checkout restoration.
 * @returns The task in active status.
 * @throws WorktreeTaskError when task is not hibernated or checkout fails.
 */
abstract activate(request: ActivateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Hibernate an active task by removing its worktree while retaining the branch.
 * @param request - Task identifier.
 * @param requestSignal - Cancels queued work and checkpoint commands.
 * @returns The task in hibernated status.
 * @throws WorktreeTaskError with code 'busy' when sessions are bound.
 */
abstract hibernate(request: HibernateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Run captured cleanup, then checkpoint and archive the task. Successful cleanup is never rerun.
 * Failed cleanup retains the checkout; an unsettled durable claim requires manual review before further mutation.
 * @param request - Task identifier; repeating after a settled failure explicitly retries cleanup.
 * @param requestSignal - Cancellation forwarded to queued work and subprocesses; settlement is awaited.
 * @returns The archived task and any cleanup receipt.
 * @throws WorktreeTaskError when sessions are bound, cleanup fails, or its previous outcome is unknown.
 */
abstract archive(request: ArchiveTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Archive through the cleanup lifecycle, then delete only an integrated task branch.
 * Cleanup receipts survive task deletion. An unmerged branch and its archived record remain reviewable.
 * @param request - Task identifier; repeating after a settled failure explicitly retries cleanup.
 * @param requestSignal - Cancellation forwarded to queued work and subprocesses; settlement is awaited.
 * @returns Deletion or retained-branch result and any cleanup receipt.
 * @throws WorktreeTaskError when sessions are bound, cleanup fails, or its previous outcome is unknown.
 */
abstract delete(request: DeleteTaskRequest, requestSignal?: AbortSignal): Promise<DeleteTaskResult>
```

Types: [SessionId](core.md)

Source: [`packages/workspace/worktree-task/src/index.ts`](../../packages/workspace/worktree-task/src/index.ts)
<!-- END GENERATED cordis-surface -->
