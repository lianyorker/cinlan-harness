---
description: "Record optional text and category feedback about a Session through `/feedback`, a Host Remote, or a direct producer."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-feedback

English | [中文](README.zh.md)

## Summary

`dsh-command-feedback` records feedback about a Session with optional text and a category. Users can submit a remark through `/feedback`; product integrations can record feedback through `sessionFeedback.record` or `recordFeedback`. Recording appends immediately and never starts or interrupts model work. The command acknowledges the Session and anonymous user ids.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Users can record feedback from the Web client out of the box: the `/feedback` command ships with the standard `dsh` base, needs no configuration, and works in any conversation. A custom app gets the same command by mounting the Session store, command registry, and this plugin together.

### The `/feedback` command

Type `/feedback` followed by your remark and send it. A successful entry is acknowledged with the receiving session id and the anonymous user id:

| Input | Result |
|---|---|
| `/feedback the diff view is unreadable` | Record the remark and acknowledge with two lines: `Feedback recorded for session {sessionId}` and `Anonymous user: {userId}.` |
| `/feedback` | A usage error from the Host command: `Feedback text is required. Usage: /feedback <text>`. Whitespace-only input counts as empty. |

The [Web feedback dialog](../../client/ui-message-feedback/README.md) opens when a user selects `/feedback` from the composer menu or sends it without text. The Web client sends `/feedback <text>` to the Host command.

Surrounding whitespace is trimmed, but the remark is otherwise kept exactly as typed: no truncation, case folding, or command parsing — `/feedback /plan felt slow` records that literal text. Each command records its own entry; nothing is merged or replaced.

<a id="feedback-categories"></a>
### Feedback categories

Session and per-message feedback share these category ids; each UI supplies its own localized labels. Omitting a category leaves feedback uncategorized.

| Category id | Meaning |
|---|---|
| `task-result` | The outcome of the task |
| `instruction-following` | Understanding and following instructions |
| `product-interaction` | Product features and interaction |
| `service-stability` | Stability and speed |
| `resource-cost` | Resource usage and cost |
| `security-privacy-permission` | Security, privacy, and permissions |
| `other` | Anything else |

### Recording feedback from your own UI

Call `recordFeedback(session, { text, category })` from a Host integration, or `sessionFeedback.record({ sessionId, text, category })` through the Host Remote. Both fields are optional: blank text is omitted, category-only and empty entries are accepted, and each call appends one `feedback/record` without command bookkeeping. The Remote returns `session-not-found` when the id has no live Session. Mount the Session store, command registry, and this plugin together:

```yaml
- id: session
  name: '@deepseek-ai/dsh-session'
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-feedback
  name: '@deepseek-ai/dsh-command-feedback'
```

The Web client ships the command. Headless mode, ACP automation, and JSON-RPC provide no slash commands, so `/feedback` is unavailable there.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The remark is one append-only fact in the session log, owned by the event rather than by the command that produced it: feedback can arrive from any trigger, so the fact must not depend on the slash command. The command keeps its own bookkeeping payload-free, so the remark text exists in exactly one place in the log, and the event never surfaces to the model.

### How a remark is recorded

The producer trims text and appends the optional text and category; the `/feedback` handler requires non-blank text, while the Remote accepts empty entries. The append is eager but unflushed: acknowledgement confirms the in-memory log, not disk durability. Only the command obtains the anonymous user id for its acknowledgement. The producer and Remote implementation live in [`src/index.ts`](src/index.ts); [`src/types.ts`](src/types.ts) owns the event payload and request types.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Producer, category tuple, Host Remote, and command registration |
| [`src/types.ts`](src/types.ts) | Feedback category and payload types, event declaration, and Remote requests and results |
| — | No runtime invariant companion is published; each `feedback/record` is an independent append-only fact with no cross-event or mutable-data relationship. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They cover the command registry, persistence, and identity facts this capture path relies on.

- [dsh-commands](../../interaction/commands/README.md) — the registry that discovers the global command and its `recordInput` semantics.
- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — how appended events become durable and what a flush barrier means.
- [Anonymous user identity](../../identity/anonymous-user-id/README.md) — the id the acknowledgement reports.
- [Feedback package map](../README.md) — where log-only capture sits next to per-message feedback.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/feedback` capture

#### What the model sees

Nothing. The slash input, `feedback/record`, and the acknowledgement are absent from model requests. The feedback event and registry lifecycle records are log-only and carry no `surfaceOp`, so they never reach the ordered surface, `deriveMessages()`, or a system prompt. Recording feedback during a turn does not change that turn's remaining requests.

#### Token effect

Zero direct token effect. Neither an accepted entry nor a usage error adds model tokens, in the recording turn or any later one.

#### KV Cache effect

Independent of the model request path. Recording appends to the session log only, leaving an already-reusable request prefix untouched. Nothing this package contributes can invalidate cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where `/feedback` is a poor fit or behaves differently than a user might expect. They are current package constraints, not a task backlog.

- **No feedback retrieval or management surface** — there is no retrieval, aggregation, or model-facing tool for `feedback/record`.
- **Category and text only** — an entry carries at most one category and one free-text string, with no severity or referenced-event link.
- **Live Sessions only through the Remote** — `sessionFeedback.record` returns `session-not-found` for a Session with no live owner.
- **No amend or withdraw** — the session log is append-only and this package adds no tombstone, so a mistaken entry stays recorded and can only be superseded by a later one.
- **No explicit durability barrier** — the acknowledgement follows the append, not a flush, so an entry recorded immediately before a crash can be lost with any other unflushed tail. A consumer that needs a barrier awaits `ctx.sessions.flush(session)`.
- **No visible acknowledgement on a fresh session** — the web transcript renders command rows only once a session is active, so `/feedback` on a still-blank session records the event but shows no acknowledgement row. Recording feedback after the first message renders normally.
- **Web only among the shipped entry points** — headless mode, ACP automation, and JSON-RPC provide no command adapter, so `/feedback` is unavailable there.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Shipped behavior, limits, and rationale live in the sections above and the package code.

- The acknowledgement sentences are pinned by [`tests/command-feedback.spec.ts`](tests/command-feedback.spec.ts); changing them changes user-visible copy.
- A retrieval surface remains open; the current API does not reserve a retrieval format.

</details>
