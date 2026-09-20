# Agent Note: Archived Session restore preserves Workspace state ownership

Status: implemented

English | [中文](2026-09-19-archived-session-settings-restore.zh.md)

## Problem

Archived Sessions need a discoverable restore action without changing their history, Workspace order, or the current conversation. A client can also receive an older archive response after a newer restore or pushed baseline, which can make a restored row appear archived again.

## Decision

The [Archived sessions Settings page](../../../../packages/client/ui-settings-unarchive-sessions/README.md) owns an independent Personal menu entry, localized public search metadata, and the list, search, and restore actions. It uses the existing Settings shell and shared controls. It joins archived ids with loaded Session summaries and Workspace membership; missing summaries have no row. The [feature navigation decision](../architecture/2026-09-19-feature-settings-navigation.md) retains ownership of the general menu policy.

Restore follows `uiWorkspace` → Workspace Controller → Workspace Registry. The registry serializes removal from the existing archive set with its other writes, retains Workspace membership and ordering, and publishes only after durable success. An absent id succeeds without a write; removal needs no Session existence check. Restore never opens a Session body or changes its log generation. Released Session format 3 and its committed files remain untouched.

The Client model uses one sequence for archive and restore requests. A later request, pushed archive set, or replacement baseline supersedes an older unary reply. Restoration updates the observable archive set without selecting or opening the restored Session.

## Alternatives considered

**Open the Session while restoring.** Restore is a visibility operation. Combining it with navigation would replace the current conversation and give the Settings page an unrelated action.

**Rewrite Session data or remove Workspace membership.** The existing archive set already owns visibility. Rewriting history or membership would alter independent durable data and lose the recorded position.

**Install every successful unary response.** An older response can arrive after a newer archive state. Accepting it would temporarily reverse a completed restore.

## Consequences

Restored Sessions reappear through the existing archive-filtered views while the current selection stays unchanged. The page cannot restore an archived id absent from the loaded Session list; registry callers can still remove that id. Focused tests cover persistence, idempotence, untouched membership, stream updates, request races, search, localization, and contribution disposal. The browser restore path requires matching generated Workspace Remote artifacts and a composition that mounts the page.
