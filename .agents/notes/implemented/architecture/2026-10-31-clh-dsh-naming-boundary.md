# Agent Note: Product faces `clh`, packages stay `dsh-*`, and the harness home never falls back to `DSH_HOME`

Status: implemented

English | [中文](2026-10-31-clh-dsh-naming-boundary.zh.md)

> Scope: where the Cinlan product identity (`clh`) ends and the upstream-aligned identity (`dsh`) begins, and why the user-data root is strictly isolated. The authoritative rule set lives in docs/dev/clh-dsh-边界.md.

## Problem

Cinlan Harness is a fork of DeepSeek Harness. The product was renamed (`clh` CLI, `~/.clh` home, `CLH_HOME`/`CINLAN_HARNESS_HOME` env vars, `clh-`/`clh_` IPC namespace), but hundreds of packages keep `@deepseek-ai/dsh-*` names and upstream sync keeps importing `dsh`-shaped code (deprecated `dshHome*` aliases in `packages/util/home-paths`, `DSH_*` env references). Without a written boundary, every new file has to re-derive which side to name, and the failure mode is asymmetric: renaming upstream literals enlarges the fork diff forever, while reading `DSH_HOME` would silently couple user data to the official product.

## Decision

Everything a user or a machine boundary can see is `clh`; everything upstream keeps aligned is `dsh`.

- `resolveClhHome` in `packages/util/home-paths` is the single resolver: configured path > `CLH_HOME` > `CINLAN_HARNESS_HOME` > `~/.clh`. It never reads `DSH_HOME` or `~/.dsh`; `DSH_HOME_ENV` is exported only so consumers can keep it clear of the managed namespace.
- `~/.dsh` isolation is a product promise, not an implementation detail. A machine running both products holds sessions, credentials, and caches under the official root; reading or cleaning it from CLH would violate the other product.
- `~/.agents` is the deliberate exception: it is shared agent-tool configuration, not CLH-private data, so it stays independent and keeps the upstream `DSH_AGENTS_HOME` env name rather than minting a second variable for the same concept.
- Deprecated `dsh*` exports in home-paths forward to the clh implementations so upstream-shaped call sites compile; new code uses the `clh*` names only.
- New packages keep the `@deepseek-ai/dsh-*` scope; new user-facing env vars are `CLH_*`. Upstream `dsh` literals in diffs are preserved, not rewritten.

## Alternatives considered

- **Rename the package scope and internals to `clh-*`.** Rejected: it enlarges the fork diff permanently, breaks every upstream sync patch, and buys nothing — package names are not user-facing.
- **Read `DSH_HOME` as a migration/fallback input.** Rejected: silently coupling two products' user data is worse than forcing an explicit import; coexistence without shared state was the original isolation goal.
- **Rename `DSH_AGENTS_HOME` to a CLH-prefixed env.** Rejected: the `.agents` root is shared with other agent tools by design; a product-prefixed variable would fragment that shared configuration for no isolation gain.

## Consequences

- One documented rule replaces per-file judgement: product-facing names are `clh`, upstream-aligned names stay `dsh`; the checklist in docs/dev/clh-dsh-边界.md §7 is the acceptance test.
- `DSH_HOME` may still appear in comments or in code paths that intentionally avoid it; presence of the literal is not itself a violation — consumption is.
- Stale comment references to `$DSH_HOME` (e.g. `apps/cli/src/profile-boot.ts`) are exempt: they get fixed by whichever edit touches the file next, not by a dedicated renaming pass.
