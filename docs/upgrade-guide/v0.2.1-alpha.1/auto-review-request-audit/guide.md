---
kind: upgrade-guide
description: "Auto review records exact auxiliary model inputs in Session logs; older readers refuse the required event."
---

# Auto reviewer input retention

English | [中文](guide.zh.md)

## Change

The current-session Auto mode writes required log-only `auto-review/request` before dispatch. It contains the exact system policy and user text, model route, sampling temperature, output-token cap, deadline, and scoped call identifiers. Existing logs without the event remain readable. Builds without the event vocabulary refuse affected logs rather than discarding the input. The physical Session encoding is unchanged, but repository-wide persistence acknowledgement remains unresolved and this change is not stable-promotion approval.

Review inputs may contain sensitive user messages and complete tool arguments. They are retained and exported with Session logs, without redaction. They do not enter main-model conversation history. Reasoning, raw reviewer response, and parsed risk are not retained by the request event.

## Migration

1. Upgrade every Host or SDK reader used to open affected logs before resuming an Auto Session written by this build. Do not delete the event or mark it ignorable to bypass an older reader’s refusal.
2. Review Session storage permissions, retention, raw exports, and backup access before selecting Auto. Selecting another permission mode stops subsequent Auto reviews but does not erase existing audit records.
3. Treat an audit as a recorded dispatch attempt, not proof of provider receipt or a valid authorization result. If the append fails, the reviewer and tool body remain unexecuted.
