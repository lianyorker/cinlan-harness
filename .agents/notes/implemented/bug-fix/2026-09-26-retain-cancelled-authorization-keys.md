# Agent Note: Retain credential keys until cancelled authorization runners settle

Status: implemented

English | [中文](2026-09-26-retain-cancelled-authorization-keys.zh.md)

## Problem

Authorization cancellation used to resolve the caller as `cancelled` and release the per-credential reservation immediately, even when the provider flow ignored its signal and kept running. Account Settings could then delete the local record or start a replacement attempt while the detached runner still held a live `ctx.credentials` capability. A late commit from that runner could recreate a record after successful deletion or overwrite the newer attempt's result.

## Decision

Cancellation has two settlement points. The caller-facing `begin()` promise resolves `{ status: 'cancelled' }` promptly so a Remote stream or page close does not wait for a non-cooperative provider. The authorization service separately retains the key in its running map until the provider's `run()` promise settles. During that interval, `list()` and `describe()` keep `inFlight: true`, another `begin()` returns `ALREADY_IN_FLIGHT`, and consumers such as the Account controller continue to reject local deletion.

`authorization/settled` now fires only after the runner finishes and the key has been released. A late runner rejection is handled and logged at debug level because the caller already received cancellation; the eventual settlement remains `cancelled`. Registry subscribers observe reservation and eventual release, so long-lived surfaces update without treating caller response time as resource quiescence.

This decision partially supersedes only the withdrawal-release choice in [Credential records and authorization flows](../architecture/2026-08-13-credential-records-and-authorization-flows.md). That note's credential ownership, caller-owned interaction, and observed-commit rules remain active. The [Sub2API account authorization decision](../feature/2026-09-25-sub2api-account-authorization.md) applies the retained reservation to local deletion and replacement login.

## Alternatives considered

**Await the runner before resolving cancellation.** This would preserve one settlement point, but a provider that ignores its signal would block the initiating Remote stream, page disposal, or process shutdown path indefinitely. Caller response and key release need separate completion signals.

**Release immediately and reject late writes inside the credentials service.** The credentials service does not own authorization attempts, and flows intentionally write through its ordinary API. Adding hidden attempt generations to every credential mutation would couple the storage seam to one consumer and still require propagating authority through provider libraries.

**Delete any record committed after cancellation.** The service cannot distinguish the cancelled runner's record from a legitimate concurrent writer once the key is released, and local deletion cannot revoke an issuer-side key. Retaining the exclusive key is the enforceable ordering rule.

## Consequences

A provider that never settles after cancellation leaves its credential visibly busy until the runner settles or the process exits. This is preferable to reporting the key free while an authorized writer can still mutate it, and it makes responsiveness to `AuthorizationSession.signal` a concrete provider obligation. Callers remain responsive, local deletion remains truthful, replacement attempts cannot be overwritten by a detached runner, and the settled event continues to guarantee that its named key is already released.

## Verification

Focused authorization tests use explicit start and completion barriers to prove that cancellation returns before runner completion, the key stays in flight, a replacement attempt is refused, no settled event fires early, and release plus `cancelled` settlement occur after the runner rejects.
