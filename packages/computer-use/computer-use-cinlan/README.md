---
description: "Local CLI Provider with validated observations and bounded, cancellable execution."
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use-cinlan

English | [中文](README.zh.md)

## Summary

Local CLI Provider with validated observations and bounded, cancellable execution.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This Service Provider implements [`ctx.computerUse`](../computer-use/README.md) through the public Cinlan JSON CLI. It launches one argv-based `ctx.subprocess` process per operation, uses one provider-instance `--session` namespace for observations and actions, validates the complete JSON envelope before publishing state, and never invokes a shell.

Plugin setup registers the Provider immediately without resolving the executable or probing capabilities. Executable resolution and the first CLI call happen lazily on the first operation, so a missing or unready Cinlan IDE CLI never blocks the plugin tree. The reported platform and operation flags remain Cinlan IDE CLI facts; this package does not embed an operating-system automation backend.

## Public commands

| Computer Use operation | CLI argv after the configured executable |
|---|---|
| `capabilities` | `computer capabilities --json` |
| `listApps` | `computer list-apps --json` |
| `listWindows` | `computer list-windows --app <appId> --json` |
| `observe` | `computer get-app-state --app <appId> [window/restore/screenshot flags] --session <sessionId> --json` |
| `click` | `computer click ... --session <sessionId> --json` |
| `performSecondaryAction` | `computer perform-secondary-action ... --session <sessionId> --json` |
| `scroll` / `drag` | `computer scroll|drag ... --session <sessionId> --json` |
| `typeText` / `pasteText` | `computer type-text|paste-text ... --text-stdin --session <sessionId> --json` |
| `pressKey` / `hotkey` | `computer press-key|hotkey ... --session <sessionId> --json` |
| `setValue` | `computer set-value ... --value-stdin --session <sessionId> --json` |

Window ids are accepted only in the canonical `id:<number>` or `index:<number>` form. Text and values use subprocess stdin rather than argv. The provider parses only the current public response fields, rejects process/envelope disagreement and duplicate or inconsistent identities, and maps public CLI failures into structured `ComputerUseError` codes.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerId` | `cinlan` | Provider id registered on `ctx.computerUse`. |
| `command` | `orca` (`orca-ide` on Linux) | Bare executable name or absolute path resolved by `ctx.subprocess`. |
| `cwd` | `process.cwd()` | Child-process working directory. |
| `commandTimeoutMs` | `65000` | Deadline for executable lookup and each command. |
| `graceMs` | `3000` | Subprocess TERM-to-KILL grace. |
| `maxJsonBytes` | `16777216` | Complete stdout JSON byte cap. |
| `maxStderrBytes` | `65536` | Captured stderr byte cap. |
| `maxImageBytes` | `16777216` | Screenshot byte cap before attachment persistence. |

Unknown keys, padded or empty strings, non-integer bounds, non-positive bounds, unsafe integers, and timer values above Node's supported delay fail during plugin setup.

## Runtime, screenshots, and lifecycle

Each spawn uses explicit stdin/stdout/stderr dispositions, forwards cancellation, applies the provider deadline, and removes `ORCA_PAIRING_CODE`, `ORCA_REMOTE_PAIRING`, and `ORCA_ENVIRONMENT` from the child environment. The provider therefore selects the local Cinlan runtime rather than ambient remote pairing.

The CLI `runtimeId` is a generation marker. A changed generation clears all observations, and actions additionally reject a generation change discovered during their preflight. Each action consumes the exact prior observation before issuing input and publishes a fresh post-action observation; stale observations and element ids fail before an unrelated target can receive the action.

Screenshots may arrive as canonical base64 or an absolute, unexpired temporary PNG path. The provider accepts only regular non-symlink files, checks the configured byte cap and stable file size, validates the PNG signature, returns bytes to the Consumer, and never exposes the temporary path in a model result.

Plugin disposal unregisters the Provider, stops accepting calls, aborts and joins in-flight CLI processes, and clears observation state. The external Cinlan runtime and desktop applications are not provider-owned and remain running.

## Model Experience

### Provider-backed desktop results

#### What the model sees

The Provider contributes no model text directly. [`@deepseek-ai/dsh-tool-computer-use`](../tool-computer-use/README.md) turns validated application, window, observation, action, and screenshot values into `computer_*` results and exposes provider, transport, timeout, stale-runtime, stale-observation, stale-element, and protocol failures through the ordinary error result.

#### Token effect

CLI execution and response validation add no request tokens; only the Consumer's rendered result or error contributes model-visible tokens.

#### KV Cache effect

Runtime generation, session namespace, and observation state do not change the reusable request prefix; Consumer configuration owns prompt and tool-definition changes.

## Known Limitations and Deferred Work

- The Provider requires an installed, resolvable Cinlan CLI whose `computer` command is authenticated and available on the local host.
- Harness tests use deterministic CLI fixtures; this package does not itself prove real UI Automation, macOS Accessibility, AT-SPI, compositor, or platform-permission behavior.
- Capability discovery is exposed by the Service Definition, but setup requires only application and window listing; unsupported action families fail through the CLI at execution time.
- The Provider has no remote pairing, Execution Host integration, display-server ownership, persistent desktop lease, Mobile Device, emulator, simulator, Speech/Audio, or Browser implementation.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

Only successful executable lookups are cached. A failed lookup can be retried after installation or PATH repair; caller cancellation and plugin disposal abort an in-flight lookup.

### Dev Note

None.
