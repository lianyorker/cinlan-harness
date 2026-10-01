# Agent Note: Settings groups preserve feature ownership

Status: implemented

English | [中文](2026-09-19-feature-settings-navigation.zh.md)

## Problem

Settings needs a product-level information hierarchy that stays understandable as features are added. A central route table or duplicated forms would make the shell own feature policy, split persistence ownership, and leave capability pages visible after their providers disappear.

## Decision

The Settings shell exposes five stable groups: `personal`, `ai`, `workspace`, `capabilities`, and `advanced`. The product labels are Personal, Agents, Workspace, Capabilities & connections, and Data & advanced. Feature packages register their section group and public searchable fields through `settingsMetadata` beside their existing `settings.section` slot registration.

`ui-settings-general` renders one full-page Settings route with a responsive navigation rail, independent content scrolling, and public-copy search. Search selects the owning section, activates a registered tab when required, and focuses a stable `data-settings-anchor`. The shell never reads setting values, secrets, Host schemas, or feature-specific controls.

The section metadata also declares top-level heading ownership. The shell supplies the heading for compact legacy pages; feature-owned pages keep their native heading and internal hierarchy. This keeps the shell free of section-id policy as new pages are added.

Feature packages keep their section ids, settings namespaces, Remote calls, save/reset behavior, and durable stores. Models, Agent presets, permissions, shell execution, tool execution, subagents, and web search belong to Agents. Runtime diagnostics is a first-class Data & advanced section, while the Plugins row remains a compatibility launcher. Automation has a Sidebar panel; its Settings row only navigates to that panel.

Capability sections remain independently injectable. A missing provider leaves an explicit unavailable page. The phone-pairing implementation is retained as an optional Desktop loopback contribution; the default Web/CLH composition does not mount its pairing controller or Settings row.

The Remote assembly mounts each generated contribution once. The default Web/CLH graph includes the capability namespaces used by its mounted pages and leaves the optional pairing namespace out until a profile explicitly composes that feature.

## Alternatives considered

**Keep a single Side Cards catalog.** It groups by implementation package instead of user intent and makes direct discovery harder.

**Duplicate native forms inside a shell-owned catalog.** Two editors for one namespace can diverge in validation, persistence, and reset behavior.

**Let the shell own a feature route table.** A static table cannot follow plugin disposal or optional provider composition and would make the shell import every feature.

## Consequences

Users can find settings by product intent, and each feature retains its existing data ownership. Search remains safe because its index contains only localized public copy and anchors. Adding a feature requires one section registration, metadata, and a composition row; it does not require changing the shell. More groups and sections increase navigation density, so empty groups stay hidden and search remains available on narrow screens.

## Verification

Metadata, shell, feature-loader, and Automation panel tests cover group assignment, disposal, search targets, compatibility launchers, and responsive navigation. The generated-contract build covers the mounted Remote assembly. Web and Desktop application tests remain the owner of assembled carrier behavior.
