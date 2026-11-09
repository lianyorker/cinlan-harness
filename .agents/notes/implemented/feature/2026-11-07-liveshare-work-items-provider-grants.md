# Agent Note: Liveshare Work Items provider grants

Status: implemented

English | [中文](2026-11-07-liveshare-work-items-provider-grants.zh.md)

## Problem

Liveshare viewers use a `share-viewer` Peer and its own Remote access policy. The phone-pairing provider allowlist does not authorize that Peer, and provider-wide Work Items reads previously remained owner-only.

## Decision

The owner selects Work Items provider sources independently for each share. The selection is stored in the Owner share record; an absent field grants no source. `workItems/list` and `workItems/get` declare a provider resource, and the viewer policy binds those actions only to the selected providers. Every Gateway decision reads the current Owner record, so persisting a revocation removes access on the next call. Association projections additionally require the current Peer's Workspace grant; Session ids and worktree metadata require its Session grant. Association mutations and external-write preview, confirmation, cancellation, and history remain owner-only.

## Alternatives considered

**Reuse phone tunnel source grants.** The tunnel and Liveshare use different Peer principals, admission flows, and lifecycle records. Sharing a grant store would cross authorization domains and make one surface's revocation semantics affect the other.

**Expose all providers when a share grants the Work Items endpoints.** Endpoint-level permission does not state which configured provider data the owner intended to share. Provider resources preserve least privilege and make the owner selection independently revocable.

**Infer grants for records written before provider selection existed.** Existing records were created without provider consent. Treating a missing field as empty keeps those records private until the owner selects sources.

## Consequences

The owner share UI adds five provider checkboxes and saves them with other share permissions. Provider source IDs are persisted as a bounded known set. A viewer can list and refresh details only for a selected source; the Gateway still denies association and external-write endpoints. Workspace and Session metadata is projected only when the current Remote invocation grants those resources. Real Liveshare browser composition verification remains outstanding.

## Verification

Host tests cover per-share source persistence, selected and unselected provider decisions, revocation, malformed source rejection, and refusal of all association and external-write actions. Client tests cover provider selection and saving. Work Items controller tests cover Workspace and Session metadata projection. Package typechecks and focused tests are required before the browser composition result can be archived in the task plan.
