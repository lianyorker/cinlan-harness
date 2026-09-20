# Agent Note: Feature settings navigation preserves native owners

Status: implemented

English | [中文](2026-09-19-feature-settings-navigation.zh.md)

## Problem

A single Side Cards catalog groups unrelated functions by the package that renders them. Users looking for Files, Tasks, Side Chat, Git, Browser, or Terminal need a destination named for that function. Recreating native forms inside that catalog also gives one preference multiple editors and risks diverging save behavior.

## Decision

Each visible function has its own Settings menu destination. The [navigation map](../../../../reports/design/cinlan-feature-navigation.md#settings-destinations) records the built-in destinations. Files owns file-viewer controls; Workspace layout contains only shared layout preferences. Each visible third-party tab descriptor gets a page identified by `feature:` plus its descriptor id. Hidden plan, diff, and review descriptors remain runtime panels without menu entries.

The [Settings shell](../../../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx) renders the generic keyed `settings.section.extension` slot for the selected section. This additive Settings API composes page content without changing `ctx.betterSidebar` public methods. The [better-sidebar registry](../../../../packages/client/ui-better-sidebar/src/client/settings-navigation.tsx) supplies feature pages, metadata, and extensions under the existing Git, Browser, and Terminal section ids. Their native forms remain the owners of their fields. Registrations follow descriptor lifetime; the shell has no feature-specific routing table.

Feature navigation retains saved key names, namespaces, serialization, and owner save/reset behavior. Sidebar preferences remain in `dsh-better-sidebar`, and descriptor-owned values remain in `pluginSettings[descriptorId]`. Runtime panels and `ctx.betterSidebar` service APIs remain available to their consumers.

The [selective integration decision](2026-09-19-selective-upstream-integration-preserves-product-ownership.md) still protects the full-page shell, CSS, theme tokens, native controls, and public APIs. It does not freeze menu destinations. The [settings metadata](2026-09-17-settings-navigation-metadata.md) and [native settings](2026-09-17-native-settings-runtime-consumers.md) decisions retain navigation and persistence ownership. Cinlan's independent product direction and Linear.app visual reference belong to the [future design context](../../../../reports/design/cinlan-feature-navigation.md#dev-note); they do not authorize a current shell redesign.

## Alternatives considered

**Keep every function in a Side Cards catalog.** This makes users navigate by implementation package and prevents each function from having its own menu destination.

**Duplicate native forms in feature cards.** Separate editors for the same fields increase the chance of divergent validation, saves, and reset behavior. A keyed extension places additional controls beside the existing owner form.

**Apply the future visual reference to this navigation change.** Cinlan's future identity needs a separate design decision. Replacing shell CSS or theme tokens here would mix that decision with function discovery.

## Consequences

Users can find each function directly while installed plugins retain their runtime integrations and saved preferences. The cost is more navigation entries and descriptor-owned registration work. Hidden runtime descriptors do not create empty settings pages. Required regression evidence covers registration and disposal, native-form composition, and unchanged preference payloads; assembled Web and Desktop acceptance remains separate from documentation validation.
