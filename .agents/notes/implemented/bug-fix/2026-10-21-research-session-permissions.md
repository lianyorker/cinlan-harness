# Agent Note: Research presets preserve Session permissions

Status: implemented

English | [中文](2026-10-21-research-session-permissions.zh.md)

## Problem

The research preset's Agent initialization overwrote the Session approval policy with `never`. A new Session initialized as `workspace-write` with `ask` consequently appeared as Custom. The original intent was to avoid interrupting research with prompts, but `never` rejects approval requests rather than authorizing them.

## Decision

The [research bundle](../../../../packages/bundle/security-research/src/index.ts) contributes its persona, skills and tools without setting Session permissions. PermissionPresetService owns new-Session permission initialization; recorded overrides remain authoritative for existing Sessions. Deployment and user defaults remain configurable. The base default is `workspace-write` with `ask`.

This decision partially supersedes the approval override in the [Web composition decision](../feature/2026-09-10-worktree-sidebar-security-integration.md). That note remains active for its independent Worktree, sidebar and assessment-scope decisions. The research persona grants no assessment authority and does not bypass tool or sandbox policy.

## Alternatives considered

**Keep forcing `never` to avoid prompts.** Rejected because it silently changes the selected Session permission and deterministically rejects operations requiring approval. A persona does not own approval defaults.

**Relabel the mixed policy as workspace-write.** Rejected because the label would conceal the difference between `ask` and `never`.

**Rewrite every existing Session to `ask`.** Rejected because durable overrides can express deliberate user choices. Users select a different permission explicitly when needed.

## Consequences

New research Sessions follow the same permission defaults as other presets. Research operations can ask through configured answerers; an unavailable answerer still fails closed. Existing Sessions can remain Custom, as explained in the [upgrade guide](../../../../docs/upgrade-guide/v0.2.1-alpha.1/research-session-permissions/guide.md).

## Verification

Focused tests cover preset registration without an approval service and preservation of the policy when an Agent starts. Cold-start Web/Host verification creates a Session from the mobile UI, reads `workspace-write` from the Host projection and checks the Web permission label. An existing Custom Session and its assistant reply survive the Host restart. Desktop creation, other profiles and custom-default combinations remain unverified.
