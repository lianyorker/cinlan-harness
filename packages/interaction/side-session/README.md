---
description: "Interactive side sessions and merge-back mechanics"
kind: "package-reference"
---
# @deepseek-ai/dsh-side-session

English | [中文](README.zh.md)

## Summary

Interactive side sessions and merge-back mechanics: pure helpers that derive a contiguous, closed seed prefix from a parent session's event log and describe how a side session's outcome merges back.

## Use this package

Mount consumers that open an interactive side session (for example, a review or focused subtask) call the prefix helper with the parent's full event log. Open turns and trailing step activity are excluded, so the returned seed ends on a balanced completed-turn boundary; the side session starts from that closed state, and merge-back replays its outcome into the parent.

## Model Experience

None, as the package only computes event-log boundaries for its consumers; no prompt, tool, or Session content is registered.

#### KV Cache effect

No direct effect; session consumers own any model-visible use of the derived seed.

## Known Limitations and Deferred Work

- The seed is strictly contiguous: a parent with an open turn truncates at the last completed turn, so in-flight work is never inherited.
- Merge-back is a mechanics helper, not an authorization boundary; callers keep their own approval flow.
