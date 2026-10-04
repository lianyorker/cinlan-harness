# Agent Note: Browser settings present Browser Use setup and live preferences

Status: implemented

English | [中文](2026-10-03-browser-settings-provider-activation.zh.md)

## Problem

Settings → Browser rendered "No matching provider entry is configured" for a profile whose composition plainly loaded the browser capability, every Browser preference field read "unavailable", and the runtime block led with install and repair.

Measured on the local `web` profile before the change: `pluginManager.listPlugins()` returned `include:browser-playwright` with `moduleName: '@deepseek-ai/dsh-browser-playwright'`, `enabled: true`, `fiberPhase: 'active'`, so the Host inventory was correct. The client block filtered that list by one exact module specifier per capability, so any deployment that obtains the same capability from a bundle row, a renamed provider row, or the capture tool reported the capability as unconfigured. A matched entry the profile patch cannot address (`readOnlyReason: 'unaddressable'`) only disabled its button, so the block still read as broken.

The preference and link-routing forms bind a settings namespace through `settingsScope.bind`. The settings service publishes a namespace only for a Loader entry whose Config schema carries a volatile field, and `@deepseek-ai/dsh-browser-playwright` declared none: `describe()` listed 24 namespaces without `browser-playwright`, so both forms fell to their unavailable state and nothing could be saved.

## Decision

**Capability entries match by role, not by one module specifier.** [capability-matchers.ts](../../../../packages/client/ui-settings-security/src/client/capability-matchers.ts) holds `CAPABILITY_MATCHERS` for the page's component diagnostics and `PROVIDER_MATCHERS` for the entries one page can activate. Each pattern names the packages that provide the capability and the bundle that composes them as one row (`@deepseek-ai/dsh-cinlan-browser`, `@deepseek-ai/dsh-cinlan-computer-use`, `@deepseek-ai/dsh-cinlan-mobile-device`). A matched entry with a `readOnlyReason` renders its runtime status and one profile-managed line instead of a control, so a bundle-managed deployment reports "loaded" rather than "unconfigured". The Plugin Manager callbacks every activation control consumes live in [capability-shared.ts](../../../../packages/client/ui-settings-security/src/client/capability-shared.ts); the standalone block that printed every matched entry is gone, because each page owns the entries it presents.

**The browser entry owns a live settings namespace.** The eight user preference fields of `@deepseek-ai/dsh-browser-playwright`'s Config are `volatile()`, which is what makes the settings service serve the `browser-playwright` namespace; `apply()` registers `settings.configure({ auto: false })` so the page's own form is the only editor and no generated configuration page duplicates it. Configuration reads unwrap the Loader's live reference through `configValue`, so a value edited through the namespace and a plain `cordis.yml` value resolve identically ([index.ts](../../../../packages/browser/browser-playwright/src/index.ts)).

**An existing session is an explicit attach mode.** `attach` plus `attachPort` make the provider reach a running Chromium through `chromium.connectOverCDP` instead of launching its own persistent browser, so an agent works in the session the person is already signed in to. The attached browser belongs to the person: the provider takes a release hook, and disposal disconnects Playwright (`browser.close()` on the CDP connection) rather than closing the attached context. An attach failure names the endpoint and the `--remote-debugging-port` value to start it with. The managed runtime lease is not acquired in this mode.

**Stored profiles are listed by their owner and closed by their own action.** The provider answers a profile roster over the capability seam (`BrowserProvider.listProfiles` → `browser.listProfiles`), so the settings page offers the profiles the Host actually keeps — `default` plus every `storageDir/harness-profiles/profile-<name>` directory — and marks whether the selection exists yet instead of asking for a name blind. The roster carries no directory over the Remote. When attachment is on, the runtime section reports the connection and offers Disconnect rather than Close, because disposal detaches.

**A new `zoom` preference is a real launch input.** `zoom` (0.25–5, default 1) ships in `BrowserPreferences`; the provider lays the page out at `viewport / zoom` and rasterizes at the configured size, so a zoom above 1 enlarges every rendered pixel an agent reads while screenshots keep the configured dimensions.

**The page presents Browser Use as three user-facing steps.** The setup card reports 0/3 progress across Browser Use activation, the tool-browser skill entry, and a successful Cookie import; the skill step shows the official update command and the page copies it instead of executing a local shell command. The examples block contains three copyable prompts. Home page, search engine, default zoom, chat link routing, and stored profiles remain separate settings. Provider inventory, runtime installation, connection, page inspection, history, network, and transfer operations live under the Advanced disclosure.

