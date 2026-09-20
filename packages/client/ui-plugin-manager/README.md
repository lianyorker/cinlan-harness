---
description: "Manage Web profile plugins from the existing Settings Plugins tab, with installation diagnostics, explicit script approval, and removal confirmation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-plugin-manager

English | [中文](README.zh.md)

## Summary

Inspect installed bundles, enable or disable plugins, and install or remove bundles from Settings → Plugins → Management. Installation shows Host diagnostics and requests explicit approval when dependency scripts are blocked. Removal requires confirmation and is offered only for packages the Host marks removable. Web package actions affect the current profile. Desktop supports live plugin row enablement; Add plugin opens its native Plugins window for package changes.

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

The Web bundle mounts this plugin automatically in the existing Plugins settings section. Custom compositions mount it as a Cordis plugin alongside the Settings shell, locale service, Remote client, and Host plugin manager. The plugin has no configuration fields.

### Manage a profile

Open Management to load the current profile inventory. Enablement and installation outcomes distinguish applied changes, restart requirements, higher-priority overrides, and failures. An installation must return its package identity before the UI reports success. Configuration forms remain contributed by their feature owners. A changed, applied Desktop row toggle refreshes the renderer after inventory settles, preserving its current URL while the Host stays alive.

The Web install dialog checks the requested package, displays streamed diagnostics, and allows cancellation while installation is running. If dependency scripts need permission, review the listed package names and explicitly approve a retry. Uninstall opens a separate confirmation before sending the request; protected packages have no uninstall action.

### Availability and failures

Without the managed-profile Remote services, the tab shows an unavailable state and Settings remains usable. Desktop uses `dshDesktop.openPlugins()` only at `dsh-app://app`; when the opener is absent, Add plugin shows localized instructions to open Desktop Plugins from the application menu. The Host refuses Desktop package inspection, installation, removal, and bundle selection. Transport failures and Host refusals surface as errors; an unconfirmed cancellation does not appear successful. Follow the Host diagnostics before retrying.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The client requires only slots and locale at activation and binds Remote events through `ctx.inject` when available. It registers `settings.plugins.tab` with id `management` and order `20`; the Settings shell continues to own page layout and navigation. The controller loads lazily and refreshes observed inventory after Host changes or connection resets.

Feature plugins contribute `plugins.item`, `plugins.bundle.config`, and `plugins.row.config` slots. This package renders those contributions and delegates mutations to [the Host manager](../../boot/plugin-manager/README.md); it owns neither profile files nor package transactions.

| Source | Responsibility |
|---|---|
| [index.ts](src/client/index.ts) | Settings registration and optional Remote lifetime |
| [manager-store.ts](src/client/manager-store.ts) | Inventory, requests, installation progress, and outcomes |
| [InstallDialog.tsx](src/client/InstallDialog.tsx) | Diagnostics, cancellation, and explicit script approval |
| [slot-contract.ts](src/client/slot-contract.ts) | Feature-owned configuration contributions |

**Runtime invariant:** No companion is published. UI state projects Host results, and registrations are effects owned by the slot registry; there is no independent durable state to reconcile.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin manager](../../boot/plugin-manager/README.md) — profile ownership and package operations.
- [Plugin settings](../ui-settings-plugins/README.md) — the surrounding Plugins settings section.
- [Settings](../ui-settings/README.md) — persistence and navigation for feature-owned forms.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the managed plugins whose own tools and prompt contributions enter later model requests.

#### KV Cache effect

The UI adds no model request content. Changing plugin enablement can change later tool declarations or prompt contributions and their cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The available actions follow the Host's profile policy:

- Desktop package mutations use the native shell's transaction path.
- Changes are profile-wide; agent presets remain read-only.
- Some changes require a Host restart, and higher-priority patches can override profile edits.
- Cancelled or failed installations can retain downloaded files and diagnostic logs; the Host owns restoration guarantees.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
