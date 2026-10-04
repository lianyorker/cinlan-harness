# Agent Note: One shortcut reference surface

Status: implemented

English | [中文](2026-10-02-single-shortcut-reference-surface.zh.md)

## Problem

The Web client shipped two shortcut surfaces with disjoint data. The General Settings row opened the window-local shortcut reference owned by `ui-shortcuts`, which lists every command registered with the `shortcuts` service plus the read-only fixed input actions. A separate Personal `keybindings` section owned by `ui-keybindings` listed only commands registered with the newer `keyboard` service. A user could open "Keybindings" and see one command, then open the reference from General Settings and see the whole catalog, with no way to tell which surface was authoritative.

## Decision

`ui-shortcuts` owns the single shortcut reference. Its plugin registers the Personal `keybindings` settings section and one presentation component renders it; the same component renders inside the `shell.overlay` dialog that the `shortcuts.open` command (Mod+/) opens. The two surfaces therefore show identical rows and identical editing behavior.

The reference lists the window-local `shortcuts` catalog first, in its fixed product order and groups, then an "Other actions" group for commands registered with the `keyboard` service. Keyboard rows keep their own write path: Record, Unbind, and Restore default call `keyboard.capture`, `keyboard.setBinding`, and `keyboard.resetBinding`, and the group exposes one Restore all defaults once any command carries a saved override. The window-local footer keeps its existing reset-all flow and override count.

General Settings no longer contributes a shortcut row: `ui-shortcuts` stops registering into `settings.general.item`. The plugin registers the section metadata and its searchable items under the `settings.section` slot lifetime, so disposing the plugin removes the page, its search entries, and the overlay together.

`ui-keybindings` is deleted. The `keyboard` service and its consumers are unchanged.

## Alternatives considered

**Keep `ui-keybindings` as the page and render the window-local reference inside it.** The reference component, its inline physical-key recorder, and its reset confirmation live in `ui-shortcuts`; a feature plugin cannot import another feature plugin's runtime values, so this would have required moving the whole presentation — and its desktop recording bridge — into `ui-keybindings` for no behavioral gain.

**Keep both pages and merge only their data.** Two editors over two durable stores on one page keeps the split the user reported, and duplicating the union mapping in both packages invites the two surfaces to drift again.

**Make the window-local reference the only surface and delete the `keyboard` rows.** This drops the only editor for `floatingWorkspace.toggle`, which is registered through the keyboard service.

**Replace the General row with a launcher that opens the page.** The row itself was the duplicate: two entries for one product concept. Removing it leaves one place to look.

## Consequences

One page now covers every customizable shortcut, and the Mod+/ overlay shows exactly what that page shows, so a user comparing the two sees the same content. The window-local catalog stays the primary list, per its role as the official reference.

The unified list presents two editing models side by side: window-local rows open the inline physical-key recorder, while keyboard rows use their own Record/Unbind/Restore controls. That asymmetry mirrors the two registries the composition still mounts, and disappears when the remaining window-local owners migrate to the keyboard service.

Retiring `ui-keybindings` removes one package, its bundle row, and its dependency edge from the Web app bundle.

## Testing

`packages/client/ui-shortcuts/tests/reference.client.spec.tsx` renders the page variant and the dialog from the same props, covering search filtering across both registries, the keyboard row recorder through `keyboard.capture`, and the unchanged window-local editing flows. `commands.client.spec.ts` asserts the assembled composition registers the `keybindings` section and no longer contributes a `settings.general.item` row.
