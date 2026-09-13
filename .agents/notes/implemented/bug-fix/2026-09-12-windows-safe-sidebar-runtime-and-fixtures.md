# Agent Note: Windows-safe sidebar runtime and fixtures

Status: implemented

English | [中文](2026-09-12-windows-safe-sidebar-runtime-and-fixtures.zh.md)

## Problem

The sidebar upload path commits a completed temporary file by rename. POSIX replaces an existing target, but Windows can reject that rename when the target already exists; concurrent uploads to one target could therefore fail even though each upload had an independent temporary file.

The sidebar agent PTY path sent named termination signals through node-pty. On Windows node-pty defers the call and throws from its callback for named signals, outside the caller's try/catch, producing an unhandled error during teardown. The sidebar package also declared a node-pty range different from the subprocess provider's pinned version.

The Windows Node test runtime in this workspace can create directory junctions but may return UNKNOWN when following them. Directory-picker tests that require junction traversal must not turn that host limitation into a production behavior change.

## Decision

The upload commit keeps a unique temporary file per request. On Windows it removes a conflicting target and retries the rename a bounded number of times; POSIX keeps its atomic replacement. A failed upload still removes only its own temporary file and does not replace the target.

Agent PTY termination uses node-pty's default kill on Windows because that is its supported process-termination path. POSIX continues to receive the requested named signal, with the default kill as a synchronous fallback when the named call is rejected.

The sidebar package and its repair-status contract use the exact node-pty version 1.2.0-beta.15 declared by dsh-subprocess-local. Its plugin-shape test imports the workspace-rescoped loader package, @deepseek-ai/cordis-plugin-loader, and expects the scoped package identity.

Junction-dependent directory-picker and workspace-registry tests probe whether the current Windows process can follow a directory junction and skip only those cases when it cannot. The production directory and workspace behavior retains its symlink semantics. The sidebar smoke and grammar-loader tests have explicit 30-second budgets because their repository scan and complete grammar import can share resources with the GUI worker lane.

File symlink fixtures probe file-link privileges separately from directory-junction traversal. Directory-only cases remain active when Windows denies file symlinks; only cases requiring file links skip. The documentation publication escape fixture follows an outside directory link and unlinks it before cleanup, so Windows can verify the same real-path rejection without file-symlink privileges.

## Alternatives considered

Serializing all uploads would avoid the Windows replacement race, but it would unnecessarily couple independent requests and reduce throughput, so the bounded replacement retry is preferred.

Keeping the named Windows PTY signal inside a synchronous try/catch would not contain node-pty's deferred callback exception, so Windows uses the default kill path instead.

Changing production directory or workspace behavior to hide or avoid junctions would mask a test-runtime limitation and change supported filesystem behavior, so only the junction-dependent tests skip when the capability probe fails.

Retaining a semver range or the older node-pty version would leave the sidebar and subprocess provider on different native dependencies, so the sidebar uses the provider's pinned version.

## Consequences

Concurrent uploads no longer fail solely because Windows cannot rename over an existing file. Windows target replacement has a small remove-before-rename interval; the request remains protected from partial temporary output, but callers must not treat the replacement as an uninterrupted read transaction.

Termination, package metadata, and loader identity now match the current workspace runtime. Junction traversal coverage remains available on capable hosts and is reported as skipped on the affected Windows runtime instead of weakening the implementation.

## Verification

The focused sidebar and theme suites pass, including PTY dependencies, plugin exports, uploads, sidechat fixtures, chunk artifacts, manifest consistency, corner shape, elevation, scrollbar, smoke, and code-block grammar tests. The workspace registry suite passes with 43 tests and 2 junction-capability skips. The direct GUI aggregate passes with 430 files and 5,595 tests; one file and 12 tests are skipped for unsupported junction traversal. The required pnpm GUI and replay-web commands remain blocked before test execution by pnpm 11 failing to read the existing Windows node-pty junction package metadata.
