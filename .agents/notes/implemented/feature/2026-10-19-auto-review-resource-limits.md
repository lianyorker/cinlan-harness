# Agent Note: Bounded Auto review requests

Status: implemented

English | [中文](2026-10-19-auto-review-resource-limits.zh.md)

## Problem

Authorization review runs before a tool body and can delay the call and integration teardown. Unbounded input and generation can also consume model capacity without a deployment-controlled limit.

## Decision

The [Auto plugin](../../../../packages/guard/auto-review/README.md#review-limits) requires explicit input-byte, output-token, and deadline configuration. It rejects an oversized complete system policy plus framed user input before dispatch, without truncating authorization evidence. It passes the output-token cap and deadline signal to the model provider. Deadline expiry rejects every later response before tool execution; caller cancellation and integration disposal retain their existing precedence. Providers must observe cancellation for timely settlement, and teardown still drains the owned review instead of abandoning it.

This partially supersedes only the unlimited-request choice in the [Auto decision](2026-08-28-auto-review.md). Its authority rules, full-access execution, current-session opt-in, and experimental isolation remain active. No Session event or format is changed; the missing durable reviewer-input record remains unresolved.

## Alternatives considered

Truncating history can discard revocation or scope constraints. Racing a timer and abandoning the model stream would leave unowned work during teardown. A fixed plugin constant would prevent deployments from choosing their resource limits.

## Consequences

Previously admissible large or slow reviews can fail closed. The bundle provides explicit limits, while direct plugin compositions must supply all fields. Owner tests cover exact UTF-8 admission, one-byte excess, provider token forwarding, invalid config, timer disposal, and an abort-ignoring late allow. They do not establish termination of a provider that never settles or real-provider token accounting.
