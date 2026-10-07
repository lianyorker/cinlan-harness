---
description: "Archived-session Settings page for the dsh web client: the registry-global archive set as a searchable list with one Unarchive action per row."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-unarchive-sessions

English | [中文](README.zh.md)

## Summary

The **Archived sessions** Settings page is the restore point for sessions hidden from Workspace navigation. It lists each archived session with the Workspace that owns it and its last activity, newest archive first, and offers Unarchive and Delete actions per row. A search box filters the list by session title or Workspace name. The Workspace archive set owns membership; a missing Session log retains a fallback row so the stale archive entry can be removed. Every restore and delete goes through the shared Workspace commands.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings and select **Archived sessions** to see the sessions currently hidden from every grouping surface. Mount `@deepseek-ai/dsh-client-ui-settings-unarchive-sessions` in a Web composition that provides the settings shell, Workspace service, and Session Remote; the page registers its own navigation entry and needs no configuration. Settings search indexes localized page and action labels; session titles remain confined to the page search.

### Reading a row

Each row shows the session's display title, the title of the Workspace that accounts for it or the ungrouped label, and its last activity as a compact relative time. The page lists the most recently archived session first, the reverse of the durable archive order. It reads archived summaries independently of the live Session catalog and waits for the Workspace archive baseline before rendering rows. A missing log uses the session id and a missing-log label, while remaining available for deletion and unarchive cleanup. An empty archive and a query matching no row report distinct messages.

### Restoring a session

Unarchive restores the session to its recorded position under its Workspace, or to the ungrouped sessions when it belongs to none, and the row disappears from the page. The action calls `ctx.uiWorkspace.unarchiveSession`, then refreshes the live Session catalog. Delete opens the shared confirmation overlay; confirmation removes the durable Session log and its archive/workspace references. A rejected unarchive call is logged as a console diagnostic and leaves the row in place for another attempt.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page is one localized `settings.section` contribution with id `archived-sessions`; the Settings shell owns the navigation and mounted section. The page uses shared `Input` and `Button` controls and semantic theme tokens.

### Registration and data sources

`apply()` registers the locale namespace, binds it, and uses `ctx.slots.inject()` to contribute the section, so a late or restored slot declaration still reaches it. The page reads archive membership and Workspace summaries from `useWorkspaces`, and obtains available Session summaries through `session.archived`; it owns no store and no transport. The registration injects the archived read, `ctx.uiWorkspace.unarchiveSession`, and the shared delete-confirmation request.

### Row derivation

Rows are derived from the archive set and available summaries. A member with no summary still produces a fallback row because the archive set is authoritative and stale ids need a cleanup action. Workspace ownership is read from each Workspace's `sessionIds`; a member outside every Workspace renders with the ungrouped label. Search normalizes the query once and matches it against the row title and Workspace label.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host loader entry: the page is browser-only, so the plugin body is empty |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: locale namespace, section registration, injected Unarchive operation |
| [`src/client/ArchivedSessionsSection.tsx`](src/client/ArchivedSessionsSection.tsx) | The page component: row derivation, search, per-row Unarchive |
| [`src/client/locales.ts`](src/client/locales.ts) | Chinese and English dictionaries for every visible and accessible string |
| [`src/client/ArchivedSessionsSection.module.css`](src/client/ArchivedSessionsSection.module.css) | Page styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings surface that hosts the page, the archive write behind it, and the state it renders.

- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section` and the namespace scope service.
- [ui-settings-general](../ui-settings-general/README.md) — the Settings shell that renders the navigation and mounts the section.
- [ui-workspace](../ui-workspace/README.md) — the sidebar browser whose Session rows archive, and the `ctx.uiWorkspace` service this page restores through.
- [Workspace Controller](../../api/workspace-controller/README.md) — the `workspace.unarchiveSession` Remote and the Client model that owns the archive set.
- [Workspace subsystem](../../../docs/subsystems/workspace.md) — the durable archive set, its domain field, and the registry operation behind a restore.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace archive visibility

#### What the model sees

The page calls `workspace.unarchiveSession` to change Workspace archive visibility without writing Session messages or adding tool guidance. Restoring a Session does not send a model request or open its conversation.

#### Token effect

The page contributes no prompt text, tool schema, or tool result tokens.

#### KV Cache effect

Archive restoration does not change model history or its request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define which archived sessions this page can restore; they are current package constraints.

- **A missing Session log cannot be restored** — the fallback row can clear the archive membership or request permanent deletion, but the absent conversation cannot be recovered.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A browser-side settings page that registers one localized `settings.section` contribution and its locale namespace; it emits no Cordis events and owns no cross-plugin mutable relation.
