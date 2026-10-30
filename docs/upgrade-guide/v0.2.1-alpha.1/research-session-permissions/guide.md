---
kind: upgrade-guide
description: "Security Research preserves Session permissions instead of forcing approval policy never."
---

# Security Research Session permissions

English | [中文](guide.zh.md)

## Change

The Security Research preset previously forced approval policy `never` whenever an Agent started. It preserves the Session permission selection instead. New Sessions use the deployment and user default permission preset; the base default is `workspace-write` with `ask`. Existing Session overrides are not rewritten.

## Migration

1. Restart the Host after updating the Security Research bundle. In Settings, check the permission default for future Sessions.
2. Create a new Session with the Security Research preset and confirm the composer shows the configured permission preset. With the base defaults it shows workspace modification access.
3. Existing Sessions may still show Custom if their recorded `workspace-write` sandbox and `never` approval differ from a configured preset. Select the intended current-Session permission explicitly; upgrading does not change old Sessions automatically.
