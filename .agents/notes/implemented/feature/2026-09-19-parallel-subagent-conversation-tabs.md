# Agent Note: Parallel subagent conversation tabs

Status: implemented

English | [中文](2026-09-19-parallel-subagent-conversation-tabs.zh.md)

## Problem

Opening a catalog child through main-session selection removes its parent from the main conversation. Existing better-sidebar Side Chat creates separate threads and owns a different transcript presentation, so it cannot supply a parallel view of an already-addressed subagent with the ordinary tool cards and composer.

## Decision

The catalog offers an explicit **Open in sidebar** action, and topology child cards call the additive `betterSidebar.openSubagentChat(address, scope?)` method. Each hidden `subagentchat` tab stores its direct-parent address in a resource URL and uses existing tab deduplication and split placement. This is a true parallel child view: opening the tab never selects the child in the main conversation. Ordinary catalog row activation still selects the main child view, and parent breadcrumbs retain their navigation behavior.

`sessions.retainSubagent` validates the catalog address, configures the standard child transport, and retains an identity-specific Session scope independently of current selection. Multiple references share that scope. Releasing or aborting one reference cannot dispose another reference or a selected Session; late work from a disposed scope cannot mutate its replacement.

The existing Conversation registration opts into `reusable: true`. The renderer's `renderSessionView` operation resolves standard hooks, stores, injected callbacks, and child slots against the explicitly retained Session. Reuse retains the original slot authorization and contains errors per occurrence. Reload reauthorizes a replacement registration before rendering it. The optional embedded presentation hides main navigation and width handles; transcript assembly, tool cards, input, and interaction takeovers use the normal Conversation tree and transport.

The [Web catalog and human continuation decision](2026-07-27-web-subagent-conversations.md) remains authoritative for direct-parent permission, read-only one-shot records, live-parent continuation, and independent Stop. It is retained as an active decision; parallel placement does not supersede its authority rules. No package or transport is added.

## Alternatives considered

**Switch the main Session and reopen the topology.** This preserves only one conversation at a time and fails the requirement to read the parent and child together.

**Reuse SideChatView's transcript construction.** Its thread lifecycle and polling presentation are separate from the standard Conversation renderer; extending it would duplicate tool rendering and input rules.

**Port the complete reusable Factory and resource framework.** Explicit reuse of an opted-in registered Session entry supplies the required occurrence with fewer API changes and preserves the local better-sidebar service and split implementation.

## Consequences

A retained tab owns one reference until it unmounts, including while another tab is active. Restored tabs reload their catalog before retaining their child. Closing a view does not cancel the child Agent. Existing theme tokens and sidebar layouts apply to the embedded Conversation. Feature plugins continue to receive child-scoped projections and commands even while another Session is selected.

Focused keyless tests cover independent references, late opening and disposal, child-scoped hooks and projections, reused registration reload, tab deduplication across splits, ordinary composer rendering, and both catalog and topology actions. An owner-local catalog snapshot records the additional side-open action.
