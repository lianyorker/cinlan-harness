# Agent Note: Durable Auto reviewer input

Status: implemented

English | [中文](2026-10-19-auto-review-request-audit.zh.md)

## Problem

Auto review can authorize full-host tool execution. Reconstructing an earlier decision from current policy text or transient PTC binding metadata cannot establish the exact model input at that time.

## Decision

The [Auto plugin](../../../../packages/guard/auto-review/README.md#request-audit) appends required log-only `auto-review/request` before model dispatch. The event captures the exact system policy, sole user text block, route, sampling temperature, output-token cap, deadline, and scoped native/PTC call identity. Input-budget rejection records no dispatch attempt; append failure fails closed. Audits do not join the conversation surface or feed later reviewer history. The provider stream, reasoning, parsed risk, and raw response are not retained by this event.

This partially supersedes the input-retention decision in the [Auto record](2026-08-28-auto-review.md). Its risk policy, authority ordering, session opt-in, and lifecycle remain active. Required-event handling refuses older readers lacking this vocabulary; updated readers can retain the event using the existing physical encoding. Source schema classification reports an additive event, but repository-wide acknowledgement is still blocked by independent finalized-V4 differences; this record is not an acknowledgement or stable-promotion approval.

## Alternatives considered

Rebuilding from current source loses the historical policy and binding. Reusing main-model headers or title records assigns ownership to the wrong request. Making the event ignorable permits unrecognized builds to drop the exact authorization input. Retaining only a hash cannot reconstruct the model request.

## Consequences

Session logs and raw exports contain additional sensitive input, including filtered human messages, tool descriptions, and arguments; storage access controls and retention apply without new redaction. Owner tests check pre-dispatch commit, native/PTC identifiers, complete request equality, append-failure denial, budget rejection, no main-history projection, and strict encode/restore/reopen. Live append does not guarantee a synchronous filesystem flush. Provider receipt, response certification, and real API acceptance remain outside this evidence.
