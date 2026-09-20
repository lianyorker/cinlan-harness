# Agent Note: Live permission catalog

Status: implemented

English | [中文](2026-09-20-live-permission-catalog.zh.md)

## Problem

An existing session can outlive installation or removal of its Auto reviewer. A catalog stored only in the Session permission projection cannot notify its picker when process capabilities change without new permission events.

## Decision

The permission service publishes the process catalog through its generated Typert Remote and emits invalidation when Auto registers or leaves. Session projection carries only the current selection. The browser subscribes before reading, rejects stale connection generations, and clears failed snapshots. Catalog changes dismiss the permission command picker and pending confirmation while preserving the draft. The composer keeps its localized control and reads the same catalog. Stable command definition identities keep permission-specific UI off shadowing commands.

This decision partially supersedes the combined-projection and profile-restart choice in the [Auto review note](../feature/2026-08-28-auto-review.md). That note remains active for model authorization, cancellation, restoration, and delegation. This catalog changes no execution policy or Session sequence; canonical sandbox and approval setters remain the write path.

## Alternatives considered

**Keep the combined projection and restart profiles.** That limits live plugin capability changes and leaves existing pickers stale. The process catalog owns capability availability independently of durable session facts.

**Append permission events when the catalog changes.** Capability discovery is process state. Logging it would manufacture session history without changing the selected policy.

## Consequences

The Remote assembly and both pickers must share the catalog service. Tests cover registration and disposal without Session writes, existing-session option refresh, failed and stale reads, command shadowing, and picker invalidation. The UI retains its risk confirmation; runtime admission and sandbox checks stay independent.
