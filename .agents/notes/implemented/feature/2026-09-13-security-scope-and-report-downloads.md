# Agent Note: Settings-owned scope and authenticated report downloads

Status: implemented

English | [中文](2026-09-13-security-scope-and-report-downloads.zh.md)

## Problem

A configuration summary cannot edit assessment authority, and a report button must not treat authentication as unrestricted export permission. Asynchronous policy mirrors can retain revoked authority; checking only the first grant target misses other targets contained in a report.

## Decision

The optional assessment-scope-settings Provider reads canonical root authority directly from committed Settings. The static Provider remains usable without Settings. The UI binds the namespace through the framework hooks compartment, pins the first-edit revision, preserves failed drafts, and handles the explicit Remote write result before acknowledging a save. It saves displayed fields, including egress destinations and credential references, in one revision-fenced mutation. Blank advanced rows grant nothing; removing every row writes an empty list. Credential references remain environment-variable names; the editor neither resolves nor stores their secret values.

Session bindings remain immutable. Root expansion does not widen existing Sessions; incompatible identity changes or narrowing can invalidate their bindings. No code overwrites a recorded grant or silently rebinds an old Session.

The report-download action grants delivery through the existing authenticated Harness client channel, including authenticated remote clients. It is distinct from arbitrary outbound data-export and external-reporting, whose exact egress requirements remain unchanged. The Host checks every Finding target, Execution Host, grant validity, approval requirements, and evidence policy. It flushes authorization decisions before returning bytes and rechecks authority after the wait. A pending approval does not become approval merely because the user clicks Download.

The pure finding-export library produces JSON, Markdown, and SARIF for the human Consumer; the model tool retains its own exporters. Reports preserve metadata text and perform no redaction. The human Consumer requires permission for redaction none and rejects whole reports at count and byte limits instead of truncating them. Client saves use inert Blob URLs and release them on replacement or unmount.

## Alternatives considered

**Mirror root grants in a Settings watcher.** Watchers run asynchronously after the Settings commit, creating an avoidable stale-authorization interval.

**Invent an egress endpoint for an authenticated download.** The Remote API does not expose a verified recipient endpoint. A dedicated action grants this known delivery channel without weakening outbound-export policy or claiming recipient verification.

**Pass a Settings service into React or acknowledge a recovered read as a save.** Framework-bound selectors preserve the UI data model; inspecting the mutation result distinguishes persistence from recovery after rejection.

## Consequences

Reports can reach any authenticated Harness client admitted by the existing Gateway. This action is not an IP-specific delivery restriction. Downloaded files have no automatic expiry or revocation, and free-text Findings can contain sensitive information. Scope identity changes can require a new Session; Execution Host ids still follow the mounted Provider lifetime.

The optional assessment-scope-tool-policy intercepts configured shell, network, and Browser model-tool names. Its sole-target fallback, Agent-less dispatch, page destination resolution, and post-approval revalidation remain authorization gaps; it does not confine arbitrary shell commands, direct Provider calls, or browser subresources.

Finding state controls, all-path shell/browser/network guards, device-native Providers, and full migration acceptance remain separate. The finding_export model tool checks report-download only when assessmentScopeSessions is mounted and lacks the human Consumer’s post-flush authority recheck; it is not a unified export authorization policy. Other Finding reads and transitions retain their own state and evidence prerequisites.

## Verification

Focused tests cover revision fences, denied saves, unmount cancellation, invalid bytes, multiple report targets, exclusion, unknown targets, approval-required decisions, revocation during flush, limits, and unchanged outbound egress requirements. The real optional Web composition saves to disk, rejects an invalid expiry without losing the draft, downloads and compares all three report formats, and reopens saved scope after Host restart.

The [native evidence decision](2026-09-13-native-browser-and-security-evidence.md) and [Browser operations decision](2026-09-13-native-browser-operations.md) remain active; their independent Provider and evidence ownership rules are not superseded.
