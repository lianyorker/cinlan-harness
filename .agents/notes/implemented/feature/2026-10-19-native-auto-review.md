# Agent Note: Native current-session Auto backend

Status: implemented

English | [中文](2026-10-19-native-auto-review.zh.md)

## Problem

A permission option cannot work without its per-call authorization backend. A separate plugin toggle duplicates capability selection and can leave a saved Auto Session without its required reviewer.

## Decision

The [Auto guard](../../../../packages/guard/auto-review/README.md) owns authorization under `packages/guard/auto-review`, published as `@deepseek-ai/dsh-auto-review`. The Web bundle installs one bounded backend, and the optional bundle roster removes the old experimental name. Source imports, tests, compiler references, publication payload and generated catalogs follow the new owner together.

Backend presence is independent of permission selection. Auto remains current-session-only, requires the existing visible risk acknowledgement, cannot become a future-session default, and does not transfer Auto permission state to children. Existing native/PTC review, denial, technical failure, logging, cancellation, and teardown behavior is unchanged. The `auto` preset and audit event identity remain stable. The EXP warning stays because the workspace persistence acknowledgement and full acceptance are pending; relocation is not release certification.

This partially supersedes optional installation and package ownership in the [Auto decision](2026-08-28-auto-review.md); its authority ordering and safety limitations remain active. No historical Session generations or accepted persistence records are rewritten.

## Alternatives considered

Hiding an unmounted plugin row leaves an unusable mode. Importing an experimental provider into a stable bundle violates product isolation. Selecting Auto automatically changes execution authority without a user choice. Removing warnings because the package moved confuses composition with acceptance.

## Consequences

Existing installations must remove the old optional bundle before adopting the native Web row, or duplicate integration registration fails. Session-level UI and Loader tests verify availability, unchanged defaults, explicit selection, human approval paths, and withdrawal behavior. Persistence compatibility failure, full browser replay drift, and real-provider certification remain reported independently.
