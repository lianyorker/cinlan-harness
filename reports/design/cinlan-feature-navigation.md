---
description: "Cinlan Settings navigation architecture and feature ownership for the clh Web composition."
kind: "architecture"
---

# Cinlan settings architecture

English | [中文](cinlan-feature-navigation.zh.md)

## Summary

Cinlan uses one full-page Settings destination with seven product groups. This document serves as the source of truth for navigation rules and design rationale. The shell owns grouping, search, focus, responsive navigation, and the selected section; feature packages own their controls, persistence, capability status, and localized metadata. Profile composition keeps identical package and namespace contracts, so a profile can omit a capability without creating a dead page.

## Table of Contents

- [Security and execution assumptions](#security-and-execution-assumptions)
- [Navigation groups](#navigation-groups)
- [Shell behavior](#shell-behavior)
- [Feature ownership](#feature-ownership)
- [Assembly and verification](#assembly-and-verification)
- [Further exploration](#further-exploration)
- [Dev Note](#dev-note)

## Security and execution assumptions

The RPC caller is an authenticated local machine user, not a multi-tenant client. Remote endpoints trust the local loopback boundary established by the session and host boot process. Security research, terminal execution, and process orchestration operate under the invoking user's OS privileges without introducing internal privilege boundaries.

## Navigation groups

| Group | Section responsibilities |
|---|---|
| Personal | General, Voice, Floating workspace, Account, and Keybindings |
| Agents | Models, Agent presets, Agent loop, and Subagents |
| Workspace | Terminal, Git, Worktree (pending implementation), Workspace isolation, Task sources, and Files |
| Execution & security | Permissions & approvals and Execution hosts |
| Tools & devices | Browser, Computer Use, Mobile (pending implementation), Security Research, and optional Desktop phone pairing (pending implementation) |
| Connections & extensions | Integrations, MCP, Web search, and future Skills (pending implementation) |
| Data & advanced | Usage, Archived sessions, Runtime diagnostics, and Plugins & Bundles |

The seven group ids are personal, ai, workspace, execution, tools, extensions, and advanced. Section ids, settings namespaces, save/reset operations, and Remote method names remain owned by their feature packages. A feature registers a section and its searchable fields in one effect lifetime; disposing the feature removes both contributions.

## Shell behavior

ui-settings-general renders a full-page route beside the application root. The navigation rail and the content column scroll independently, and narrow windows move the rail into a drawer. Search indexes localized public labels, descriptions, keywords, and stable anchors; it never reads setting values or secrets. Selecting a result opens the owning section, selects its tab when needed, and focuses the registered anchor.

Section metadata declares top-level heading ownership. The shell adds headings to compact legacy pages; feature-owned pages retain their native heading hierarchy, so adding a page does not require a section-id list in the shell.

ui-settings remains the settings data and metadata base. It provides the shared settings mirror, schema operations, section slots, item metadata, and launcher contract. The shell does not duplicate feature forms, infer Host capabilities, or maintain a central route table.

## Feature ownership

Models and Agent presets live under Agents and keep their existing Remote and durable settings owners. Permissions, shell, agent-loop, subagent, and web-search pages are registered directly as top-level sections in their respective product groups; historical plugins.item registrations and fallback union types have been completely retired. Runtime settings is a first-class Data & advanced section; the Plugins entry remains a compatibility launcher for deployments that still expose it.

Keybindings is the one shortcut destination. Its Personal section renders the window-local shortcut reference inline, and the Mod+/ overlay opens the same component, so both surfaces list the same application commands and fixed input actions. General Settings contributes no shortcut row; commands registered with the keyboard service appear in an Other actions group inside that reference.

Task automation and scheduling are decoupled across two packages. The automation Host keeps unattended execution and preset-driven dispatch but mounts no client UI, so the official schedule package is the only automation surface: its Task Manager panel, task detail, and Session cards. Settings carries the automation bundle's switch under Execution & security, while the official schedule package keeps the Task Manager panel, task detail, and Session cards.

Capability pages follow a strict two-layer guard model:
1. Presence Guard: Driven by Bundle mounting. If a capability's Bundle is not mounted in the current profile, its UI section is completely omitted from Settings navigation.
2. Readiness Guard: Driven by runtime environment checks. When a Bundle is mounted but host prerequisites (e.g., ADB, screen capture permissions) are missing, the page renders with diagnostic guidance rather than broken controls.

The optional phone-pairing page additionally requires the dsh-app: Desktop carrier and a loopback Host; the default Web/CLH composition does not mount its pairing controller or Settings row. The Web bundle mounts the Remote assembly and the optional voice, security, Git, and sidebar providers through cordis.patch.yml; clh keeps the same rows and profile-specific enablement.

## Assembly and verification

packages/api/remotes mounts each selected generated Host Remote exactly once, including workspace isolation, worktree tasks, device capabilities, security research, work items, browser, integrations, usage, voice, MCP, execution hosts, and sidebar Git/terminal services. Phone pairing stays outside this default assembly; an explicit profile must compose its pairing controller and Client page together.

Focused UI tests cover metadata grouping, full-page navigation, search targets, runtime sections, and schedule task management. Remote assembly is checked by the Client type graph and the generated-contract build. Full application tests still depend on their existing browser and external-service fixtures.

## Further exploration

- [Settings metadata Agent Note](../../.agents/notes/implemented/architecture/2026-09-17-settings-navigation-metadata.md)
- [Feature-owned settings Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-feature-settings-navigation.md)
- [Durable automation ownership](../../.agents/notes/implemented/architecture/2026-09-17-durable-automation-ownership.md)

## Dev Note

This report is the source of truth for navigation rules and design rationale. Package READMEs and implemented Agent Notes own exact API, persistence, and composition contracts.
