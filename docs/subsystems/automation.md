# Automation

English | [中文](automation.zh.md)

Durable local automations create fresh Agent Sessions from explicit saved inputs. The [runtime](../../packages/automation/automation/README.md) owns scheduling and persistence, the [controller](../../packages/api/automation-controller/README.md) owns Remote commands and browser state, and the [settings page](../../packages/client/ui-settings-automation/README.md) owns human interaction.

## Identity and definitions

An AutomationId belongs to one canonical Harness home and launch profile. An AutomationRunId identifies one invocation; the resulting Session has its own SessionId. A manual request token makes repeated admission idempotent. Saved definitions capture a Workspace id and canonical path, Agent preset id, model selection, resolved permission values, prompt, and schedule. Changing defaults does not rewrite definitions. A preset id refers to its current composition.

## Scheduling semantics

Schedules use minute-precision UTC hourly, daily, or weekly rules. Creation is disabled. Enabling admits future occurrences within the configured lateness window; missed occurrences are skipped. Clock rollback cannot rewind the committed cursor. Each occurrence is claimed before Agent creation, with the frozen invocation inputs and next cursor committed together. Active overlap is recorded as skipped; manual overlap is refused. Manual Run can execute a disabled definition without moving its schedule cursor.

## State and recovery

One process holds the profile's SQLite ownership transaction. The journal and definitions use a separate database so writes continue while ownership is held. A competing process exposes unavailable state and performs no recovery or dispatch. A failed or uncertain commit cannot create an Agent or publish a successful mutation.

Shutdown stops admission and joins active work before releasing ownership. Recovery records unresolved starting work as ambiguous and interrupted live work as interrupted, pauses affected definitions for review, and never replays them. Completion records the observed Agent result; it is not an independent check of task success. The runtime README defines locking, cancellation, retention, and filesystem limits.

## Browser commands

The automation Remote namespace supplies snapshots, selector metadata, create/update/delete, manual run/cancel, paginated history, and schedule preview. Its stream publishes full committed state through the existing authenticated Connection. Commands carry explicit revisions or idempotency tokens where required; the Client service retains errors and does not replace failed reads with an empty history. Browser components receive plain callbacks and framework-owned observable hooks.

## Type reference

Source: [`packages/automation/automation/src/types.ts`](../../packages/automation/automation/src/types.ts). All saved timestamps are Unix milliseconds; nullable evidence fields remain `null` until that evidence exists.

### Saved inputs

The draft contains explicit editor choices. The Host resolves workspace identity and permission values before persisting the spec.

| Type | Fields and meaning |
|---|---|
| `AutomationId` | Branded durable definition id within one launch profile. |
| `AutomationRunId` | Branded journal invocation id, independent of `SessionId`. |
| `AutomationRequestId` | Branded client retry token for manual admission. Reusing it for the same automation returns the existing receipt; using it for another automation conflicts. |
| `AutomationModelSelection` | `provider`, `model`, and optional `reasoningEffort`; saved independently of the current interactive selection. |
| `AutomationPermission` | Resolved `sandbox` (`read-only`, `workspace-write`, or `danger-full-access`) and `approval` (`ask` or `never`). A new explicit save is required to change these values. |
| `AutomationDraft` | `title`, `prompt`, `workspaceId`, `agentPresetId`, `model`, `permissionPresetId`, and `schedule`. Creation accepts no `enabled` field. |
| `AutomationSpec` | The complete draft plus Host-resolved `workspacePath` and `permission`; each admitted run retains its own copy. |

`AutomationSchedule` is a closed union selected by `kind`; the [input schema](../../packages/automation/automation/src/schema.ts) rejects extra fields.

| `kind` | Required fields |
|---|---|
| `hourly` | `minute`, an integer from 0 through 59. |
| `daily` | `hour` from 0 through 23, and `minute`. |
| `weekly` | `hour`, `minute`, and `weekdays`: one through seven distinct integers from 0 through 6, with Sunday = 0. |

### Definitions and invocation evidence

`AutomationDefinition` combines the saved plan with its revision and scheduling state. Definition edits do not replace an active run’s admitted inputs.

| Fields | Meaning |
|---|---|
| `id`, `revision`, `scheduleRevision` | Definition identity, optimistic edit revision, and schedule generation. `scheduleRevision` advances when the schedule changes. |
| `spec`, `enabled`, `needsReview` | Resolved inputs, scheduling switch, and recovery review flag. |
| `nextPlannedAt` | Forward-only occurrence cursor, or `null`. |
| `createdAt`, `updatedAt`, `deletedAt` | Creation, latest update, and nullable deletion timestamps. Deletion retains the invocation journal. |

