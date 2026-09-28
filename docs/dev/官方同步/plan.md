# RC.2 Selective Integration and Mobile Product Plan

English | [中文](plan.zh.md)

## 1. Scope and Pinned Sources

This plan separates official dsh-v0.1.7-rc.2 behavior from the independent Cinlan mobile, account, and model work. It does not authorize a wholesale upstream merge.

Official RC.2 tag commit: 477b4f420553e8a52c2fbccc464d7561b239c443.

Official RC.1 to RC.2 comparison: <https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-rc.1...dsh-v0.1.7-rc.2>.

Current Cinlan main: 60a35aa730d30186b5d4d57b8eeb82a4d946229f. Orca reference: 9c192525aaca8ab82ac751999b863ece07138676. The Orca checkout is dirty and is reference material only.

The 2026-09-20 three-way report at ../../../reports/migration/official-local-orca-differences-2026-09-20.md is earlier local/Orca context. It is not RC.2 evidence.

RC.2 release notes contain no mobile companion or Relay item. Mobile Companion, direct phone access, and cloud Relay are separate Cinlan product scope and are not marked as official RC.2 parity.

The status tables report semantic equivalence against the current source and dirty worktree. This branch is based on dsh-v0.1.7-alpha.2, and RC.2 is not its ancestor; equivalent behavior is pre-existing or Cinlan-owned rather than inherited from official RC.2 commits.

The directly requested RC.2 rows are Desktop installer startup, API Key autofill, account model editing, Windows update prompts and foregrounding, account/API Key lifecycle, and model-switch waiting feedback. Quota and balance remain adjacent decisions; every other RC.2 row stays as out-of-scope backlog. Phone pairing and Relay have no RC.2 row.

## 2. Non-Negotiable Boundaries

| Capability | Current or planned owner | Boundary |
|---|---|---|
| Mobile Companion | New Cinlan mobile client plus remote-access protocol extensions | Scans a pairing offer and controls authorized Desktop Sessions. It is not Mobile Device ADB. |
| Direct phone access | remote-access and ui-settings-pairing | Phone reaches the Desktop HTTPS listener directly. No cloud Relay is involved. |
| Relay phone access | New Cinlan Relay service and mobile transport | Desktop remains the execution host. Relay forwards encrypted frames and does not execute Harness tools. |
| Mobile Device | mobile-device, mobile-device-adb, cinlan-mobile-device | Agent controls an Android device through ADB. It is not a phone companion or Session gateway. |
| Sub2API account | api/account-controller and ui-settings-account, using credentials and authorization | Login and token refresh are account state. They are not a model provider and must not enter Session logs. |
| Model routes | llm-pi-ai plus Models settings | Explicit provider routes own model and protocol configuration. Cinlan account login does not create a default route. |
| DeepSeek | llm-deepseek plus Models settings | Optional independent provider and model route. |

## 3. Mobile Pairing Contract

Orca local-only pairing is behavioral reference for a phone connecting directly to Desktop without cloud login. Its automatic or Anywhere mode is not authority for a Cinlan wire protocol.

Relay remains deferred until verified service endpoints, assignment and entitlement ownership, credential issuance, cryptographic framing, expiry, revocation, reconnect, and shutdown contracts exist. No Relay QR fields, frames, or fallback behavior are selected in this plan.

Direct mode is implemented as an opt-in local HTTPS provider with explicit invitation, grant, expiry, revocation, and failure states. Its QR carries only the invitation id and one-time code in the URL fragment; the phone scrubs the fragment before the authenticated exchange. Tests cover local-only operation, certificate and origin checks, grant scoping, fragment handling, revoke, recovery, and cleanup.

## 4. Account and Model Implementation

| Work item | Exact owner direction | Status and acceptance |
|---|---|---|
| Sub2API login | api/account-controller and ui-settings-account use credentials and authorization; provider routes consume the current account credential | Implemented. Account Settings can start, answer, cancel, and observe the fixed Cinlan email/password flow with conditional TOTP; it reuses active keys, bounds compensating cleanup, and stores no account token in settings, React state, or Session logs. |
| CinlanAPI default route | llm-pi-ai and ui-settings-models | Deferred. The account flow does not create a model route; a verified public model catalog, base URL, and credential contract are still required before adding a CinlanAPI route or default. |
| DeepSeek option | llm-deepseek and ui-settings-models | Implemented. Native `deepseek-official` / `deepseek-flash` remains selectable and independent from any CinlanAPI route. |
| Account-funded versus API Key tasks | Session/task lifecycle owner to be named; ui-model-selection only owns selection, not task cancellation | Deferred decision. Define identity, model entries, sign-out cancellation, expired-session recovery, and quota ownership before implementation. |

## 5. Settings UI Contract

Reference Orca for grouping and task flow, not for its single-application component structure. Cinlan keeps feature-owned Settings registrations and locale-owned copy.

Account manages Sub2API state and local credential deletion; issuer-side revocation remains external. Models owns explicitly configured LLM routes and DeepSeek routes. Phone Pairing owns direct or Relay mode, QR lifecycle, device grants, and revoke. Mobile Device owns ADB status and operations.

