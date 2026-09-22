# Agent Note: Own floating windows and shortcut dispatch in their consuming features

Status: implemented

English | [中文](2026-09-17-floating-workspace-command-ownership.zh.md)

## Problem

`floating-workspace` stores window preferences, and `keybindings.overrides` stores command preferences. A saved record cannot establish a live window, an editor action, or a terminal consumer. Presenting every stored command as available would promise actions that no mounted feature can perform.

A second view also needs an owner for its Session selection, native window, and terminal identity. Opening it must preserve the application composition and existing Session while allowing the opener, settings owner, and operating system to end its lifetime independently.

## Decision

### One child of the existing application

The floating workspace opens the same application artifact through its existing transport. Web reuses the current origin and application pathname; Electron reuses the installed `dsh-app` document and existing preload. The child receives a validated window UUID and the originating Session id through a restricted route. It selects that existing Session once its catalog is ready, then retains normal independent navigation. Opening the view creates neither a Session nor a second Host or frontend.

Each opener owns one exact child handle. Enabling the preference only makes opening available; an explicit user action creates the window. Accepted disable, owner disposal, page exit, and native Host shutdown close the owned child. An ordinary child close restores focus to the connected invoking control. Position changes move the opening entry, while width and height changes apply to the next open. The child exposes its close control and omits opening entries and the floating toggle command, preventing recursive windows.

The Settings section exposes enablement, terminal directory, and entry position in one preference card. It does not expose window geometry or a second open/close action. Persisted width and height remain accepted runtime fields for the next child, while the shell entry and registered shortcut own window creation.

Electron admits this child through the main window policy with the expected document, frame name, route fields, and bounded window features. It preserves the sandbox and returns the actual created child webContents to Electron. Navigation, redirects, and further window creation cannot turn the child into another native launcher. Plugin-manager and unrelated window policies retain their own restrictions. Browser refusal and missing platform support remain explicit blocked or unavailable states.

### Commands belong to their live consumers

The [keyboard service](../../../../packages/client/keyboard/README.md) owns command registration, effective bindings, validation, and matching. Each feature supplies its localized command metadata, defaults, scope, availability, and disposer. Existing Lexical composer handlers, CodeMirror save and search handlers, and shell handlers ask the matcher about an event and perform their own action. Their local focus, completion, composition, and submit rules still decide whether an action can run. The main view owns `floatingWorkspace.toggle`, with Ctrl+Shift+Space as its default.

An explicit override replaces the registered default bindings; a null binding unbinds the command. Persisted ids without a mounted command remain visible as unavailable and survive unrelated edits. A legacy record therefore preserves a preference without installing an action. Reserved combinations and conflicts are reported rather than silently rewritten. Recording is local to its recorder, and resets remove user overrides so the owning defaults or configured base can resolve again.

### Capture terminal context when creating the tab

The floating context exposes validated window identity before preference loading finishes. Sidebar state can therefore use the correct window namespace from its creation, without temporarily sharing the main view. Only the real terminal consumer advertises directory support. A new floating terminal tab captures the window id and accepted directory together; loading or unavailable preferences cannot supply a provisional directory. The captured data stays with that tab across rendering and reconnection, and later preference changes affect new tabs. An empty directory requests the associated Session working directory. Terminal execution and directory validation remain with the terminal owner described by the [native runtime consumer decision](2026-09-17-native-settings-runtime-consumers.md).

Persistence follows the [Host preference decision](../bug-fix/2026-08-06-host-backed-web-preferences.md), and installed runtime ownership follows the [Desktop packaging decision](2026-08-25-electron-desktop-packaging-and-updates.md). The archived [Lexical editor decision](../../archived/architecture/2026-08-20-web-composer-lexical-editor.md) supplies historical context for choosing the editing engine; the [current conversation reference](../../../../docs/subsystems/conversation.md) owns its supported behavior. Those records retain their separate persistence, distribution, and editing rationale.

## Alternatives considered

**A separate floating frontend or Desktop HTTP server.** Either introduces another application composition or transport for an additional view of the same Session. Reusing the artifact preserves the installed client, authentication, and feature owners.

**A global shortcut dispatcher driven by saved ids.** It cannot establish whether an editor, composer popup, or feature can act, and can race the focused handler. Registration exposes actual capabilities; matching leaves execution and event arbitration with the consumer.

**Deriving window identity or terminal directories from the latest rendered settings.** Identity would arrive after sidebar state can be created, and a later preference could change an existing tab on reconnect. Early identity and creation-time directory capture preserve the association between a window, a tab, and its Session.

**Launching and sizing the child from Settings.** A Settings-owned action duplicates the shell command and its focus restoration path, while editable dimensions imply precision that the browser or operating system may reject. The compact page edits preferences that place the command and initialize terminals; persisted geometry remains available to deployment configuration and the runtime.

## Consequences

A plugin unload removes its commands, subscriptions, and window contributions together. Unavailable persisted commands remain inspectable without pretending to execute. The Settings section has three searchable rows and no launch or geometry controls. Platform policies can refuse a window or adjust its requested geometry, so the opening entry must report the actual outcome. An additional view shares durable Session data while retaining its own view state and resource lifetime.

Window and keyboard preference records add no model-facing prompts or Session events. Invoked composer, editor, and terminal operations retain the behavior and authority of their existing owners. Window UUIDs distinguish view and terminal ownership; access to a terminal remains associated with its Session.
