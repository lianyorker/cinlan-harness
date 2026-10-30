---
kind: upgrade-guide
description: "Inspector fetch capture defaults off and requires explicit profile or library opt-in."
---

# Explicit Inspector fetch capture

English | [中文](guide.zh.md)

## Change

The Inspector plugin schema, `startInspector()` library defaults, and optional `inspector-profile` bundle change `captureFetch` from true to false. Enabling the bundle still starts its privileged local debugging backend, but does not wrap global fetch or capture Host network payloads by default. Read-only Session inspection is independently native. Existing explicit true overrides still enable capture.

## Migration

1. Leave capture off for ordinary Session or runtime inspection. Opening a Network panel does not enable capture.
2. For trusted network diagnosis, set `captureFetch: true` in the complete config of the `experimental-inspector` profile row, or pass it to `startInspector()`, for initial library capture. A loaded Host plugin applies changes live; its Developer tools capture control requires risk acknowledgement before enabling. A saved true value resumes capture on Host restart without another confirmation. Library callers may await `handle.setCaptureFetch(enabled)`; enabling after `close()` fails. Profile patches replace whole configs; retain your other overrides.
3. Treat captured URLs, headers and bodies as sensitive: there is no redaction. Closing the Inspector stops its observer; disabling capture alone does not restrict debugger code execution.
