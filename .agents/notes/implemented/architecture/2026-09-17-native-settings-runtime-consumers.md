# Agent Note: Native settings retain feature and operation ownership

Status: implemented

English | [中文](2026-09-17-native-settings-runtime-consumers.zh.md)

## Problem

Applying one visual settings layout to independent plugins can imply behavior the runtime does not support. Prototype defaults can overwrite existing preferences, a successful Promise can conceal a refused write, and an HTTP-specific operation can appear available in Desktop even though its Host has no HTTP server. Resource lists and capability guidance also need different actions from persistent preferences.

## Decision

The settings shell owns geometry, grouping, and navigation. Each feature owns its persisted fields, defaults, runtime consumer, availability, and operation lifecycle. Native rows use semantic theme tokens and localized public copy. Unsupported prototype fields remain explicit gaps rather than writable values without consumers. The [metadata decision](2026-09-17-settings-navigation-metadata.md) owns search and anchors; the [Host preferences decision](../bug-fix/2026-08-06-host-backed-web-preferences.md) owns the shared mirror and write queue. Neither is superseded.

A form that reports saved state requires an accepted Host mutation and the intended effective value and raw override. Reset removes owned overrides. `SettingsScope.mutate` reports actual acceptance while keeping its existing revision fence, serialized queue, recovery, and disposal drain. A refused write that reloads matching values remains refused. Device-specific microphone choices and audio bytes remain browser-owned; they do not enter Host schemas merely to match a visual prototype.

Voice status, model operations, and transcription belong to the provider-neutral `voice` facade. The authenticated controller and optional loopback HTTP adapter use the same request parser and provider operations. The Sherpa provider activates without `webServer`; Desktop uses its existing Connection carrier. UI components receive plain callbacks from their plugin registration. Dictation owns its initiating Session, appends to its latest draft, aborts pending calls on disposal, and never submits the draft. The [voice capability decision](../feature/2026-08-30-local-voice-dictation-vertical-slice.md) retains model, native-engine, and cache ownership; this transport extension does not replace those decisions.

Notification quiet hours are Host-backed preferences interpreted in each receiving browser's local time. Automatic completion and terminal-bell alerts, including sound, are suppressed inside the half-open daily interval; equal endpoints mean all day. The explicit test action bypasses focus and scheduled suppression. A form saves both endpoints in one revision-checked mutation so another client's edit cannot produce a mixed interval, and reset removes every owned override.

GUI link interception stays in the `dsh-better-sidebar` namespace. The Browser page edits only its three routing flags through that scope, independently of Browser Provider readiness. It keeps the first-edit revision and resets only those overrides; browser launch preferences retain their separate owner and restart requirement.

Element capture uses the authenticated Browser controller and the existing conversation draft registry. The capture operation retains its initiating Session id through selection and preview; attachment resolves that Session again and rejects a removed or busy destination. The user reviews a decoded image before attaching, and attachment never submits a message. A mutable current-Session pointer would let a delayed capture send data to the wrong draft. Model input and image persistence on submission remain owned by the ordinary conversation path.

The HTTP Connection bridge checks response closure after an awaited handler and around streamed writes. A late unread body is cancelled, backpressure waits settle even when closure precedes listener installation, and no further chunks or response end are written after closure. Cancellation therefore permits the owning operation and its teardown to finish.

The launcher supplies the actual `dshProfileName` before Loader evaluates configuration. CLI uses the loaded name; Electron keeps the reserved `desktop` identity across staged installations. Mutable state owners use the Harness home and explicit profile identity, independently of replaceable package directories. Desktop development allows a workspace-linked profile through an explicit development option; opening an inspector is not that authorization.

Mobile device preference resolution belongs to the Mobile Device service. Only observation may omit a device id and resolve the saved default to an available exact device; an explicit id wins, and an unavailable default has no fallback. Every mutation still requires an explicit target and current observation. The resolved target appears in the model-visible result and persisted presentation metadata, without changing static tool guidance or schemas when the preference changes.

Independent operation decisions own [reviewed Git actions](2026-09-17-reviewed-sidebar-git-actions.md), [terminal lifetimes](2026-09-17-sidebar-terminal-lifetimes.md), [floating workspace commands](2026-09-17-floating-workspace-command-ownership.md), [managed MCP connections](2026-09-17-managed-mcp-ownership.md), [durable automation](2026-09-17-durable-automation-ownership.md), and [SSH target inspection](2026-09-17-ssh-inspection-authority.md). A common settings row does not merge their authority or success conditions.

## Alternatives considered

**Copy prototype values into a new settings schema.** This creates duplicate defaults and controls that cannot affect a real operation. Existing field owners and scopes provide the persistence and execution facts needed by the page.

**Infer saved state from Promise settlement or recovered values.** A controller can recover after a refused mutation and return normally. Acceptance must come from the actual response; value checks remain additional verification.

**Run an HTTP listener only to support Desktop feature calls.** Desktop already has an authenticated carrier. Keeping operations in their provider and adding a controller supports both applications without a second transport-specific implementation.

**Use a profile installation directory as mutable state identity.** Electron replaces staged package trees. A stable home/profile identity retains state across application updates and separates independent homes.

## Consequences

A unified appearance does not imply identical storage or execution semantics. Capability-only pages remain useful and searchable, but do not manufacture actions. Every new runtime owner still needs its own real composition evidence and documented limits; the field ledger tracks unsupported prototype fields separately from implemented operations.

Tests cover accepted and refused mutations with identical values, superseded writes, in-flight disposal, queued cancellation, and transport recovery. Voice composition tests exercise the real provider through Desktop Fetch without HTTP, authenticated Web calls, legacy parity, cancellation, and unload/reload. Three HTTP bridge regressions reproduce the late-response, closed-write, and backpressure races and verify their settlement. Browser and Electron acceptance consumes assembled artifacts, so source tests alone do not establish application integration.
