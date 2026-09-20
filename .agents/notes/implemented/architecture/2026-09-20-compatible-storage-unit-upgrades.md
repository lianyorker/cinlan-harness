# Agent Note: Explicit compatible storage unit upgrades

Status: implemented

English | [中文](2026-09-20-compatible-storage-unit-upgrades.zh.md)

## Problem

A domain can add optional fields while its current schemas still accept stored predecessor records. Rejecting every older whole-unit stamp prevents that domain from opening across a monotonic version increase. Upgrading a stamp during open would mutate data merely because it was inspected, while committing a stamp separately from a write could claim an upgrade whose data operation failed.

## Decision

The domain owner declares compatible predecessors through `compatibleVersions`. Entries are explicit non-negative integers below the current version, and the current record and global schemas must accept their values. Whole-unit JSON and SQLite admit the current stamp or a listed older stamp; unlisted older versions and future versions reject. This is schema-compatible admission, not a record transformation or permission to lower the current version.

A compatible whole-unit open and `loadAll()` preserve stored values and the existing stamp. JSON builds its in-memory state with the current version and publishes that stamp with the next successful atomic file replacement. A failed publication leaves the predecessor file intact; deleting an absent JSON key performs no publication.

SQLite uses `BEGIN IMMEDIATE` for `putRecord`, `deleteRecord`, and `setGlobal`. Under that transaction it rechecks the stored stamp, runs the data operation, updates `units.version`, and commits. Failure rolls back both data and stamp. A handle opened against an older version cannot write after another handle commits a newer stamp. Compatible unit upgrades change no physical DDL; `STORAGE_SQLITE_SCHEMA_VERSION` and its exact-version database admission remain separate from owner-declared unit versions.

The [projection-cache compatibility decision](2026-09-02-projcache-cross-version-read-compat.md) retains ownership of per-record admission, legacy bootstrap, semantic identity checks, and backup-and-skip. This decision extends whole-unit backend admission without changing those mechanisms. [Released Session JSONL generations](2026-08-31-released-session-format-migrations.md) retain their independent adjacent-migration rules.

## Alternatives considered

**Exact-version whole-unit reads.** They reject structurally compatible predecessor data even when its owner can validate every stored value with current schemas.

**Rewrite the stamp on open.** Opening or inspecting data would become an upgrade operation, and a later rejected write would leave an advanced stamp without its intended change.

**Commit the SQLite stamp independently.** Separate commits could leave data and version inconsistent after a failure. A pre-transaction stamp check would also allow an older open handle to overwrite a committed upgrade.

**Accept every lower version.** Version ordering alone does not prove schema or semantic compatibility; only the domain owner can name acceptable predecessors.

## Consequences

Owners must keep current versions monotonic and explicitly justify each compatible predecessor. Incompatible schema changes still need an owner-defined transformation. Reading a predecessor is not downgrade support after a successful current write. JSON retains its caller-owned write ordering and does not gain cross-process coordination from compatibility admission.

Verification covers both backends: accepted predecessor reads preserve stored stamps, first successful writes publish current stamps, unlisted and future versions reject, failed writes preserve old data and stamps, and SQLite rejects stale-writer downgrade attempts. Per-record compatibility and invalid-record recovery keep their existing tests. Operational semantics belong in the [storage reference](../../../../docs/subsystems/storage.md) and backend READMEs.
