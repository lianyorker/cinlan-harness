# Agent Note: Floating Workspace owns an auxiliary Session

Status: implemented

English | [中文](2026-10-21-floating-auxiliary-session.zh.md)

## Problem

A panel that follows the main Session is only a second view of the same conversation. It cannot serve as a scratch conversation without changing or competing with the user's current selection.

## Decision

The [Floating Workspace](../../../../packages/client/ui-floating-workspace/src/client/index.ts) creates an independent Host Session for its floating panel and for each right-Sidebar side-chat tab. Each auxiliary Session inherits the mounted main Session's working directory when available, retains its own `SessionReference`, and never changes main navigation. The panel reuses its Session across close/reopen; a closed side-chat tab releases its reference. Disposal releases the panel reference. Creation failure stays visible and can be retried.

## Alternatives considered

**Bind the panel to the selected main Session.** Rejected because sending in the panel would write into the conversation the panel is meant to supplement.

**Create a second Session on every open.** Rejected because close/reopen would abandon scratch context and leave duplicate blank Sessions in the Host catalog.

**Fork the main Session.** Rejected because a helper conversation should not inherit the main transcript or model-visible context; it inherits only the working directory.

## Consequences

The panel consumes a separate Session and has independent model, permission and history state. Its Session remains in the Host catalog after the panel closes; its Client reference lasts only until the feature is disposed. Ungrouped Sessions use the inherited working directory for grouping.

## Verification

Runtime tests cover single panel creation, close/reopen reuse, reference release and retry after creation failure. Side-chat tests cover independent Session binding, tab-close release and retry; registration tests cover cwd selection from the mounted Session and tab titles. A panel-level Loader check must verify that the Host creates the Session without replacing the selected main Session; Desktop Electron creation remains unverified.
