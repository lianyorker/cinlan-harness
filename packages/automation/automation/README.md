---
description: "Durable UTC automations and ordinary Agent execution for one local Host profile."
kind: "reference"
---

# Automation

English | [中文](README.zh.md)

## Summary

This package owns recurring definitions, exclusive scheduling, and a durable run journal. It creates ordinary workspace Sessions through the public Agent factory. New definitions are disabled; saving one makes no model request.

## Table of Contents

- [Configuration](#configuration)
- [Scheduling](#scheduling)
- [Execution and recovery](#execution-and-recovery)
- [Persistence](#persistence)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## Configuration

The default export is `AutomationRuntime` at `ctx.automationRuntime`. All configuration fields are required; the Web bundle supplies its explicit deployment policy. Management uses a Host service and Settings API; this package registers no model-facing tools.

| Field | Meaning |
|---|---|
| `profile` | Actual launch profile, matching `ctx.get('dshProfileName')`; no directory or default-profile fallback. |
| `clockCheckIntervalMs` | Positive integer maximum interval between wall-clock checks. |
| `maxStartLatenessMs` | Positive integer admission window after a planned UTC instant. |

Saved inputs include an existing Workspace id and canonical path, Agent preset id, model provider/id and optional reasoning effort, permission preset id with resolved sandbox/approval values, prompt, and schedule. The editor copies current defaults into explicit values. Future default changes do not rewrite tasks. A preset id uses its current on-disk composition, not a frozen file.

<a id="scheduling"></a>
## Scheduling

Schedules are hourly at a chosen minute, daily at a chosen UTC hour/minute, or weekly on selected weekdays at a chosen UTC hour/minute. Pinned `cron-parser` expands explicit UTC instants. Custom cron, RRULE, local-wall-clock rules, and remote routing are not accepted.

Daylight-saving transitions affect local display only. Daily and weekly tasks keep their UTC time; two hourly occurrences may display the same local clock time with different offsets. Timers recheck the wall clock and never rewind the saved cursor.

Boot, re-enable, and schedule edits skip missed time and select a future UTC instant. During uptime, occurrences beyond the configured admission window are skipped. Missed time becomes neither a queue nor fictional completed history. An active invocation causes a scheduled occurrence to record `skipped-overlap`; manual Run returns busy.

Manual Run works while disabled without enabling or moving recurrence. Its request token deduplicates retries across restart. Pause stops future admission without cancelling current work. Cancel uses ordinary Agent cancellation and waits for teardown. Deleting an inactive task retains its journal; an active task cannot be deleted.

<a id="execution-and-recovery"></a>
## Execution and recovery

One SQLite transaction commits immutable inputs, preallocated Session/message ids, the occurrence claim, and the next cursor before `agents.create`. Unpublished setup mounts the public Agent preset, rechecks workspace/authority, and applies pinned permission/model choices. The Workspace service attaches the Session; `followup` admits a logged plugin-origin prompt. Ordinary Agent approvals, questions, tools and sandbox behavior apply. Automation does not mark workspaces trusted or grant additional authority.

| State | Recorded evidence |
|---|---|
| `starting` | Claim committed; prompt execution not confirmed. |
| `running` / `stopping` | Agent prepared for the prompt, or cancellation in progress. |
| `completed` / `failed` / `cancelled` | Exact prompt turn ended and flushed, or a definite pre-dispatch failure; reason distinguishes outcomes. |
| `skipped-overlap` | Scheduled occurrence skipped because another invocation was active. |
| `interrupted` / `ambiguous` | No conclusive execution/completion evidence; effects can be unknown. |

The runtime correlates its message id through `agent/inbox/claimed` and reads that turn's `turn/end`. Idle alone proves no outcome. It flushes the Session and disposes the Agent before publishing a terminal result. Remaining Agent-owned work is cancelled and drained; the persisted transcript remains readable. Later human turns do not rewrite the outcome.

After a crash or an incomplete final flush during Host teardown, read-only Session evidence may settle a known outcome. Otherwise unfinished starting work becomes ambiguous and unfinished running/stopping work becomes interrupted; the definition is paused for review. No occurrence automatically resumes or replays. An explicit new Run is a new invocation.

<a id="persistence"></a>
## Persistence

State lives under canonical Harness home at `automations/<profile>/state.sqlite3`, with separate `owner.sqlite3` in the same private directory. Identity is canonical home plus actual profile, independent of install and Desktop staging paths. The schema uses a monotonic version and rejects a different recorded scope.

The owner holds `BEGIN IMMEDIATE` for its lifetime with zero busy timeout. A second process reports unavailable and performs no recovery or dispatch. Only SQLite busy means contention; other failures are errors. Never expire, steal, replace or delete the owner file. Shutdown drains work before releasing the transaction; process death releases the OS lock. Data writes use a separate database.

Unique indexes protect scheduled UTC occurrences, manual tokens and active-run exclusion. Failed commits never dispatch an Agent. Snapshot notifications follow commit. The journal is paginated and retained after deletion. No invariant companion is published: mutation-time SQLite constraints enforce these records, and claimed but unpublished work is explicitly recoverable. Independent-process tests prove contention and crash release rather than checking process-local service presence.

<a id="model-experience"></a>
## Model Experience

### Context Injection

#### What the model sees

The saved `AutomationSpec.prompt` enters a new Session unchanged as a logged `user` message with plugin `automation` provenance and the `notice` form. Its summary identifies the task. Automation adds no hidden prompt or new Session format.

#### Token effect

Each invocation adds the saved prompt to its new Session. Its text and any provider-rendered notice metadata contribute to input tokens and remain in that Session history.

#### KV Cache effect

Each invocation creates an independent Session; the configured Agent composition owns its request prefix. Automation does not rewrite earlier messages in that Session. Changed prompt text changes its user-message tokens, while preset or model changes can change the reusable prefix or provider route; cache availability remains provider-owned.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

A local Host must remain running. This package does not launch an OS daemon, wake a sleeping computer, route remotely, reuse Sessions, queue overlaps or catch up missed work. Local-time rules, retention controls and automation-specific notification preferences are not implemented.

Workspace records currently have per-process caches across Harness home. Exact Workspace/Session ids in the journal identify each invocation; unrelated concurrent Host workspace writes are not made transactional here. SQLite ownership requires a supported local filesystem with working OS locks. Completion describes the recorded Agent turn, not independent verification of the business objective.
