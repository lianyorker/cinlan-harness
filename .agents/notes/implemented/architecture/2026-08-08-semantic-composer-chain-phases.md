# Agent Note: Semantic phases for composer-chain election

Status: implemented

English | [中文](2026-08-08-semantic-composer-chain-phases.zh.md)

## Problem

The browser's `conversation.composer` chain orders every candidate by one global numeric `priority`, then elects the first selector returning a match. Question uses the default priority `0`, approval uses `1`, and the one-shot or unavailable-parent read-only subagent composer uses `-10`. A selected one-shot history can therefore show the read-only explanation while an answerable question or approval is pending underneath it.

The defect is not one incorrect number. The chain currently uses the same scalar for two different decisions: whether a candidate resolves an existing interaction or restricts starting new work, and the local preference between candidates of the same semantic kind. Any numeric repair preserves that hidden coupling and lets a later registrant recreate the bug.

## Decision

A chain declaration defines an ordered tuple of domain-owned phases. `conversation.composer` declares `['interaction', 'restriction']`; every registration on that phased chain must name one phase, and its numeric `priority` orders entries only within that phase. `SlotCore` sorts by declared phase index, then local priority, then stable registration order. Registration fails immediately when a phased chain entry omits its phase or names one outside the declaration. Unphased chains retain their numeric behavior.

Question and approval register in `interaction`, retaining their within-phase order of question before approval. `SubagentReadOnlyComposer` registers in `restriction` with an ordinary local priority. The domain rule is precise: an interaction resolves a live Host wait that already exists; a restriction prevents the user from initiating work through the ordinary composer. Resolving an existing wait is not a new follow-up to the one-shot child, so the interaction phase goes first. Once the wait resolves, the chain re-elects and the read-only restriction becomes visible again.

The phase vocabulary belongs to the declaring slot, not to the slot framework globally. `SlotMap` carries the exact phase tuple for compile-time registration, and the runtime `SlotSpec` repeats that tuple as the sorting authority. Other chains acquire no composer terminology and need no migration unless they deliberately declare phases.

This decision extends the [Web subagent conversation](../feature/2026-07-27-web-subagent-conversations.md), [Web permission and approval](../../archived/feature/2026-07-23-web-permission-and-approval.md), and [plan-review presentation](../../archived/feature/2026-07-30-plan-review-presentation-intent.md) contracts; it supersedes none of them. The [runtime-owned child guard record](../../archived/bug-fix/2026-08-01-ask-user-delegated-caller-guard.md) introduced the guard that prevents new child-owned human waits.

## Alternatives considered

**Move the read-only priority after question and approval.** This is the smallest tactical fix, but it leaves semantic dominance encoded as undocumented number spacing and makes the next composer kind guess at the same global scale.

**Make the read-only selector decline whenever `interactions` is non-empty.** This fixes the current pair but makes a restriction plugin understand every actionable domain and duplicates election policy across selectors. A new interaction kind would require edits in unrelated restrictions.

**Rely only on the runtime child guard.** The guard fixes new model calls but cannot define browser ordering for already-pending waits, rolling-version overlap, or other interaction kinds such as approval. Runtime authority and presentation election are separate invariants.

**Render all matching takeovers as a stack.** The composer has one action seat. Stacking question, approval, and read-only surfaces makes keyboard focus and answer ownership ambiguous instead of selecting one current action.

## Consequences

- **Semantic election dominance**: phase order strictly dominates local numerical priority. Resolving pending interactions always outranks composer restrictions without coupling plugins to each other's domain specifics.
- **Fail-loud phase validation**: phased chain registrations omitting `phase` or providing an undeclared phase string fail immediately at compile time via `SlotMap` and at registration time via runtime `SlotSpec`. Unphased chains remain unaffected.
- **Zero model/token impact**: the change modifies no model-visible tool definition, system-prompt section, request routing, or session event; browser election incurs zero token cost and no KV-cache churn.
- **Single-surface scope**: concurrent questions and approvals continue single-surface presentation within the `interaction` phase, preserving question-before-approval order rather than solving multi-interaction queueing.

## Testing

- `SlotCore` unit tests verify phase ordering dominance, intra-phase priority and stable registration order, loud rejection of undeclared or missing phases, and unphased chain compatibility.
- Composer suite tests question plus read-only, approval plus read-only, all three together, resolution transitions, and fallback to `InputBar`.
- Web test snapshots verify one-shot subagent conversation with pending interactions and post-resolution return to read-only restriction.
