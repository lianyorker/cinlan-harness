# Agent Note: Contain subprocess spill failures

Status: implemented

English | [中文](2026-09-23-subprocess-spill-failure-containment.zh.md)

## Problem

Output collection writes spill files from stream `data` listeners. A removed temporary directory or a later filesystem write failure could escape that listener and terminate the host instead of preserving the diagnostic tail.

## Decision

`OutputCollector` treats spill storage as best-effort. Open and append failures discard the incomplete file, report the failure once, and continue collecting the bounded in-memory tail with no spill path. The private per-process spill directory is created once; a later cleaner removal is reported and is not repaired during the same process.

The local subprocess provider reports through its plugin logger. SSH helper processes use their own logger, and direct `OutputCollector` callers receive a stderr diagnostic when they do not provide a reporter. Close and cleanup failures retain their existing tail-only behavior.

Local subprocess providers and SSH helper processes retain this failure containment. The fixes keep an unpublished path from being unlinked after a failed exclusive open, contain a throwing reporter, and reserve the temporary-cleaner hint for `ENOENT`.

## Alternatives considered

**Recreate the spill directory after `ENOENT`.** Repeated recreation can race a temporary-file cleaner and changes the process-wide storage lifetime; the current process stays tail-only until restart.

**Propagate the filesystem exception.** A stream `data` listener is not an acceptable failure boundary for a recovery artifact; propagation can become an uncaught host exception and lose the command result.

**Silently fall back to the tail.** The tail remains usable, but an owner logger is needed to explain why the full-output locator is absent and to diagnose temporary-file cleanup or capacity failures.

## Testing

Focused `OutputCollector` tests cover removed directories, a directory path replaced by a file, append `ENOSPC`, failed exclusive open (`EEXIST`), a throwing reporter, bounded spill disposal, tail preservation, and one-time reporting. Local provider, SSH provider, TypeScript, and `oxlint` checks cover the updated construction and reporting paths. Platform-specific POSIX process tests remain owned by their existing Linux lanes.

## Consequences

A spill failure no longer kills the host or rejects a successful child process solely because its recovery file is unavailable. The model receives the bounded tail and truncation metadata, while operators receive one diagnostic through the owning logger. A process that loses its private spill directory cannot regain full-output recovery until it restarts.
