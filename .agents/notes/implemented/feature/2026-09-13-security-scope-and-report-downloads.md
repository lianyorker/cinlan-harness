# Agent Note: Settings-owned scope and authenticated report downloads

Status: implemented

English | [中文](2026-09-13-security-scope-and-report-downloads.zh.md)

## Problem

A configuration summary cannot edit assessment authority, and a report button must not treat authentication as unrestricted export permission. Asynchronous policy mirrors can retain revoked authority; checking only the first grant target misses other targets contained in a report.

## Decision

The optional [assessment-scope-settings Provider](../../../../packages/security/assessment-scope-settings/src/index.ts) reads canonical root authority directly from committed Settings. The static Provider remains usable without Settings. Settings mutations validate complete grants and use revision fences; egress destinations and credential references can commit atomically, and empty lists grant nothing. Credential references remain environment-variable names, with inline secrets rejected. The [managed resource decision](2026-09-20-managed-security-skill-resources.md) owns the Security Research Settings page; that page manages skill resources and provides no scope editor or report controls.

Session bindings remain immutable. Root expansion does not widen existing Sessions; incompatible identity changes or narrowing can invalidate their bindings. No code overwrites a recorded grant or silently rebinds an old Session.

The report-download action grants delivery through the existing authenticated Harness client channel, including authenticated remote clients. It is distinct from arbitrary outbound data-export and external-reporting, whose exact egress requirements remain unchanged. The Host checks every Finding target, Execution Host, grant validity, approval requirements, and evidence policy. It flushes authorization decisions before returning bytes and rechecks authority after the wait. A pending approval does not become approval merely because the user clicks Download.

The pure finding-export library produces JSON, Markdown, and SARIF for the human Consumer; the model tool retains its own exporters. Reports preserve metadata text and perform no redaction. The human Consumer requires permission for redaction none and rejects whole reports at count and byte limits instead of truncating them. The [authenticated report BFF](../../../../packages/api/security-research-controller/src/index.ts) returns bounded bytes and media metadata; delivery policy does not require a report control on the resource page.

## Alternatives considered

**Mirror root grants in a Settings watcher.** Watchers run asynchronously after the Settings commit, creating an avoidable stale-authorization interval.

**Invent an egress endpoint for an authenticated download.** The Remote API does not expose a verified recipient endpoint. A dedicated action grants this known delivery channel without weakening outbound-export policy or claiming recipient verification.

**Acknowledge a recovered read as a successful Settings mutation.** A read can recover after a rejected write; the explicit mutation result and revision fence distinguish committed authority from merely observed state.

## Consequences

Reports can reach any authenticated Harness client admitted by the existing Gateway. This action is not an IP-specific delivery restriction. Downloaded files have no automatic expiry or revocation, and free-text Findings can contain sensitive information. Scope identity changes can require a new Session; Execution Host ids still follow the mounted Provider lifetime.

The optional assessment-scope-tool-policy intercepts configured shell, network, and Browser model-tool names. Its sole-target fallback, Agent-less dispatch, page destination resolution, and post-approval revalidation remain authorization gaps; it does not confine arbitrary shell commands, direct Provider calls, or browser subresources.

Finding state controls, all-path shell/browser/network guards, device-native Providers, and full migration acceptance remain separate. The finding_export model tool checks report-download only when assessmentScopeSessions is mounted and lacks the human Consumer’s post-flush authority recheck; it is not a unified export authorization policy. Other Finding reads and transitions retain their own state and evidence prerequisites.

## Verification

The retained [Settings Provider tests](../../../../packages/security/assessment-scope-settings/tests/provider.spec.ts) cover committed authority, revision fences, invalid grant rejection and atomic egress/credential changes. The [report BFF tests](../../../../packages/api/security-research-controller/tests/reports.host.spec.ts) cover multiple targets, exclusions, unknown targets, approval-required decisions, revocation during flush, cancellation, pagination, limits and unchanged outbound egress requirements. The [optional Web composition scenario](../../../../apps/web/tests/security-capabilities.e2e.ts) checks Settings through Host APIs, compares all three report formats, restores scope after Host restart and asserts that the resource page has no scope/report controls. Its assembled Web execution is separate release evidence; deleted editor and Blob-download UI tests are not evidence for this page.

The [native evidence decision](2026-09-13-native-browser-and-security-evidence.md) and [Browser operations decision](2026-09-13-native-browser-operations.md) remain active; their independent Provider and evidence ownership rules are not superseded.