Every row shows source, current state, failure reason, and next action. Credential values never enter React props, logs, settings.yaml, model-visible text, or Session events.

## 6. RC.2 New Features

| Release item | Decision | Owner and acceptance | Status |
|---|---|---|---|
| Scheduled reminders and run history | Complete adopted behavior | Durable definitions, overlap handling, cancellation, history, and default-off composition exist; add one-minute recurrence and full management parity. | Partial |
| Resumable Desktop first-use onboarding | Adopt | Current onboarding covers provider/model setup only; add durable Desktop first-use steps, resume, skip, and account/model ownership. | Planned |
| Shortcut view, search, edit, restore, and sidebar display | Complete adopted behavior | Keybinding view, search, editing, reset, conflicts, and platform bindings exist; sidebar hints still do not project user overrides. | Partial |
| Newly enabled tools in an active conversation | Keep current equivalent | The loop reassembles tool schemas and re-baselines logged model input when tools change; retain reconstruction coverage. | Implemented equivalent (not an RC.2 port) |
| Manual continuation after Auto review denial | Defer stable promotion decision | The prototype hard-denies review rejection; a stable owner must define human continuation and distinguish denial, execution failure, and review failure. | Decision required |
| Desktop tasks continue after window close and quit warning | Adopt after lifecycle design | Non-macOS window close requests quit; add background execution and task-aware quit confirmation with reopen and cleanup coverage. | Planned |

## 7. RC.2 Bug Fixes

| Release item | Decision | Owner and acceptance | Status |
|---|---|---|---|
| Windows file menu icon and associated-app open | Complete adopted behavior | OS-default opening exists; add associated-application discovery, menu icons, and fallback coverage. | Partial |
| Desktop installer startup failure | Adopt in the existing package pipeline | Windows release output is NSIS-only, checks for a running app before extraction, and fails closed with localized copy; focused packaging tests pin the early check and explicit unsigned verification path. | Implemented selectively |
| Plugin detail/settings information and startup diagnostics | Keep current equivalent | Current manifest resolution, plugin inventory, and startup diagnostics cover missing and failed plugins through the app-boot architecture. | Implemented equivalent (not an RC.2 port) |
| Credential autofill into API Key fields | Adopt with security review | API Key inputs use opaque password-field semantics, `autocomplete=new-password`, disabled autocapitalization and spellcheck, with focused attribute coverage. | Implemented selectively |
| Local Markdown image preview and zoom | Keep current equivalent | Conversation Markdown resolves confined local images and opens supported images in the existing zoom path, with client and Web coverage. | Implemented equivalent (not an RC.2 port) |
| GitHub plugin installation fallback | Adopt | Current installation is registry-only; add mirror identity, fallback, and alternate-method recovery coverage. | Planned |
| Account model editing | Complete adopted behavior | Generic provider/model editing and Sub2API-backed routing exist; account-specific catalog and editing behavior remain incomplete. | Partial |
| Platform confirmation memory in Desktop | Defer owner decision | No embedded Platform owner exists; define scope, expiry, persistence, and logout cleanup before implementation. | Decision required |
| Quota message matched to task identity | Defer owner decision | Account/task/quota ownership and funding identity remain undefined; Models settings must not infer billing ownership. | Decision required |
| Windows update prompts and foregrounding | Keep current equivalent | The updater presents restart copy, checks running work, installs through the Desktop lifecycle, and foregrounds the restarted window. | Implemented equivalent (not an RC.2 port) |
| Localized workspace folder display names | Keep current equivalent | Workspace paths and stable ids are locale-independent; display titles derive from the path or explicit user choice. | Implemented equivalent (not an RC.2 port) |
| macOS title-bar drag behavior | Keep current equivalent | Desktop uses a native framed BrowserWindow, so the custom hidden-titlebar drag defect is structurally absent. | Implemented equivalent (not an RC.2 port) |
| Agent guidance for enabling plugins and features | Keep current equivalent | Plugin-manager guidance names exact identifiers and profile effects; the shipped Cordis development skill owns extension guidance. | Implemented equivalent (not an RC.2 port) |
| Voice input not-ready guidance | Adopt | The microphone control is hidden until voice input is ready; add an unready route to voice settings. | Planned |
| Workspace Windows directory links | Adopt | Workspace file access rejects final symlinks; add confined Windows directory-link navigation and path coverage. | Planned |
| Recovery after crash or interrupted plugin install | Adopt | Atomic writes time out without reclaiming an exited owner lock; add verified dead-owner takeover for save and install. | Planned |
| Long tool output character corruption | Complete adopted behavior | Byte-oriented retention is Unicode-safe, but character-capped tool paths still slice UTF-16 strings; cover every retained-output path. | Partial |
| Slow account balance refresh | Defer owner decision | No account-balance service or UI owner exists; keep this as account UX rather than provider routing. | Decision required |
| Long conversations unable to send | Verify before change | No request-extension size cap or degradation path exists; reproduce the transport limit before changing shared request behavior. | Planned |

