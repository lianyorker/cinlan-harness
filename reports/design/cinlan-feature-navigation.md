---
description: "Cinlan Settings navigation architecture and feature ownership for the clh Web composition."
kind: "architecture"
---

# Cinlan settings architecture

## Summary

Cinlan uses one full-page Settings destination with five product groups. The shell owns grouping, search, focus, responsive navigation, and the selected section; feature packages own their controls, persistence, capability status, and localized metadata. `clh` profile composition keeps the same package and namespace contracts, so a profile can omit a capability without creating a dead page.

## Table of Contents

- [Navigation groups](#navigation-groups)
- [Shell behavior](#shell-behavior)
- [Feature ownership](#feature-ownership)
- [Assembly and verification](#assembly-and-verification)
- [Further exploration](#further-exploration)
- [Dev Note](#dev-note)

## Navigation groups

| Group | Section responsibilities |
|---|---|
| Personal | General, Voice, Floating workspace, Account, and Keybindings |
| Agents | Models, Agent presets, Tool execution, Permissions & approvals, Shell execution, Subagents, and Automation |
| Workspace | Terminal, Git, Worktree, Workspace isolation, Task sources, and Files |
| Capabilities & connections | MCP, Execution hosts, Integrations, Web search, Browser, Computer Use, Mobile, Security Research, and optional Desktop phone pairing |
| Data & advanced | Usage, Archived sessions, Runtime diagnostics, and Plugins |

The group ids are `personal`, `ai`, `workspace`, `capabilities`, and `advanced`. Section ids, settings namespaces, save/reset operations, and Remote method names remain owned by their feature packages. A feature registers a section and its searchable fields in one effect lifetime; disposing the feature removes both contributions.

## Shell behavior

`ui-settings-general` renders a full-page route beside the application root. The navigation rail and the content column scroll independently, and narrow windows move the rail into a drawer. Search indexes localized public labels, descriptions, keywords, and stable anchors; it never reads setting values or secrets. Selecting a result opens the owning section, selects its tab when needed, and focuses the registered anchor.

Section metadata declares top-level heading ownership. The shell adds headings to compact legacy pages; feature-owned pages retain their native heading hierarchy, so adding a page does not require a section-id list in the shell.

`ui-settings` remains the settings data and metadata base. It provides the shared settings mirror, schema operations, section slots, item metadata, and launcher contract. The shell does not duplicate feature forms, infer Host capabilities, or maintain a central route table.

## Feature ownership

Models and Agent presets live under Agents and keep their existing Remote and durable settings owners. Permissions, shell, agent-loop, subagent, and web-search pages remain available through their historical `plugins.item` registrations while their primary destination is the corresponding Agents section. Runtime settings is a first-class Data & advanced section; the Plugins entry remains a compatibility launcher for deployments that still expose it.

Automation has a Sidebar panel for durable task management. Its Settings entry is a launcher that selects the Automation panel and closes Settings; the panel owns create, update, run, cancel, history, and Session navigation. The automation runtime keeps its exclusive local ownership and explicit saved inputs.

Capability pages are independently injectable. Missing Remote providers leave the page with an explicit unavailable state. The optional phone-pairing page additionally requires the `dsh-app:` Desktop carrier and a loopback Host; the default Web/CLH composition does not mount its pairing controller or Settings row. The Web bundle mounts the Remote assembly and the optional voice, security, Git, and sidebar providers through `cordis.patch.yml`; `clh` keeps the same rows and profile-specific enablement.

## Assembly and verification

`packages/api/remotes` mounts each selected generated Host Remote exactly once, including workspace isolation, worktree tasks, device capabilities, security research, work items, browser, integrations, usage, voice, MCP, automation, execution hosts, and sidebar Git/terminal services. Phone pairing stays outside this default assembly; an explicit profile must compose its pairing controller and Client page together.

Focused UI tests cover metadata grouping, full-page navigation, search targets, runtime sections, and the Automation panel. Remote assembly is checked by the Client type graph and the generated-contract build. Full application tests still depend on their existing browser and external-service fixtures.

## Further exploration

- [Settings metadata Agent Note](../../.agents/notes/implemented/architecture/2026-09-17-settings-navigation-metadata.md)
- [Feature-owned settings Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-feature-settings-navigation.md)
- [Durable automation ownership](../../.agents/notes/implemented/architecture/2026-09-17-durable-automation-ownership.md)

## Dev Note

This report is a product-architecture reference. Package READMEs and implemented Agent Notes own exact API, persistence, and composition contracts.
