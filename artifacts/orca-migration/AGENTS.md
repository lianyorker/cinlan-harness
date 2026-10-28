# Orca migration workspace rules

This subtree compares the pinned `stablyai/orca` source with the current Cinlan Harness checkout. The upstream baseline is `main` at `b4d5b7de7afef23f1868153f0e6918f3c56ed595` (`orca` `1.4.214`, collected 2026-10-10). [The baseline](exports/baseline.json) records source hashes; [the source list](exports/upstream-paths.txt) and [fetch script](scripts/fetch-reference.mjs) describe the reproducible slice. Samples live under ignored `samples/.cache/`.

## Analysis rules

- Harness remains the runtime foundation. Map Orca behavior to existing Harness packages, Cordis services, providers, events, settings slots, and session records before proposing new code.
- The fork's product identity is CLH. Follow [CLH isolation rules](docs/提示词使用规则.md#clh-isolation) for commands, environment variables, user data, and install/runtime identifiers; preserve real upstream source and dependency names. This documentation task does not implement a repository-wide rename.
- Do not infer a capability from a package name or directory. Confirm it in source, a manifest, a profile patch, a test, or an executed operation.
- Distinguish four states: upstream exists, Harness source exists, the current profile composes it, and the behavior has current verification evidence. These states are not interchangeable.
- A declaration in the base bundle patch is not a resolved user profile. Check later overlays, disabled conditions, injected services, and a cold launch before claiming reachability.
- Mark every comparison as `一致`, `部分实现`, `仅有底层能力`, `缺失`, `设计不同`, or `待运行验收`. A UI directory or a passing unit test alone is not visual acceptance.
- UI comparisons cover navigation entry, layout, controls, state transitions, empty/error/loading states, responsive behavior, theme, localization, accessibility labels, and destructive-action confirmation. Source inspection is not a screenshot result.
- Orca process, terminal, SSH, relay, and mobile concepts must be translated separately from LLM session cancellation and model streaming. Use `AbortController` only where the Harness lifecycle owns the cancellation; keep subprocess and device ownership with their existing providers.
- New Harness work belongs in the existing `packages/<group>/<package>` and documented capability seams. Do not create an `extensions/` or `plugins/` parallel tree merely to mirror Orca.
- Mock data is evidence only in tests. A product UI must not report a mock or unavailable backend operation as successful.
- Every migration prompt names the exact Orca and Harness paths and requires an explicit UI owner, durable/logged inputs, resource owner, tests, and visual evidence before implementation is accepted.
- This task is analysis and documentation. It does not modify Orca or Harness product code, generated catalogs, snapshots, or lockfiles.

## Evidence labels

Use `source`, `manifest`, `test`, `profile`, `command`, `screenshot`, and `not-verified` labels. Include the repository-relative path for source evidence. State when the latest upstream file was selected but not downloaded into the ignored sample slice.

## Document layout

Each feature directory contains `差异分析.md`, `UI检查表.md`, and `迁移提示词.md`. The first owns the source comparison; the second owns visual acceptance requirements, not passing results; the third is a future execution prompt. [Prompt rules](docs/提示词使用规则.md) correct the original templates without overwriting them. Reviewed inputs live in [features.mjs](scripts/features.mjs); regenerate dossiers through [build-docs.mjs](scripts/build-docs.mjs), then check links and the README pair.
