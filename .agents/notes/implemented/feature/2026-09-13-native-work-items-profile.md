# Agent Note: Native Work Items profile and Workspace ownership

Status: implemented

English | [中文](2026-09-13-native-work-items-profile.zh.md)

## Problem

Copied packages do not establish a working profile, generated Remote, or durable Web workflow. Work Item associations must follow the current Workspace and Session lifecycle rather than retaining a second archive model.

## Decision

The optional work-items profile composes its own bundle after base and Web. It mounts the registry, native GitHub/Linear providers, model tools, Remote controller, and Settings page. Both provider write switches default to false. Client calls use the generated Remote, not Host implementation imports.

Associations use registered Workspace identities and owned, unarchived Sessions. Validation repeats after asynchronous reads. Deleting and recreating a Workspace does not transfer old links to the new identity. Local unlink does not require provider availability.

The existing ledger preserves immutable previews and receipts. Confirmation never replaces preview fields; an interrupted running marker recovers as unknown and is never automatically resent.

## Alternatives considered

**Mount in every Web profile.** This adds providers and tool schemas to users who did not install the capability. A removable bundle preserves opt-in composition.

**Restore Workspace archive fields for copied callers.** This duplicates the registry lifecycle. Updating Consumers preserves one deletion and Session-archive model.

## Consequences

The capability runs without Orca. Provider scope and credential setup remain deployment-owned. Dedicated setup UI, live GitHub/Linear account validation, and a recorded model-conversation scenario remain outside this batch. The ledger does not coordinate simultaneous Hosts sharing one database.

## Verification

The real Web test substitutes only external HTTP. It checks Remote reads, write rejection, persisted associations across Host restarts, optional removal, and 1680/1000/600px layout and hit testing. Built SQLite process tests verify receipt replay and death after an external effect without resending. No real external issue is modified.
