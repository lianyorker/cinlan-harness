# Agent Note: KV facet destroy primitive and domain recovery reset

Status: implemented

English | [中文](2026-09-28-kv-facet-destroy-and-domain-recovery.zh.md)

## Problem

The domain KV storage substrate had two operational gaps affecting derived media:

- **Relative storage roots drift with working directory changes.** `JsonStorageBackend` previously preserved its input path string without resolution, so relative paths passed during plugin configuration resolved against `process.cwd()` at the moment each unit opened. While production configurations pass absolute paths, test environments and dynamic cwd shifts risked splitting unit files across multiple directories.
- **Derived media cannot discard corrupt or version-mismatched files.** When a domain medium sustained corruption or an incompatible schema version bump, `open` failed loudly with `malformed-medium`, `version-mismatch`, or `invalid-record`. For authoritative domains such as workspace ledgers, failing loudly is correct. For disposable derived data rebuildable from session event logs, failing loudly bricked host startup without an automated recovery path.

## Decision

- **Resolve JSON backend root at construction.** `JsonStorageBackend` now invokes `resolve(root)` during constructor execution, anchoring the target directory permanently against cwd drift.
- **Add `destroy` primitive to `KvFacet`.** `KvFacet` defines `destroy(descriptor: KvUnitDescriptor): Promise<void>`. The JSON backend unlinks `<root>/<unit>.json` or deletes `<root>/<unit>/` recursively. The SQLite backend deletes metadata rows from `units` and `unit_globals` and executes `DROP TABLE IF EXISTS` on each declared record table. Invocations on absent media resolve idempotently, while invocations on currently open units or closed backends reject.
- **Add `recovery` declaration to `DomainSpec`.** `DomainSpec` accepts `recovery?: 'reject' | 'reset'`, defaulting to `'reject'`.
- **Implement single-shot reset in `DomainFacility.open`.** When a domain declared with `recovery: 'reset'` encounters a damage-class error (`version-mismatch`, `malformed-medium`, or `invalid-record`), `DomainFacility.open` logs a warning, destroys the medium through `backend.kv.destroy`, and executes a single retry over an empty unit. Non-damage errors and second-attempt failures propagate loudly.

## Alternatives considered

- **Automatic medium reset for all domains without spec declaration.** Rejected: authoritative user data such as workspace registrations must never silently disappear on format mismatches or corruption.
- **Renaming corrupt files aside instead of unlinking.** Rejected: derived media can be reconstructed from session event logs, and preserving corrupted derived files leaves unbounded disk residue without recovery value.

## Consequences

Derived KV domains can declare `recovery: 'reset'` to self-heal upon version bumps or parse damage without interrupting host startup. Authoritative domains retain strict fail-loud behavior. The shared `runKvBackendContract` suite verifies `destroy` semantics across both JSON and SQLite backends.
