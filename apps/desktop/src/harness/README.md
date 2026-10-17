# Desktop-local Harness modules

English | [中文](README.zh.md)

## Scope

These modules initialize in the Electron main process. They do not supply the Web Host's Cordis configuration, durable Sessions, model adapters, or tools. The application uses the existing Host services for conversation and execution; local integration tests do not establish a connection between the two implementations.

## Configuration and logging

`loadHarnessConfig(projectPath)` merges defaults, global configuration, user configuration, and project configuration in that order. Global configuration lives at `%PROGRAMDATA%/cinlan-harness/config.json` on Windows and `/etc/cinlan-harness/config.json` elsewhere; user configuration lives at `~/.cinlan/config.json`, and project configuration at `<projectPath>/.harness/config.json`. Missing files are skipped. `${VAR}` references expand recursively; unset variables expand to an empty string. Existing unreadable or malformed JSON files fail the load. Parsed fields are not runtime-schema-validated.

`createLogger` supports JSON and pretty output to a configured destination or stdout. Child loggers inherit context and destination. The declared compact format currently uses JSON output; rotation fields do not implement rotation. Do not log configuration objects containing API keys.

## Sessions and tools

`MemorySessionManager` creates, finds, lists, and deletes process-local sessions. Context updates merge top-level fields; reads return a shallow copy. State entries record `idle`, `started`, `paused`, `error`, or `completed`; entering active from paused records `resumed`. Every explicit state assignment records an event, even when the state is unchanged. No transition restrictions or persistence are implemented. Event-array reads return a shallow copy, not deep immutability.

`MemoryToolRegistry` replaces tools with the same name. Unregistering an absent tool is a no-op. Execution returns the tool's result; missing tools and rejected executions produce `success: false` with an error message. Parameter definitions are descriptive: the registry does not validate arguments, enforce sandbox policy, or automatically append Session events. A caller must orchestrate those operations explicitly.

## Verification example

The runnable [integration fixture](../../tests/fixtures/harness-integration.ts) loads real configuration files, writes a note through a registered tool, updates a session, records lifecycle and tool events, and writes correlated JSON logs. Its [test](../../tests/harness-integration.spec.ts) owns an isolated home and workspace and verifies the file and logs after the child exits. It is a test fixture, not an application launcher.

```sh
pnpm exec vitest run apps/desktop/tests/harness-config.spec.ts apps/desktop/tests/harness-logging.spec.ts apps/desktop/tests/harness-session.spec.ts apps/desktop/tests/harness-tools.spec.ts apps/desktop/tests/harness-integration.spec.ts
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/harness-closed-loop.e2e.ts
```

The Web test boots the shipped composition, submits browser input, executes the platform shell through the real Agent loop, feeds its result into a second model request, and verifies the reply and Session events. Only the external model adapter is deterministic; it does not qualify a real provider or Electron IPC.