`AutomationRun` retains the admitted spec and records only observed execution evidence.

| Fields | Meaning |
|---|---|
| `id`, `automationId`, `definitionRevision`, `scheduleRevision`, `spec` | Invocation identity and the exact saved definition generation and inputs it admitted. |
| `trigger`, `requestId`, `plannedAt` | `scheduled` or `manual`, nullable manual retry token, and admitted occurrence time. |
| `sessionId`, `messageId`, `turn` | Nullable links to the created Session, input message, and observed turn. |
| `status`, `reason` | `AutomationRunStatus` and a nullable explanation. |
| `createdAt`, `updatedAt`, `finishedAt` | Journal timestamps; `finishedAt` is nullable until termination. |

`AutomationRunStatus` is `starting`, `running`, `stopping`, `completed`, `failed`, `cancelled`, `skipped-overlap`, `interrupted`, or `ambiguous`. The first three describe live work. `skipped-overlap` records a scheduled occurrence refused for overlap; `interrupted` and `ambiguous` require review without automatic retry.

### Reads and commands

The [runtime](../../packages/automation/automation/src/index.ts) publishes committed snapshots and requires the caller’s observed revision for edits and manual admission.

| Type | Fields and meaning |
|---|---|
| `AutomationSnapshot` | `status: ready` carries `profile`, collection `revision`, `definitions`, and `activeRuns`. `status: unavailable` carries `profile` and `reason`: `owned`, `storage`, or `closing`. Unavailability is distinct from an empty ready collection. |
| `AutomationUpdate` | `id`, `expectedRevision`, complete replacement `draft`, and explicit `enabled`; not a sparse patch. |
| `AutomationDelete` | `id` and `expectedRevision`; deletion refuses an active invocation. |
| `AutomationRunRequest` | `id`, `expectedRevision`, and stable `requestId`; manual admission returns a durable receipt. |
| `AutomationRunPage` | Newest-first `runs` and nullable `nextCursor`; journal reads accept limits from 1 through 100. |
| `AutomationErrorCode` | `unavailable`, `not-found`, `conflict`, `invalid`, `busy`, `resource`, or `storage`; stable classifications exclude credential and provider response content. |
| `AutomationConfig` | Actual launch `profile`, positive safe-integer `clockCheckIntervalMs`, and `maxStartLatenessMs`; timing and storage identity do not depend on process cwd. |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomationruntime--automationruntime"></a>

### `ctx.automationRuntime` — `AutomationRuntime`

Concrete same-Host automation owner, with no remote routing or replay queue.

```ts cordis-catalog
/** Current committed state; object identity changes only with publication.
 * @returns the most recently committed view or explicit availability state.
 */
snapshot(): AutomationSnapshot

/** Subscribe to committed snapshots.
 * @param listener - observer whose failure does not undo a durable operation.
 * @returns the subscription disposer.
 */
subscribe(listener: (snapshot: AutomationSnapshot) => void): () => void

/** Resolve and save a new disabled automation.
 * @param draft - explicit user choices; defaults are resolved by the editor.
 * @returns the committed definition.
 */
async create(draft: AutomationDraft): Promise<AutomationDefinition>

/** Save a complete revision-fenced draft with explicit enable/pause behavior.
 * @param request - edited revision, explicit values, and intended enable state.
 * @returns the committed replacement; active runs keep their immutable inputs.
 */
async update(request: AutomationUpdate): Promise<AutomationDefinition>

/** Remove an inactive plan while retaining its journal.
 * @param request - exact identity and edited revision.
 */
delete(request: AutomationDelete): Promise<void>

/** Admit an explicit manual run without enabling or moving recurrence.
 * @param request - exact definition revision and stable retry token.
 * @returns an already durable invocation receipt.
 */
async run(request: AutomationRunRequest): Promise<AutomationRun>

/** Request real cancellation of this runtime's invocation.
 * @param id - durable run identity.
 */
async cancel(id: AutomationRunId): Promise<void>

/** Read a bounded newest-first journal page.
 * @param id - task identity.
 * @param cursor - previous page cursor, or null.
 * @param limit - record count, 1 through 100.
 * @returns recorded invocations, never synthetic history.
 */
runs(id: AutomationId, cursor: AutomationRunId | null, limit: number): AutomationRunPage

/** Preview five future UTC occurrences without saving or dispatching.
 * @param schedule - proposed minute schedule.
 * @param afterUtc - absolute epoch milliseconds.
 * @returns five strictly future UTC instants.
 */
previewSchedule(schedule: AutomationSchedule, afterUtc: number): number[]
```

Source: [`packages/automation/automation/src/index.ts`](../../packages/automation/automation/src/index.ts)
<!-- END GENERATED cordis-surface -->
