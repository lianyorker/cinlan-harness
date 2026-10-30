---
kind: upgrade-guide
description: "Auto review moves to the native guard package and Web composition; current-session opt-in and pending acceptance remain explicit."
---

# Native Auto review backend

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-experimental-auto-review` moves to `@deepseek-ai/dsh-auto-review` under `packages/guard/auto-review`. Web and Desktop mount one bounded `auto-review` backend by default. Loading the backend offers Auto to current-session permission pickers but never selects it, changes the future-session default, or forwards Auto permission state to children. The risk confirmation and EXP warning remain while compatibility acknowledgement and full acceptance are pending.

The `auto` preset id and required `auto-review/request` event are unchanged. Review can allow unsafe work, and an allowed call runs with Full access. Exact review inputs are retained in Session logs; unrecognized readers refuse them. No release or full real-provider acceptance is implied by this package relocation.

## Migration

1. Before restarting an existing Web/Desktop profile, remove its installed `@deepseek-ai/dsh-experimental-auto-review` optional bundle and any extra row that mounts it. Do not add the new package as another layer above the current Web bundle; duplicate registrations fail rather than selecting an arbitrary reviewer. Preserve Session files.
2. Replace direct dependencies/imports/custom plugin rows with `@deepseek-ai/dsh-auto-review`. Custom non-Web profiles must provide required services and the complete review config `{ maxInputBytes: 262144, maxOutputTokens: 1024, timeoutMs: 60000 }`, adjusted explicitly for deployment needs.
3. Confirm the ordinary default remains selected on a fresh Session, Auto appears in composer and `/permission` pickers, and cancelling its confirmation keeps the current mode. Select Auto only for a trusted current task.
4. Resolve the outstanding persistence compatibility check before releasing or sharing affected Sessions with other builds. If disabling the backend with live Auto Sessions, retain the documented Full access migration and review that mode before continuing.
