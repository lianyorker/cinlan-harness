# Agent Note: Asynchronous sandbox preparation and execution-world paths

Status: implemented

English | [中文](2026-09-11-async-sandbox-execution-world-paths.zh.md)

## Problem

Confinement can require asynchronous work in the filesystem and process environment where a command runs. A synchronous argv wrapper cannot represent that preparation or its cancellation. Starting a foreground deadline only after preparation leaves part of the command unbounded; publishing a background process before preparation settles leaves cancellation without a complete owner.

A workspace path also belongs to that execution environment. Host-side canonicalization can inspect the wrong filesystem, while lexical normalization of `symlink/..` can select a different directory from the one the process enters.

## Decision

[Sandbox providers](../../../../packages/sandbox/sandbox/README.md) expose `confine(argv, policy, signal?): Promise<ConfinedArgv>`. Consumers await preparation before spawning and pass cancellation through it. [Shell executors](../../../../packages/shell/shell/README.md) expose `start(spec): Promise<ShellProcess>`; `resolve(request)` remains synchronous and applies defaults and policy before execution.

One foreground deadline covers confinement preparation, spawn, and execution. A timeout before spawn returns `timedOut: true`, empty output, null exit code and signal, and the selected sandbox mode with `denied: false`, without enforcement evidence. Preparation alone cannot prove that a runner enforced anything. Caller cancellation during confinement preparation rejects, and a preparation result arriving after cancellation cannot launch a command.

A subprocess handle can exist before native launch finishes. When its `done` rejects with the active deadline signal's exact abort reason, the local shell executor awaits `waitForExit()` without the cancelled signal before returning the timeout or abort result. Unrelated failures and cleanup observation failures propagate; a deadline result does not precede managed-range quiescence.

Generic `JobStart.run` remains synchronous. The [Bash](../../../../packages/shell/tool-bash/src/background.ts) and [PowerShell](../../../../packages/shell/tool-pwsh/src/background.ts) `processJob` adapters return hooks that own asynchronous preparation, cancellation, output, and settlement. Cancellation aborts preparation; any late process handle is killed and awaited before the job settles. On a subprocess provider rejection, local background executors retain `killed`, the diagnostic, and sandbox classification, then await `waitForExit()` without a signal before settling `ShellProcess.done`. Failed exit observation rejects `done`; `processJob` reports a failed job. Background work has no executor timeout. [Terminal startup](../../../../packages/terminal/terminal-bash/README.md) also awaits confinement with its open signal and rechecks cancellation before terminal spawn.

[Sandbox policy](../../../../packages/sandbox/sandbox-policy/README.md) preserves the absolute execution-world workspace root and rejects relative configured roots. Enforcing providers resolve filesystem identity where the files exist. The [Bash tool](../../../../packages/shell/tool-bash/README.md) appends relative working-directory components without collapsing symlinks or `..`, and preserves POSIX roots and separators when the Harness runs on Windows.

## Alternatives considered

**Keep confinement synchronous or start the deadline after preparation.** An asynchronous provider needs cancellable preparation, and preparation consumes the same foreground time budget as execution.

**Make generic job admission asynchronous.** The shell tool already owns shell preparation. Synchronous job hooks can own its complete lifetime without changing admission for unrelated job producers.

**Canonicalize paths in shared policy or normalize relative working directories on the Harness host.** Only the execution provider knows the filesystem identity; preserving path components avoids changing symlink-sensitive traversal or interpreting POSIX roots as Windows paths.

## Consequences

Providers and consumers await preparation explicitly, while request resolution and job admission keep their existing ownership. Each spawned command retains its own enforcement facts. Local runner selection, synchronous probes, Windows ACL grants, private temp authority, and partial-enforcement reporting retain their provider-owned mechanics; asynchronous signatures do not make synchronous local work preemptible.

The [portable-consumer decision](2026-07-28-portable-execution-world-consumers.md), [shared-policy decision](../feature/2026-07-14-cross-family-fs-sandbox.md), [Windows sandbox decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md), and [SSH provider decision](2026-09-11-posix-ssh-runtime.md) remain active for their independent architecture and platform rationale. This note owns generic preparation timing, cancellation, and path preservation.

## Verification

Required evidence distinguishes timeout from caller cancellation during preparation, rejects late spawn after cancellation, retains per-process enforcement facts, and proves that foreground cancellation waits for managed-range quiescence and job cancellation waits for a late handle to settle. Background provider failures require evidence of managed-range quiescence before settlement and rejection when exit observation fails. Path evidence covers rejected relative configuration, preserved symlink/parent components, and POSIX roots on a Windows Harness. Source tests and built-artifact checks require separate execution evidence; native runner behavior requires platform-specific evidence.
