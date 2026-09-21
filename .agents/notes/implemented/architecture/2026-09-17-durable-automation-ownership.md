# Agent Note: Durable automations require exclusive local ownership

Status: implemented

English | [中文](2026-09-17-durable-automation-ownership.zh.md)

## Problem

A saved schedule does not establish which process can dispatch it or whether a failed start created an Agent. Multiple Host processes, wall-clock changes, partial persistence, and process death can produce duplicate work if the scheduler equates a due timestamp with permission to run. A settings page also cannot infer success from a stale snapshot after a failed commit.

## Decision

The [automation runtime](../../../../packages/automation/automation/README.md) owns durable definitions, invocation claims, and history under the canonical Harness home and actual launch profile. A separate SQLite owner database holds one lifetime transaction with zero busy timeout. A second process reports unavailable and performs no recovery or dispatch. State writes use another database. Ownership remains held through shutdown drain.

An accepted occurrence commits its unique identity, frozen execution inputs, and cursor before public Agent creation. Commit failures latch storage-unavailable state, so removing an external fault does not silently resume uncertain admission. Explicit manual tokens make admission idempotent; scheduled and manual overlaps have separate visible outcomes. UTC recurrence has no startup catch-up, and a committed cursor never moves backwards.

Each run creates an ordinary Agent Session with explicit Workspace, model, Agent preset, and permission inputs. Workspace execution identity is checked before Host path access and again at publication; an SSH path that happens to exist locally cannot authorize Host execution. When the profile provides execution bindings, setup records an explicit local selection and includes its finalizer in the Agent publication commit. Profiles without that service retain ordinary local setup. Setup completes before publication, and the task enters the normal logged user-message path. Defaults do not substitute missing saved references. A preset id still selects its current file composition. The [controller](../../../../packages/api/automation-controller/README.md) and [page](../../../../packages/client/ui-settings-automation/README.md) expose committed state through the existing Remote and framework observation mechanisms.

Recovery does not replay work whose start or outcome is uncertain. It records ambiguous or interrupted evidence, pauses the definition for human review, and retains the invocation history. Full Host shutdown may detach persistence before a normal ending is durable; that state is recorded as interrupted rather than invented cancellation or success. The runtime uses positive flush participation and durable Session evidence when live state is inconclusive.

This decision complements [Session-local reminders](../feature/2026-08-05-durable-web-schedule.md) and [explicit reminder time zones](../simplification/2026-08-09-explicit-schedule-time-zone.md). Those records still own delivery within an existing Session. Saved automations own separate Agent invocations; neither older decision is superseded.

## Alternatives considered

**Time-based lease expiry and lock stealing.** A paused or overloaded process can remain alive after a lease expires. SQLite process ownership releases on actual process death without allowing another process to guess when the owner stopped.

**Replay unfinished work after restart.** Agent creation and external task effects cannot be made atomic with the scheduler journal. Replaying an uncertain start can duplicate user work. Reviewable recovery preserves that uncertainty.

**Reuse the active Session or inherit current defaults.** Invocation provenance and permissions would depend on unrelated user activity. Explicit saved inputs and a fresh Session make each invocation identifiable.

## Consequences

Scheduling requires a running local Host, a supported local filesystem with working SQLite locks, and one owner per home/profile. UTC hourly, daily, and weekly recurrence covers the implemented editor. OS wake-up, daemon installation, remote dispatch, arbitrary cron, local time zones, catch-up, and history retention controls are outside this implementation. The package README owns configuration and complete limits.

Verification uses independent processes for ownership contention and crash release, real Loader compositions for Agent lifecycle and shutdown, and actual SQLite trigger failure for commit refusal. The failure case proves that no Agent is created, no invocation row is committed, and admission remains stopped until explicit restart. Client and UI tests cover raw committed streams, revision conflicts, operation feedback, and disposal. Assembled browser acceptance remains a separate artifact check.
