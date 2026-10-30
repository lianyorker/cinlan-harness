# Agent Note: Native read-only Session inspection

Status: implemented

English | [中文](2026-10-19-native-session-inspector.zh.md)

## Problem

Reading loaded Session logs and Chat structures does not require a Node debugging endpoint or network capture. Shipping those capabilities through one optional bundle couples ordinary read-only diagnostics to privileged runtime access and duplicates the developer visibility control.

## Decision

The [read-only Inspector](../../../../packages/client/ui-session-inspector/README.md) belongs to `packages/client/ui-session-inspector`, published as `@deepseek-ai/dsh-client-ui-session-inspector`. Web and Desktop compose it once; the shared Developer tools preference owns tab and picker visibility. The privileged Inspector bundle no longer inserts or installs another copy. Node debugging and fetch capture remain explicitly installed experimental capabilities.

The stable package keeps the existing `session-inspector-log` kind and historical implementation id so saved Sidebar tabs still resolve. Its Host discovery entry is inert. It consumes loaded Session/Chat sources, adds no model input or durable event, and imports no experimental runtime. This partially supersedes package ownership and optional composition in the [Session Inspector decision](2026-09-24-session-inspector.md); its data, navigation, and interaction decisions remain active.

## Alternatives considered

Adding an experimental dependency to the stable bundle violates product isolation. Hiding the optional bundle without loading a replacement leaves a dead entry. Renaming saved tab identities adds an unnecessary layout migration. Automatically starting privileged runtime debugging to support raw log inspection grants unrelated authority.

## Consequences

Raw loaded data remains unredacted and subject to the existing authenticated Session access. The visibility preference is not a data authorization policy. Disabling it disposes the scoped tab and active picker; rapid changes serialize and restore one registration. Owner tests exercise these lifetimes, Loader loading and unloading, preserved tab identity, pagination, object navigation, and table behavior. Stable bundling verifies experimental input isolation. Browser snapshots and actual visual acceptance remain independent evidence.