**Computer Use uses the official skill surface, not an experimental Provider form.** The official `@deepseek-ai/dsh-computer-use` capability is supplied through the optional `@deepseek-ai/dsh-cinlan-computer-use` bundle. The Settings page uses the Security Research-style download card, shows `cinlan skills update --skill computer-use` as the official update command, and keeps profile-bundle installation state and runtime details visible. The page does not render the experimental CUA Provider activation block.

**Mobile Emulator is one setup card plus one agent card.** The setup card holds the page-check switch, availability with its status badge and re-check, the Android SDK row with download, use-detected, and clear actions, the custom SDK path, and the default device. The agent card tracks the capability entry and the tool entry as two steps with a 0/2 badge, lists `dsh --profile device-control` and the `mobile_*` tool names, and offers three copyable example prompts. Availability and toolchain probes stay read-only; only the switch, the SDK path, and the default device join the draft form.

**Runtime maintenance is demoted.** Install, repair, remove, cancel, and close-browser moved behind a `details` element labelled "Details and maintenance"; the runtime source, version, revision, and installation facts stay visible. The page presents the capability as composed, not as something to download.

**Link routing uses the chat-owned preference.** The section reads and writes `ui-chat`'s `linkOpening` ("in-app sidebar browser" or "new system-browser tab") instead of a second copy of the same decision under `dsh-better-sidebar`, which this composition never mounts. The in-app option needs the shipped `ui-sidebar-browser` entry, so the section reads that entry through the Plugin Manager and offers the one activation action when it is present, disabled, and addressable, stating that links stay closed until then.

## Alternatives considered

- **Mount `dsh-better-sidebar` in the web profile so routing works everywhere.** Rejected: its host half calls `settings.register(ns, schema)`, an API this checkout's settings service does not implement, so the namespace would still not appear and the entry would fail activation.
- **Keep the exact module match and add a fallback list of provider names.** Rejected: a bundle row is a first-class provider of the capability, and a name list only moves the same staleness.
- **Store `zoom` without a consumer.** Rejected: a preference that changes nothing is worse than no preference.
- **Add a separate settings-owner package for the browser namespace** (the `dsh-git-settings` pattern). Rejected for scope: marking the provider's own preference fields volatile reaches the same namespace without a new workspace package and an extra profile row.

## Consequences

- Saving from the page writes the whole `browser-playwright` row into the profile patch, because the configuration editor materializes an entry inherited from a bundle layer. Values equal to the composition defaults change no behavior.
- Saved preferences apply after a restart of the current profile, which the page states.
- Enablement never launches a browser, and a successful save never grants an operation approval.
- Link routing writes the official chat preference, so a routed link opens where the chat and the in-app browser already agree it should; the in-app option is inert until `ui-sidebar-browser` is enabled, which the page now offers in place.

## Testing

- `node_modules/.bin/vitest.CMD run packages/client/ui-settings-security` — 131 tests, including a bundle-provided provider row that must report loaded plus the profile-managed line rather than the unconfigured copy, the default-zoom draft/save path in both languages, the existing-session switch with its port, and profile selection, creation, rejection, and the Host-cannot-list fallback.
- `node_modules/.bin/vitest.CMD run packages/browser/browser-playwright` — 66 tests, including zoom validation, volatile-reference reads, the zoomed launch viewport, mounting without a settings provider, and attaching to an existing browser (the CDP endpoint is named, and disposal calls the connection's own close instead of the attached context's).
- `node_modules/.bin/tsc.CMD -b` for both packages, and `node --import tsx/esm scripts/verify-client-ui-i18n.ts` with no hit in `packages/client/ui-settings-security`.
- Live `--profile web` run: the profile control listed the stored roster, creating `research` from the page wrote `profileName: research` into the profile patch, and the field read it back after a restart; with attachment on, the runtime section showed the connected note.
- Live `--profile web` run on a Chrome started with `--remote-debugging-port=9222`: saving the attachment switch wrote `attach: true` and `attachPort: 9222` into the profile patch, the restarted profile listed that browser's real tab in the page selector, and the attached Chrome answered `/json/version` after the Host process exited, so disposal detached instead of closing it.
- Live `--profile web` run: the activation block shows `@deepseek-ai/dsh-browser-playwright` loaded with a disable control; the preference form renders editable controls including default zoom; saving 1.5 wrote `zoom: 1.5` into the profile patch and the field read it back; the runtime block shows a collapsed "Details and maintenance" disclosure.
