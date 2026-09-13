---
description: "@deepseek-ai/dsh-browser-cinlan"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-cinlan

English | [中文](README.zh.md)

## Summary

This package owns one layer of the persistent Browser capability; its detailed service, provider, policy, or tool contract is defined by the sections below.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

This Service Provider implements [`ctx.browser`](../browser/README.md) with the public Cinlan IDE JSON CLI. It launches one argv-based `ctx.subprocess` process per operation, validates the complete JSON envelope and result before publishing state, and never invokes Computer Use commands or a shell. Plugin setup registers the provider immediately without resolving the executable or probing the runtime; executable resolution and the first CLI call happen lazily on the first operation, so a missing or unready Cinlan IDE CLI never blocks the plugin tree.

## Public commands

| Browser operation | CLI argv after the configured executable |
|---|---|
| `listPages` | `tab list --worktree <selector> --json` |
| `openPage` | `tab create --url <url> --worktree <selector> --json` |
| `navigate` | `goto --page <pageId> --url <url> --worktree <selector> --json` |
| `snapshot` | `snapshot --page <pageId> --worktree <selector> --json` |
| `click` | `click --page <pageId> --element <ref> --worktree <selector> --json` |
| `screenshot` | `screenshot --page <pageId> --format <png|jpeg> --worktree <selector> --json` |
| `selectElement` | `eval --page <pageId> --expression <selection script> --worktree <selector> --json` |
| `captureElement` | Verification `eval --expression` calls around one viewport `screenshot`, followed by Host-side crop. |
| `closePage` | `tab close --page <pageId> --worktree <selector> --json` |

The parser accepts only the current public response fields and the `{ id, ok, result|error, _meta: { runtimeId } }` envelope. Unknown fields, malformed result values, process/envelope status disagreement, duplicate page or element ids, non-canonical base64, and oversized output fail with structured `BrowserError` codes.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerId` | `cinlan` | Provider id registered on `ctx.browser`. |
| `command` | `orca` (`orca-ide` on Linux) | Bare executable name or absolute path resolved by `ctx.subprocess`. |
| `cwd` | `process.cwd()` | Child-process working directory. |
| `worktree` | `active` | Cinlan worktree selector sent to every command. |
| `commandTimeoutMs` | `65000` | Deadline for executable lookup and each ordinary command. |
| `cleanupTimeoutMs` | `15000` | Per-command deadline for overlay/marker cleanup and owned-tab disposal. |
| `graceMs` | `3000` | Subprocess TERM-to-KILL grace. |
| `maxJsonBytes` | `16777216` | Complete stdout JSON byte cap. |
| `maxStderrBytes` | `65536` | Captured stderr byte cap. |
| `maxImageBytes` | `10485760` | Image-file byte cap after base64 decoding and after crop encoding. |
| `selectionTimeoutMs` | `60000` | Deadline for executable lookup and human element selection. |
| `maxCapturePixels` | `4000000` | Maximum visible CSS-pixel area of an element crop, not decoded device-pixel count. |

Unknown keys, padded or empty strings, non-integer bounds, non-positive bounds, unsafe integers, and timer values above Node's supported delay fail during plugin setup.

`closeOwnedPagesOnDispose` is intentionally not a config key. Closing current-generation pages created by this provider instance is a lifecycle invariant: disabling cleanup would leave provider-owned persistent state after HMR or disposal, while listed and pre-existing pages remain outside provider ownership.

## Element selection and capture

`selectElement` installs a temporary hover overlay through `orca eval --expression`. A click selects an element; Escape or the selection deadline cancels. A successful selection retains a private DOM marker and returns a process-local `selectionId`. Capture claims that id before any asynchronous operation; concurrent calls and retries must obtain a new selection, including after cancellation or failure. Overlay cleanup is always attempted; failed selection and every capture attempt also remove the marker with a bounded best-effort command. Cleanup failure does not replace the primary result or error.

Selection-bound capture verifies the marked element fingerprint, visible rectangle, and viewport before and after a viewport screenshot. The Host uses `sharp` to crop the image using the decoded image-to-CSS viewport ratio and re-encodes PNG or JPEG. The actual encoding must match the requested format. Changed or missing elements, changed bounds or viewport, invalid image bytes, and exceeded limits return structured errors without a capture result.

Observation-bound capture returns `BROWSER_FEATURE_UNSUPPORTED`: Orca snapshot refs such as `e1` and `@e1` are opaque runtime handles, not CSS selectors. Use a human selection with this Provider; there is no selector guessing or full-page fallback.

## Runtime and lifecycle

Each spawn uses explicit stdin/stdout/stderr dispositions, forwards the caller `AbortSignal`, adds a provider deadline, and removes `ORCA_PAIRING_CODE`, `ORCA_REMOTE_PAIRING`, and `ORCA_ENVIRONMENT` from the child environment. The provider does not select a remote Cinlan runtime through ambient pairing state.

Executable lookup shares the operation deadline and cancellation signal. Only successful resolution is cached; a failed or cancelled lookup can be retried and does not cancel an independent caller.

The CLI `runtimeId` is a generation marker. A changed generation invalidates all observations and selections, and a page recorded under an older generation fails with `BROWSER_RUNTIME_STALE`. Every successful snapshot creates a fresh harness observation id; click requires that exact observation and one of its exact element refs. Navigation and click invalidate the prior observation before issuing the command.

Plugin disposal unregisters the provider, stops accepting calls, aborts and joins in-flight processes, then closes only pages created by that provider instance in the current runtime generation. Listed or pre-existing pages are never cleanup-owned. A runtime restart expires that ownership instead of turning disposal into a remote cleanup attempt. A `closed: false` reply is a cleanup failure; disposal still attempts all remaining owned tabs before reporting failures.

## Model Experience

### Provider-backed browser results

#### What the model sees

The provider contributes no model text directly. [`@deepseek-ai/dsh-tool-browser`](../tool-browser/README.md) turns validated page state into `browser_*` results and exposes transport, timeout, stale-runtime, stale-observation, stale-element, missing-page, and protocol failures through the ordinary error tool-result path.

#### Token effect

CLI execution and response validation add no request tokens; only the Consumer's rendered result or error contributes model-visible tokens.

#### KV Cache effect

Runtime generations, page ownership, and observation state do not change the reusable request prefix; Consumer configuration owns any prompt or tool-definition change.

## Known Limitations and Deferred Work

- The provider requires an installed, resolvable, authenticated Cinlan CLI and a worktree selector visible to that CLI.
- It intentionally has no remote pairing, Playwright fallback, browser-engine embedding, or direct Cinlan runtime API dependency.
- It does not expose OS Computer Use, desktop windows, downloads, traces, uploads, text entry, scrolling, or network inspection.
- Cleanup can close only current-generation pages this instance opened; a CLI/runtime restart ends the old generation and its observable ownership.


<a id="dev-note"></a>
### Dev Note

The package keeps transport, policy, and model-facing responsibilities in their dedicated layers; generated artifacts are not hand-edited.

No runtime invariant companion is published because CLI responses validate runtime, page, observation, and process ownership before publication.
