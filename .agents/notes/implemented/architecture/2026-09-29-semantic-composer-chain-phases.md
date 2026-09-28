# Agent Note: Semantic phases for composer-chain election

Status: implemented

English | [中文](2026-09-29-semantic-composer-chain-phases.zh.md)

## Problem

The Web `conversation.composer` chain ordered candidates solely by one global numeric priority, electing the first selector returning a match. User questions used default priority 0, approvals used priority 1, and the read-only subagent composer used priority -10. When a user viewed a one-shot history, the read-only surface masked pending answerable questions and approvals underneath it.

A single scalar conflated two distinct decisions: whether a candidate resolves an existing human wait versus restricts starting new work, and local preference between candidates of the same semantic kind. Numeric tuning preserved hidden coupling across unrelated domains and risked future regressions.

## Decision

Chain slot declarations may define an ordered tuple of domain-owned phases via `phases?: readonly string[]`.

On a phased chain slot, `SlotSpec` and `SlotMap` enforce that every registration explicitly specifies one declared `phase`. Registrations omitting `phase`, naming an undeclared phase, or declaring `phase` on an unphased chain fail loudly at both compile time and runtime.

`SlotCore` sorts candidates first by declared phase index ascending, then by local numeric priority ascending, while preserving registration stability on ties.

The `conversation.composer` chain declares `phases: ['interaction', 'restriction'] as const`. Question and approval register in `interaction`, retaining question-before-approval precedence. `SubagentReadOnlyComposer` registers in `restriction`. An existing wait resolves first; once resolved, the read-only restriction reappears.

## Consequences

- Semantic dominance is structural: interaction resolution always precedes work initiation restriction without fragile priority magic numbers.
- Unphased chains remain fully backward-compatible and use pure numeric priority sorting.
- Type errors in `SlotMap` catch phase omissions or mismatches at compile time across all client plugins.
- Browser-only election introduces no model-visible token overhead, request changes, or cache invalidations.

## Validation

- `packages/client/ui-slots`: Unit tests verify phase validation (omitted, unknown, and unphased rejection), phase index dominance over arbitrary local priorities, intra-phase priority ordering, and tie-breaking stability.
- `packages/client/ui-slots`: Compile-time tests assert positive phased registration and `@ts-expect-error` rejections.
- `packages/client/ui-conversation`: Integration tests in `composer-phases.client.spec.ts` prove InputBar fallback, read-only display when idle, question preemption over read-only, approval preemption over read-only, question preemption over approval in `interaction`, return to read-only on resolution, and HMR re-registration determinism.
