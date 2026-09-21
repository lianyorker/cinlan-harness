# Agent Note: Sidebar terminal processes and transport scopes have separate lifetimes

Status: implemented

English | [中文](2026-09-17-sidebar-terminal-lifetimes.zh.md)

## Problem

A terminal tab, its native process, and its current stream connection can disappear independently. Treating a tab id as a process id lets a delayed close kill a replacement process. Closing through a private WebSocket route also ties an otherwise available native terminal to an HTTP server, while an unawaited Client disposer allows an old activation to retain transport work after replacement.

## Decision

The sidebar native provider owns PTY creation, retained output, input, resize, acknowledgement, parking, and termination. The [sidebar terminal Service Definition](../../../../packages/terminal/sidebar-terminals/README.md) exposes those operations independently of a Web server. Its authenticated [Remote controller and Client factory](../../../../packages/api/sidebar-terminal-controller/README.md) use the existing Connection carrier in Web and Desktop. UI registration injects ordinary callbacks into terminal views; a feature UI does not import Gateway runtime values or own a second transport.

A UI terminal has a Session/tab target, a native process id, and a separate stream attachment id. Reattaching to a surviving process changes the attachment without granting an old attachment authority over a replacement. Input, resize, credit and release address the admitted attachment. Explicit UI close requires the exact native process id. When the Client has no cached process id, it first performs read-only inspection; inspection cannot spawn, unpark, resize, or extend retention. A stale or absent process therefore cannot cause close to create or terminate a different process. Agent attach and close carry both the owning Session and independently assigned terminal UUID; a foreign Session observes the UUID as not found.

A sidebar UI process captures one Session execution lease at admission and retains it until native exit and provider termination settle. Concurrent opens for the same Session/tab serialize admission, so they cannot allocate competing PTYs. Local Sessions keep the native node-pty owner, and local UI and Agent shells receive the shared subprocess service's credential-scrubbed parent environment. SSH Sessions allocate through the captured subprocess provider, resolve shells and floating directories in the same POSIX world, and preserve that execution incarnation across reattachment. Lease loss rejects the stream and terminates the captured process; it cannot silently choose local providers. Shutdown waits for pending allocations as well as published handles, including output paused by renderer backpressure.

The native PTY also owns its human title. Rename compares the observed process id before changing it; a delayed editor cannot rename a replacement under the same tab. Retained-list recovery projects only live Host processes into the existing layout, scoped to Session and floating window. Enumeration cannot extend retention, and a late answer cannot overwrite a newer local rename or reopen a locally closed tab. Persisted layout metadata does not grant a saved process identity authority after Host restart. Titles and native process facts do not enter Session JSONL.

The built-in terminal tab's close hook invokes the matching UI or Agent operation even when the terminal renderer never mounted. The tab registry's close notification is synchronous, so a rejected asynchronous close is reported as a diagnostic rather than an unhandled rejection or a claim that native termination completed. Closing a stream releases its attachment; explicit process close and Host teardown have their own native ownership.

Each sidebar UI activation obtains a transport scope from the Client factory. Scope disposal is memoized and remains tracked until it settles. Provider withdrawal closes admission and aborts its lifetime, then awaits every active or already-disposing scope; failures are retained in an aggregate result. UI disposal awaits its scope as well. The Host controller registers asynchronous shell discovery, input, and resize before provider entry; disposal aborts admission and awaits those calls as well as open/watch iterators. This preserves cleanup ownership during concurrent UI disposal, provider unload, and reinitialization.

Terminal output uses acknowledged bounded frames. The native owner, controller queue, and carrier each bound the complete values they retain or emit, including their own metadata. Replayed terminal text can expand substantially when JSON escapes control characters; capacity cannot be inferred from unescaped character count. The existing native replay cap and default transport limits admit a full retained transcript through real authenticated acknowledgement flow. Cancellation and natural exit both settle the iterator, controller operation, and carrier resources.

The legacy terminal WebSocket endpoints and unfenced JSON close operation are removed. There is one production path for these operations, so a caller cannot bypass native process identity checks by choosing another route. Desktop retains the Web bundle's sole sidebar selection and the duplicate bundle's existing self-disable rule; it does not start an HTTP listener to obtain terminal capability.

The [sidebar composition decision](../feature/2026-09-10-worktree-sidebar-security-integration.md) still owns the choice of one sidebar and terminal implementation. The [portable execution-world decision](2026-07-28-portable-execution-world-consumers.md) still owns core filesystem/subprocess consistency and terminal cleanup. Neither decision is superseded; this note specifies the sidebar's process identity and transport lifetime. The [floating workspace decision](2026-09-17-floating-workspace-command-ownership.md) owns captured window/Session targets.

## Alternatives considered

**Close by Session/tab alone.** A delayed request can find a new process under the same logical tab. Native identity must be checked by the operation that closes the process.

**Connect a terminal to discover what should close.** Connection can create or unpark a process and refresh its retention. Read-only inspection obtains existing identity without those effects.

**Keep private WebSocket and Remote implementations together.** Separate admission, authentication, cleanup, and close rules can diverge. Existing carriers provide both applications with the same terminal operations.

**Discard a disposing scope before its cleanup finishes.** A later provider unload would miss that pending operation and report completion while it still owns work. Tracked, memoized disposal gives both callers the same settlement.

## Consequences

Saved shell settings apply when the next sidebar UI or Agent PTY is created; live xterm preferences affect current renderers. These settings do not change the core Shell tool or resurrect a process after Host restart. A capability probe reports transport and native-provider availability without starting a PTY, and does not guarantee that a later executable launch will succeed.

Real Loader tests cover factory publication, withdrawal, concurrent disposal, and reinitialization. Native and controller cases cover identity fences, empty-cache close inspection, unavailable dependencies, and cleanup. A default-carrier case reconstructs the full retained transcript containing control characters through native-sized DTO frames, actual authenticated ACKs, natural exit, and complete teardown. UI close tests cover unmounted renderers and failure diagnostics. These observations establish owner behavior; assembled Web and Electron checks still establish application integration.
