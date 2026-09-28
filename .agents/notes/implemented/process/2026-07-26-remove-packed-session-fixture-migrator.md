# Agent Note: Remove the packed-session fixture branch migrator

Status: implemented

English | [中文](2026-07-26-remove-packed-session-fixture-migrator.zh.md)

## Problem

The repository's default writers and snapshot check keep session fixtures in the canonical packed-row layout. `pnpm run migrate:packed-session-fixtures` remains alongside that permanent enforcement only so in-flight branches carrying older fixture edits can merge current `master` and mechanically converge without re-recording model output.

Once every such branch is merged, closed, or already canonical, the write command and its branch-convergence instructions have no continuing owner. Keeping a mutation command after its transition ends adds a second apparent maintenance path beside the permanent read-only snapshot check.

## Decision

Removed the temporary `scripts/migrate-packed-session-fixtures.ts` CLI and the root `migrate:packed-session-fixtures` package command after confirming that no open pull request still needs fixture conversion. Replaced the command-specific remediation text in `scripts/session-fixture-layout.spec.ts` with command-independent canonical-layout guidance. Removed the transitional command links from the session-snapshot README.

Retain `scripts/session-fixture-layout.ts`, its unit tests, and `scripts/session-fixture-layout.snapshot.ts`. They define and enforce the permanent canonical layout; only the branch-facing writer is temporary.

Before removing the command, each affected branch merges the current `master`, runs the migrator once, commits the resulting fixture-only rewrite separately, and verifies that the repository-wide snapshot layout check passes. Closed or superseded branches require no migration.

## Alternatives considered

**Keep the command indefinitely.** This makes old fixture conversion convenient, but it leaves a repository-wide mutation tool after the only known migration window closes. The read-only gate already supplies the durable behavior and diagnostic.

**Remove the canonicalization module with the CLI.** The module is not transition residue: snapshot CI uses it to discover future fixtures, decode mixed physical records, and compare them with the canonical packed representation. Removing it would also remove enforcement.

**Delete the command immediately when packed rows reach `master`.** Older open branches would then need ad hoc scripts or manual snapshot regeneration after retargeting, increasing conflict risk and making decoded-event preservation harder to review.

## Consequences

The permanent canonical-layout check is the single mechanism for session-fixture format enforcement. Non-canonical fixtures must be re-recorded so the writer produces the current layout; no mechanical rewrite command exists. The canonicalizer module, unit tests, and snapshot check remain as durable infrastructure.
