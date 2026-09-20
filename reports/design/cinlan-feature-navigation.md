# Cinlan feature navigation decision

## Summary

Settings gives each visible function its own menu destination. Native forms keep their fields and save behavior, and the shared shell retains its layout, CSS, and theme tokens. The [implemented Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-feature-settings-navigation.md) owns the rationale and alternatives.

## Table of Contents

- [Settings destinations](#settings-destinations)
- [Ownership and verification](#ownership-and-verification)
- [Dev Note](#dev-note)

## Settings destinations

The [better-sidebar navigation registry](../../packages/client/ui-better-sidebar/src/client/settings-navigation.tsx) maps visible descriptors to these destinations. Git, Browser, and Terminal extend their existing native pages through the generic keyed `settings.section.extension` slot and retain their owner-defined group placement.

| Function | Descriptor | Section id | Group | Content owner |
|---|---|---|---|---|
| Files | `editor` | `files` | Tools (`tools`) | File controls and file-viewer controls |
| Tasks | `subagent` | `tasks` | AI (`ai`) | Task and subagent presentation controls |
| Side Chat | `sidechat` | `sidechat` | AI (`ai`) | Side Chat controls |
| Git | `git` | `git-source-control` | Development (`development`) | Existing Git form plus sidebar controls |
| Browser | `browser` | `cinlan-browser` | Tools (`tools`) | Existing Browser form plus sidebar controls |
| Terminal | `terminal` | `terminal` | Experimental (`experimental`) | Existing Terminal form plus sidebar controls |
| Workspace layout | Shared layout only | `workspace-layout` | Personal (`personal`) | Shared panel and layout preferences |
| Third-party tab | Each visible descriptor id | `feature:${id}` | Extensions (`extensions`) | That descriptor's controls |

There is no all-features Side Cards catalog. File-viewer controls belong within Files. Hidden plan, diff, and review descriptors remain available to runtime consumers without becoming Settings menu entries. Visible descriptor registration and disposal determine the corresponding feature entry lifetime.

## Ownership and verification

The [slot declaration](../../packages/client/ui-settings/src/client/contract/slots.ts) and [Settings shell](../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx) supply generic page composition through the additive Settings slot API. The public methods of `ctx.betterSidebar` are unchanged. Feature ids, menu mapping, and feature controls belong to the registry above. The [settings metadata decision](../../.agents/notes/implemented/architecture/2026-09-17-settings-navigation-metadata.md) continues to own groups, search, and field anchors.

Native owner forms retain validation, save/reset behavior, saved key namespaces, and serialization. Sidebar preferences retain `dsh-better-sidebar` and `pluginSettings[descriptorId]`; native feature preferences retain their existing owners. Runtime panels, service APIs, and existing consumers remain under the [integration protections](../../.agents/notes/implemented/architecture/2026-09-19-selective-upstream-integration-preserves-product-ownership.md) and [native settings decision](../../.agents/notes/implemented/architecture/2026-09-17-native-settings-runtime-consumers.md).

Required runtime evidence covers menu registration and disposal, hidden-descriptor exclusion, native-form composition without duplicate fields, Files viewer controls, and preserved preference payloads. [Application verification](../../docs/testing.md) owns assembled Web and Desktop behavior. Documentation pairing and link checks do not establish runtime acceptance.

## Dev Note

Future design context, not an implemented visual specification: Cinlan is intended to become an independent product based on DeepSeek Harness. Linear.app is a future style reference for that product. This navigation decision introduces no Linear-derived visual system and does not authorize changes to the current shell CSS or theme tokens.
