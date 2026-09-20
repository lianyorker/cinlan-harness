# Agent Note: Awaited per-agent initialization

Status: implemented

English | [中文](2026-09-09-awaited-agent-creation.zh.md)

## Problem

Shared presets install tools and prompt sections separately for each Agent. Installation can await plugin activation or external resources. A creator must know that these contributions have finished before the Agent's first model request, and cancellation must not remove resources while an initializer still uses them.

## Decision

`agent/created` is the serial initialization event after factory setup and registry entry. Each listener finishes before the next starts; a throw or rejection fails creation and skips later listeners. The payload carries `SessionStartSource` and the optional factory cancellation signal. Callers await `register()` and `announce()`; the former announces fresh startup and resolves to its disposer. The local `agent/session-start` event remains a synchronous notification after successful initialization, preserving consumers that observe startup without gating it.

AgentLoop holds maintenance through setup and creation dispatch. Input may enter the inbox during initialization, but the driver starts only after success. Failure cancels maintenance without waking queued input; ordered teardown owns inbox cleanup. This preserves the initialization error when another teardown has already removed the inbox projection.

Creation dispatch retains the scope and Session while listeners await. Disposal cancels initialization and joins dispatch before releasing those resources. The provider nests the exact scope disposer in its ordered lifecycle effect, and the caller owns that same effect. Either owner's unload therefore joins the same quiescence while the scope retains the provider's dependency context. A listener must not await its own Agent's idle state or its owner's disposal, because both wait for that listener to finish.

This decision owns asynchronous creation timing. The [scope contributor decision](2026-07-08-agent-scope-contexts.md) retains registration visibility, the [scope runtime decision](2026-07-12-agent-scope-runtime-design.md) retains registry identity and teardown ownership, and the [interception decision](../feature/2026-06-30-interception-extension-points.md) retains policy and tool-event semantics.

## Alternatives considered

**A separate setup event.** Existing creation listeners already install per-agent contributions. A second initialization event splits that responsibility without a distinct consumer need.

**Detached initialization.** Returning before plugin activation settles lets the first request omit required tools or context and disconnects initialization failure from the creator.

**Caller-only ordered teardown.** The Agent scope is a provider-owned child fiber. Nesting its disposer only under the caller leaves provider unload free to dispose that child before a pending initializer settles.

## Consequences

Creation latency includes asynchronous initialization. Failures become caller-visible creation failures, and cancellation relies on listeners settling cooperatively. Notifications already delivered remain observable; rollback pairs begun creation announcements with disposal notifications. Registrations remain visible during initialization, so callers use completed creation promises rather than treating a registry lookup as readiness.

The event is process-local and introduces no Session event or SDK wire notification. Released Session format and committed SDK fixture generations remain unchanged. Focused lifecycle tests cover serial completion, rejection, cancellation under both owners, and independent concurrent creation; SDK tests verify delayed prompt admission and unchanged canonical event projection. Prompt installer and fixture waiter tests cover readiness, rejection, and awaited cleanup.
