---
kind: upgrade-guide
description: "Direct Auto review compositions require explicit input, output, and timeout limits."
---

# Auto review request limits

English | [中文](guide.zh.md)

## Change

The Auto plugin requires `maxInputBytes`, `maxOutputTokens`, and `timeoutMs`. Direct plugin rows without these fields fail configuration validation. The bundle supplies 262144 bytes, 1024 output tokens, and 60000 milliseconds. Oversized input is rejected before model dispatch without truncation; deadline expiry rejects a late allow before tool execution. Model providers must observe cancellation for timely settlement.

## Migration

1. For a direct plugin row, set its complete config to `{ maxInputBytes: 262144, maxOutputTokens: 1024, timeoutMs: 60000 }`, adjusting the positive integer values for the deployment. Bundle users inherit these values unless a later profile patch replaces the config.
2. Supply the same fields to direct `ctx.plugin(AutoReview, config)` callers. Restart the Host and confirm that the Auto option is available before selecting it for a Session.
3. Keep a rejected oversized or timed-out call unexecuted. Review its error and narrow the task or adjust deployment limits explicitly; do not interpret failure as permission to use Full access.
