---
description: "Edit startup and live rendering preferences for integrated sidebar terminals in Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-terminal

English | [中文](README.zh.md)

## Summary

Configure integrated sidebar terminals from Settings → Experimental → Terminal. The page reads and edits the existing `dsh-better-sidebar` namespace and enables its form only after the current sidebar Host confirms terminal availability.

## Table of Contents

- [Use this package](#use-this-package)
- [Preferences and timing](#preferences-and-timing)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount alongside Settings, Locale, and the optional sidebar Client service. The sidebar Host owns the preference schema and PTY processes. This package contributes the localized page, public search labels, and reset confirmation; it registers no separate preference document. Web and Desktop use the same authenticated sidebar terminal service; a missing native dependency or unavailable Remote keeps the form disabled.

Save retains the revision from the first edit and writes only changed fields. Changes use the shared SettingsScope queue and conflict recovery. A success message requires Host acceptance and matching raw and effective values; unchanged overrides do not send a write or show a saved message. A rejected write shows the latest Host values for review. Restore inherited preferences asks for confirmation, then removes only the seven terminal overrides; unrelated sidebar preferences remain stored. Read-only or unavailable namespaces cannot be changed.

<a id="preferences-and-timing"></a>
## Preferences and timing

| Preference | Default and effect |
|---|---|
| Shell executable and arguments | Empty strings inherit Host configuration. New UI and agent-owned sidebar terminals consume them at creation; arguments split on whitespace. |
| Font family and size | Empty family follows the theme monospace font; size defaults to 13 px within 9–32 px. Open views update and resize their grid. |
| Scrollback | 4,000 retained lines by default, from 0 to 100,000. Lowering the value discards older displayed lines. |
| Cursor style and blinking | Block cursor with blinking enabled. Open xterm views update immediately. |

Main and agent terminals use the session working directory. Floating Workspace settings can choose an existing subdirectory for new UI terminals in that window; the Host validates it inside the session workspace. A stream reconnect attaches to the existing live process and retains its captured directory. Closing a terminal releases that process; restarting the Host creates fresh processes on the next connection and cannot restore running commands. Core execution-tool settings are owned separately.

<a id="dev-note"></a>
## Dev Note

[Component and registration tests](tests/) cover both languages, capability gating, revision-fenced changes, reset confirmation, rejected writes, and disposal. The Client Loader test composes the real SettingsScope provider and verifies conflict recovery and no-op writes; an owner-local snapshot pins the unavailable Chinese page. The [sidebar Loader regression](../ui-better-sidebar/tests/terminal-settings-loader.spec.ts) boots real Settings, tools, and sidebar source without Web services and verifies persisted shell choices at both PTY creation paths. The native PTY adapter is the external process test double. [Renderer tests](../ui-better-sidebar/tests/terminal-preferences.spec.tsx) check live consumers and the installed xterm option setters. No runtime invariant companion is published because the page owns only drafts and derives persisted state from SettingsScope. See [Web Client](../../../docs/subsystems/web-client.md) for the shared framework.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the existing agent-terminal tools using saved shell preferences, without this page adding tools, messages, or model context.

#### KV Cache effect

No direct effect: viewing or editing preferences adds no prompt tokens, and subsequent tool results remain logged by their existing owner.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Availability requires the authenticated sidebar terminal Remote and a working native PTY dependency. The capability check does not create a terminal or prove that a custom executable will start.
- Shell arguments use the existing whitespace separator; quoted arguments containing spaces are unsupported. Executable discovery and a separate default-directory preference are not provided.
- Font names follow browser CSS font resolution; saving a name does not install a font.
- Process restoration after Host shutdown is not supported.
