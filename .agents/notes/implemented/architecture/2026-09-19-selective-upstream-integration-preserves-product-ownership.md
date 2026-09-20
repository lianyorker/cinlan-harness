# Agent Note: Selective upstream integration preserves product ownership

Status: implemented

English | [中文](2026-09-19-selective-upstream-integration-preserves-product-ownership.zh.md)

## Problem

Official v0.1.6-alpha.2 adds core fixes and plugin management alongside product choices that differ from Cinlan. Replacing whole product compositions would couple useful runtime changes to Settings redesign, Desktop installation ownership, sidebar API changes, and different model or delegation defaults.

## Decision

Integrate selected core fixes and capabilities through existing product owners. Settings retains its full-page shell, CSS, semantic theme tokens, grouped navigation, search, and native controls. Feature owners retain persistence and save feedback: `SettingsScope.mutate(): Promise<boolean>` reports Host acceptance, and matching readback alone cannot establish a successful save. The [navigation](2026-09-17-settings-navigation-metadata.md) and [native settings](2026-09-17-native-settings-runtime-consumers.md) decisions remain active. The [feature settings navigation decision](2026-09-19-feature-settings-navigation.md) owns individual menu destinations within these shell and persistence protections.

Plugin management occupies the existing Plugins settings tab. Its Host service requires a real launcher-provided `ProfileContext`; it does not infer writable profile ownership from paths. The executor refuses Desktop package and composition mutations with `management-required` before acquiring a lock or modifying files. Configuration-row changes require the explicit Desktop Host adapter described in the [capability integration decision](2026-09-20-official-capabilities-preserve-cinlan-architecture.md). Desktop retains `dsh-app://`, framed pipes, private pnpm, and exclusive staging, health-check, activation, and recovery transactions under the [Desktop ownership decision](2026-08-25-electron-desktop-packaging-and-updates.md). Hiding browser controls cannot substitute for executor enforcement.

The better-sidebar APIs and existing consumers retain their public behavior. Plan previews and file-change review register through optional consumers, so neither feature requires replacing the sidebar. The additive `conversation.chat.turnCards` list coexists with the `conversation.chat.turnTail` chain; independent cards do not compete for its selector. Existing [tab navigation](2026-09-05-sidebar-tab-types-and-navigation.md) and [worktree/sidebar security](../feature/2026-09-10-worktree-sidebar-security-integration.md) decisions retain their separate ownership and authorization rules.

The subagent runtime defaults `maxActiveSubagents` to `8` and keeps the local `maxDepth` default of `3`. Explicit deployment values take precedence; tools with no depth override resolve the shared setting for each delegation. The [persona, filtering, and depth decision](../feature/2026-07-12-subagent-persona-tool-filter-and-depth.md) retains its provider and absolute-depth guarantees.

Chat Completions remains the default protocol; Messages is an explicit option. New image support operates in request preparation without introducing another durable image format or cross-Session persistence migration. Existing gateways, configured model lists, and the [image request pipeline](../feature/2026-08-20-unified-image-request-pipeline.md) keep their owners.

## Alternatives considered

**Replace the product composition with the official release.** This would make adopting independent core fixes also change Settings, Desktop transport and installation, sidebar integrations, and established defaults. Those choices require their own product decisions.

**Let the Web plugin manager own Desktop's package transactions.** A shared profile path does not transfer Desktop's transaction ownership. Concurrent package writers could bypass its staged validation and recovery; the service therefore rejects this route even in a custom composition.

**Require one sidebar implementation or reuse the tail selector for every card.** Optional consumers preserve existing sidebar APIs, while a separate card list lets submitted plans and file changes coexist with the tail chain.

## Consequences

Cinlan receives the selected fixes and plugin manager while retaining its Settings and Desktop behavior. Integration carries explicit adapters and profile checks instead of making release identity determine product defaults. The retained notes continue to own their detailed rationale; only depth-setting resolution changes within the existing subagent decision. Future integrations must check these same owners before changing a default, public API, or mutation path.
