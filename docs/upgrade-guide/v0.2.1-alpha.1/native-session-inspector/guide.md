---
kind: upgrade-guide
description: "Read-only Session Inspector moves to a native client package and no longer requires the privileged debugging bundle."
---

# Native read-only Session Inspector

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-experimental-session-inspector` is promoted to `@deepseek-ai/dsh-client-ui-session-inspector` under `packages/client/ui-session-inspector`. Web and Desktop compose the read-only plugin once as `session-inspector`. The shared Developer tools preference controls its Sidebar entry and picker lifetime. The optional `inspector-profile` bundle mounts only the privileged NodeJS Inspector, not another copy of the read-only plugin.

The existing `session-inspector-log` tab kind and its historical implementation id remain unchanged to preserve saved Sidebar layouts. No Session events or data format change. Raw inspection remains unredacted, but it starts no debugging endpoint or network capture.

## Migration

1. Replace direct package dependencies, imports, and custom plugin rows naming the experimental Session Inspector with `@deepseek-ai/dsh-client-ui-session-inspector`. Do not add a second row to a profile already composing the current Web bundle.
2. Use Settings → Data & advanced → Developer tools to show or hide the read-only inspection entry. Open Session Log from the right Sidebar and confirm Raw Log and Chat Group can inspect the current Session. Turning the preference off removes the entry and cancels picking.
3. Keep `inspector-profile` disabled unless privileged runtime debugging is explicitly needed. Removing that optional bundle does not remove native Session inspection. Network capture remains a separate explicit request.
