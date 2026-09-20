---
description: "The feedback package group: user feedback on sessions and assistant messages, for users and maintainers choosing, composing, or debugging feedback capture."
kind: "package-group"
---

# feedback/ — recorded human feedback

English | [中文](README.zh.md)

## Summary

The feedback group records human opinions about whole Sessions and individual assistant messages, with optional categories and remarks. Users submit Session feedback through `/feedback` or a product integration; product integrations read and change message ratings through `messageFeedback`. Both use the same category ids and stay outside model history. This page maps the group; the package READMEs and the [feedback subsystem page](../../docs/subsystems/feedback.md) own the per-package contracts.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`command-feedback`](command-feedback/README.md) | Session feedback through `/feedback`, a direct producer, or `sessionFeedback`, plus the shared category ids |
| [`message-feedback`](message-feedback/README.md) | Per-message ratings, categories, and notes through `messageFeedback` |

Session remarks are a one-way signal: recording one is safe at any point in a conversation and never changes what the model sees. With a feedback-gated sharing policy, recording a session remark is what releases the session for sharing.

Per-message feedback survives restarts in the Session log and remains outside model history. Log delivery follows the configured [telemetry policy](../session/session-telemetry-otel/README.md).

<a id="related-documentation"></a>
## Related documentation

- [Feedback subsystem](../../docs/subsystems/feedback.md) — the message-feedback types, service contract, and Web consumer.
- [Session telemetry subsystem](../../docs/subsystems/session-telemetry.md) — policies for sharing recorded feedback and Session logs.
- [Anonymous user identity](../identity/README.md) — the per-harness-home id embedded in the feedback acknowledgement.

<a id="dev-note"></a>
## Dev Note

None.
