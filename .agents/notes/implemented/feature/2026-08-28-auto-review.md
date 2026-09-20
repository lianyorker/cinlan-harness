# Agent Note: Optional per-call Auto review

Status: implemented

English | [中文](2026-08-28-auto-review.zh.md)

## Problem

Users running with Full access need an optional per-call authorization review without changing default permissions or creating a second source of approval policy. Reviews must distinguish current human authority from historical facts and preserve the same scope during child delegation and Session restoration.

## Decision

The experimental AutoReview profile bundle uses the current agent's provider/model to review each native call and each started PTC inner call. It is externally installed and explicitly selected for one session. Default profiles and future-session settings do not enable it. Auto shares Full access execution knobs while its distinct logged preset identity determines review eligibility.

The existing permission and tool services own execution policy. Reviewer failures, malformed decisions, missing facts, and hard denials stop the body; a successful review delegates to subsequent guards. High-risk sensitive exfiltration is denied even with explicit authorization. A current human instruction outranks a direct-parent instruction; checkpoints and prior actions restore facts without granting authority.

## Lifecycle and durability

Removal follows the reference lifecycle: close admission synchronously, cancel pending decisions, migrate live Auto sessions to Full access, then withdraw review hooks after settlement. An operator wanting confined execution selects that preset before removal. Cold restoration of a stored Auto identity requires an active reviewer; a missing bundle cannot silently resume its Full access knobs. In-process delegation captures Auto/Full access identity before its first await and writes it after seed and policy overrides. Other process backends keep their own permissions.

Each PTC binding owns its frozen schema; this transient metadata is never added to start/settle logs. Structured denial metadata contains a stable error name/code and optional raw reason, while the main model sees only a fixed rejection message. Optional metadata neither changes Session format 3 nor changes TypeScript/Python SDK loop projections. Released generations remain immutable. Mock Loader tests serialize and cold-restore current events, retaining raw reasons without exposing them in derived model messages.

## Alternatives considered

**A separate approval service.** It would create conflicting authority and an implicit bypass path. The reviewer instead participates in the existing tool pipeline and permission preset lifecycle.

**Keeping the combined permission projection.** This limited the optional port to its existing Session API but required profile restart after external layer changes. The [live catalog decision](../architecture/2026-09-20-live-permission-catalog.md) partially supersedes that choice; Auto authorization and durability remain owned here.

## Consequences

Model authorization can misclassify actions and uses extra tokens. Outer run_code and direct JavaScript effects are outside inner-tool review, so Auto is not a deterministic security barrier. The process permission catalog updates picker availability when the Auto integration registers or leaves; the Session projection records only current selection. No separate settings section or specialized denial card is introduced.

Mock tests cover sourced authority, malformed and failed reviews, downstream vetoes, no-body denials, binding schema identity, cancellation, removal, reinstall, delegated policy capture, and localized risk confirmation. A source Loader composition exercises the real agent loop without model/API access. This verifies integration, not real-model risk classification or external package publication.

The [package README](../../../../packages/experimental/auto-review/README.md) owns setup and limitations. The [subagent policy note](2026-07-25-subagent-policy-inheritance.md) continues to own sandbox inheritance and approval pinning; this note adds only the shared-knob preset identity requirement.