## 8. RC.2 Changes

| Release item | Decision | Owner and acceptance | Status |
|---|---|---|---|
| Enable Auto review from Plugins page; remove Inspector from default | Adopt with releaseability decision | Plugin copy offers Auto review and Inspector is not shipped by default, but Auto review remains a private experimental package without a stable release owner. | Decision required |
| Separate account-funded and API Key model entries; stop account tasks on logout; prompt expired login | Defer until account task owner is named | Sub2API credential-to-key exchange exists; durable account entries, task cancellation on logout, and expired-login recovery do not. | Decision required |
| Coding Tools controls trajectory, code changes, and new-task mode | Defer owner split | No unified Coding Tools control exists; assign saved defaults, activity view, and tool-card ownership before implementation. | Decision required |
| Time context refreshes every ten minutes when enabled; custom interval remains | Complete adopted behavior | Explicit custom intervals work, but an omitted or zero interval injects on every eligible attempt instead of every ten minutes. | Partial |
| Scheduled tasks and time context disabled by default on Web/Desktop | Keep current equivalent | Shipped Web and Desktop composition leaves schedule and time context disabled unless a profile explicitly opts in. | Implemented equivalent (not an RC.2 port) |
| Reduce fixed Standard-mode prompt token overhead | Verify with snapshot | Tool and system-prompt descriptions retain the larger fixed instruction set; preserve required guidance while reducing measured snapshots. | Planned |

## 9. RC.2 Improvements

| Release item | Decision | Owner direction and evidence | Status |
|---|---|---|---|
| Archive filters and empty archived-workspace hiding | Complete adopted behavior | Archived sessions are hidden from the normal tree; add all/active/archived filtering and archived-empty workspace handling. | Partial |
| Consistent syntax highlighting for tools, previews, and diffs | Complete adopted behavior | Shared Shiki highlighting covers common code blocks, but tool, preview, and diff language ownership is not unified. | Partial |
| Clearer document preview loading and spacing | Complete adopted behavior | The Cinlan Office/PDF preview has localized loading and error states; RC.2 placeholder, spacing, and light-background parity remains incomplete. | Partial |
| Unified corners, menus, hover, compact diffs, and focus indication | Complete adopted behavior | Shared tokens and keyboard focus-visible behavior exist; the full cross-feature visual and compact-diff set remains incomplete. | Partial |
| Model switch waiting feedback | Complete adopted behavior | The fixed trigger slot shows an ongoing indicator and localized live status while selection disables conflicting controls; focused tests cover pending success and failure recovery. | Implemented selectively |
| One skipped-incompatible-plugin notice per startup | Adopt | No once-per-startup skipped-bundle notification lifecycle exists; add deduplication and lifecycle coverage. | Planned |
| Registry or mirror label and duplicate option merging | Adopt | The current manager has no mirror source model or duplicate source-choice merging. | Planned |
| Localized approval explanations and model-language guidance | Complete adopted behavior | Approval chrome is localized, but explanation text has no user-language guidance or equivalent visible-copy snapshot. | Partial |
| Open fetched URL directly from collapsed tool card | Adopt | The collapsed fetch summary is plain text; its external link is available only after expansion. | Planned |
| Consistent Chinese 子智能体 terminology in plugin management and settings | Adopt outside direct scope | Absent: affected Chinese plugin and settings copy still uses 子代理; replace it with 子智能体 consistently. | Planned |

## 10. Delivery and Cleanup

1. Freeze the release matrix, selected upstream commit, current main commit, and Orca reference commit.
2. Keep the reachable Sub2API Account flow secret-free and verify its provider credential handoff.
3. Retain explicit OpenAI Responses adapter coverage; add a CinlanAPI route only after its base URL, credential owner, and model catalog are verified.
4. Verify direct phone QR pairing; keep Relay deferred until its transport, authorization, and entitlement contracts are verified.
5. Keep Account, Models, Phone Pairing, and Mobile Device Settings as separate feature-owned sections.
6. Port RC.2 rows as isolated owner changes. Update the owning README, JSDoc, Agent Note, locale pair, and snapshots for each non-trivial behavior.
7. Run focused tests, strict typechecks, Loader/profile composition, keyless replay, clean build, package-set checks, verify-translation-pairing --write for every changed pair, test:docs, doc-sync, and Windows x64 packaging. Do not run test:e2e unless requested.

This plan never deletes a registered or user-owned worktree. Integration-created empty temporary directories and stale generated target outputs may be removed. Any worktree removal requires commit reachability, unique source/test inventory, evidence retention, user-file review, and explicit owner authorization. Dirty merge-final, overlay-check, rebase-check, and Orca directories are not deletion candidates.

## 11. Open Decisions

- Production Sub2API base URL and supported login response variants.
- CinlanAPI production base URL, credential source, and initial model catalog.
- Whether Relay is default or explicit opt-in.
- Default phone operations after pairing.
- Stable owner and releaseability for Auto review, Inspector, account task lifecycle, quota, and Coding Tools.
- Which clean worktrees may be deleted after the inventory gate passes.
