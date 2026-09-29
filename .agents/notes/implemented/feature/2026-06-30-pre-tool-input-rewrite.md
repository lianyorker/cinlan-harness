# Agent Note: Pre-tool input rewrite — a consistent design

Status: implemented

English | [中文](2026-06-30-pre-tool-input-rewrite.zh.md)

## Problem

The [interception extension-points Agent Note](2026-06-30-interception-extension-points.md) defines `tools/pre-execute` as an allow/deny/ask gate over an execution whose identity is already protected and whose arguments are deeply frozen. Claude Code's `PreToolUse` hook also offers `updatedInput`, so a faithful bridge needs an explicit rewrite mechanism. A rewrite cannot be a mutation escape hatch on the existing execution object: it must keep the durable history, audit record, presentation, and executed value consistent.

### Three readers of pre-execution arguments

In the loop, a tool call's arguments are committed to the log and read by live consumers BEFORE the tool executes:

1. **`assistant/message`** is appended before tool dispatch — it is the model-history source `deriveMessages()` replays, so it carries the tool-call arguments the model itself emitted.
2. **`tool/call`** is the durable AUDIT record, appended before `ctx.tools.execute()`.
3. **Human-facing presentation reads `tool/call.arguments`**: UI renderers pass them to `presentResult`; `dsh-tool-bash` derives the card title, the rawInput, the cwd, and the terminal-vs-background treatment from them.

An execution-only rewrite would make the UI show one command while another ran and render the result against the wrong arguments. The registry prevents that failure mode: it structured-clones and deep-freezes `arguments`, makes the execution identity properties non-writable, and exposes no test shim or listener path that can replace them. The rewrite design must preserve that protected-identity boundary rather than weaken it.

## Decision

A rewrite is a pre-identity consistency transaction. When a listener or hook supplies rewritten input, the effective value is chosen before the registry constructs its immutable `ToolExecution`, and it is reflected in all three readers atomically:

- **`tools/input-rewrite` waterfall**: `ToolRuntime` exposes an early `tools/input-rewrite` waterfall event before execution identity or durable events are created. Listeners return a `ToolInputRewriteDecision` (`{ kind: 'proceed'; arguments?: unknown }`).
- **Audit trail (`tool/call`)**: The `tool/call` audit event records the rewritten arguments, with the original arguments retained in the optional `originalArguments?: string` sidecar field.
- **Model history (`assistant/message`)**: The agent loop updates tool call blocks in `assistant/message` in place before appending to the session log, ensuring `deriveMessages()` faithfully reflects what executed.
- **Presentation**: UI presenters (`presentCall`/`presentResult`) read the rewritten arguments from `tool/call.arguments`, so cards, titles, and diffs match what actually ran.
- **Immutable execution**: `ToolExecution.arguments` remains deeply frozen and non-writable; no mutable backdoor exists.
- **Deduplication in bridges**: Dialect bridges (`dsh-hooks-claude-code`) run `PreToolUse` on `tools/input-rewrite`, cache the outcome by `callId`, and consume it during `tools/pre-execute` so hook scripts execute exactly once.

## Alternatives considered

### Why not mutate the execution object?

Allowing a pre-execute listener to assign `exec.arguments` would provide only an execution rewrite, leaving model history, audit, and presentation unchanged. Keeping the identity protected makes such partial behavior unrepresentable.

### Why not append a separate correction message?

Appending a synthetic correction message into history would alter conversational turns, invalidate prompt prefix caching, and diverge from Claude Code's model where the rewrite replaces the call arguments directly.

## Consequences

Pre-tool input rewrite is atomic across all consumers. Claude Code hooks with `updatedInput` are fully honored without unhonored warnings. `ToolExecution` retains its protected invariant. If a hook denies the call, the cached decision rejects at `tools/pre-execute` without duplicate script execution. All audit trails preserve both original and effective arguments.
