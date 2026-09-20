---
description: "Playwright provider for persistent Browser pages and verified element capture."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-playwright

English | [中文](README.zh.md)

## Summary

This opt-in Service Provider implements [`ctx.browser`](../browser/README.md) with Playwright. It launches an installed browser channel on the first operation, keeps a dedicated persistent profile under `$DSH_HOME/browser/profile` by default, and owns its BrowserContext, page ids, observations, selections, and element handles.

The provider supports persistent page listing, HTTP(S) navigation, accessibility snapshots, observation-bound clicks, PNG/JPEG viewport screenshots, temporary human element selection, verified element crops, and page closure. It does not call Orca or control operating-system windows.

## Table of Contents

- [Lifecycle and identity](#lifecycle-and-identity)
- [Verified element capture](#verified-element-capture)
- [Configuration](#configuration)
- [Managed Chromium](#managed-chromium)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="lifecycle-and-identity"></a>
## Lifecycle and identity

Each tracked page owns a lifecycle cancellation signal. External page closure aborts in-flight page operations with `BROWSER_PAGE_CLOSED`; an explicit `browser_close` still completes normally. Navigation and closure invalidate observations and selections, while a click consumes its observation before issuing the side effect and is never retried when the outcome is uncertain.

Snapshot element ids are scoped to one exact observation. A selection id holds one provider-owned element handle and is consumed after its capture attempt. Plugin disposal rejects new operations, aborts page work, releases retained handles, unregisters the provider, and closes the persistent BrowserContext once.

<a id="verified-element-capture"></a>
## Verified element capture

`selectElement()` installs one temporary hover highlight and resolves after a click, Escape, cancellation, timeout, navigation, replacement by another selection, or disposal. `captureElement()` accepts either an observation/element pair or a selection id, clips the element to the viewport, enforces byte and pixel limits, and verifies the element fingerprint and visible rectangle before and after screenshot encoding.

Changed, detached, invisible, stale, or oversized elements fail without publishing capture bytes. Click failures retain distinct stale, timeout, not-actionable, and provider-failure codes.

<a id="configuration"></a>
## Configuration

The plugin requires Browser, Settings, and the same-package `./runtime` service. Its browser-playwright Settings namespace persists browserChannel, headless, viewportWidth, viewportHeight, profileName, homePage, and searchEngine over the deployment defaults. Changes apply on Provider remount or profile restart, never during a live browser operation. Viewport preferences accept positive safe integers. Executable paths, storage directories, and provider identity remain deployment-only configuration.

| Key | Default | Meaning |
|---|---|---|
| `providerId` | `local` | Provider id registered with `ctx.browser`. |
| `storageDir` | `$DSH_HOME/browser/profile` | Dedicated persistent browser profile. |
| `browserChannel` | `chrome` | Installed channel: `chrome`, `msedge`, or `chromium`. |
| `executablePath` | absent | Explicit browser executable; overrides `browserChannel`. |
| `headless` | `false` | Run pages without visible windows. |
| `actionTimeoutMs` | `30000` | Browser launch and action timeout. |
| `navigationTimeoutMs` | `60000` | Page navigation timeout. |
| `maxElements` | `200` | Maximum interactive references in one snapshot. |
| `viewportWidth` / `viewportHeight` | `1440` / `900` | Browser viewport dimensions. |
| `maxCaptureBytes` | `10485760` | Maximum encoded bytes in one element crop. |
| `maxCapturePixels` | `4000000` | Maximum visible CSS pixels in one element crop. |
| `selectionTimeoutMs` | `60000` | Maximum wait for one human selection. |
| `profileName` / `homePage` / `searchEngine` | `default` / `about:blank` / `google` | Profile and navigation preferences applied on remount. |
| `maxHistoryEntries` / `maxNetworkEntries` | `100` / `100` | Records retained per open page. |
| `maxCookieCount` / `maxDownloadCount` | `100` / `20` | Cookies per import and retained downloads per page. |
| `maxTransferBytes` | `4194304` | Byte limit for uploads and download reads. |

profileName accepts safe lowercase names. default preserves storageDir; other names use storageDir/harness-profiles/profile-{name}. Cookie and browser storage isolation follows these directories; changing names neither copies nor deletes existing data. History/network retain only recent open-page metadata, removing URL credentials, query, and fragment and excluding headers and bodies. Page or Provider closure clears them.

Uploads set only the current observed input; page input/change handlers may submit data, and retry requires another observation. Download names are sanitized and reads enforce streaming byte limits; maxTransferBytes does not cap browser download network traffic or disk usage. Downloads beyond the per-page count limit are canceled and the list reports truncated.

<a id="managed-chromium"></a>
## Managed Chromium

The `./runtime` service reads Playwright registry metadata and executable files without launching a browser or requesting the network. Installed files, provider activation, and stopped/starting/running context state are independent facts. System Chrome and Edge remain system-managed; custom executable paths remain deployment-owned. The pinned browser version describes managed Chromium, not a system browser.

Explicit install and reinstall actions run the pinned Playwright package installer with `install chromium --no-shell` through Harness subprocess. The child receives a private `PLAYWRIGHT_BROWSERS_PATH`; the Host environment and shared Playwright cache remain unchanged. Playwright selects platform archives, upstream mirrors, extraction, completion markers, and auxiliary components. Managed launch passes the resulting Chromium executable explicitly, including headless launches. Remote diagnostics expose origins only, never URL credentials or paths. Installation inherits Playwright proxy environment variables; Windows system proxy settings are not imported automatically.

Runtime configuration defaults to `storageDir: $DSH_HOME/browser/runtime`, `installTimeoutMs: 600000`, `processGraceMs: 3000`, and `maxOutputBytes: 16384`. Browser profiles occupy a separate directory and component operations never remove them.

One Host-owned task survives Settings unmount and Remote disconnect. Cancellation requires its exact branded task id and waits for process-range termination plus staging cleanup. Progress may be unknown or reset for auxiliary archives; it is not an overall byte counter. Deadline or installer failures form recoverable failed tasks. A commit cannot be cancelled.

Reinstall creates a fresh generation and atomically replaces the active-generation file only after the executable and completion marker exist. Failed or cancelled staging preserves the active generation. Completed older generations remain until explicit removal; removal deletes managed generations without touching profiles or system browsers. Close the native context before install, repair, or removal. A filesystem lease excludes other Hosts while a native context or installer uses the runtime directory. An unclean Host termination can leave the lease directory; verify all associated Hosts and browsers have stopped before removing that stale lock. Installation tasks and progress are not resumed after a Host restart.

The native Browser window and Web sidebar iframe have separate pages, cookies, and login state. Plugin management is the sole activation owner; installing Chromium does not enable a plugin or launch a browser.

<a id="model-experience"></a>
## Model Experience

### Provider-backed Browser operations

#### What the model sees

The provider contributes no prompt or tool definition. [`@deepseek-ai/dsh-tool-browser`](../tool-browser/README.md) renders persistent page operations, and [`@deepseek-ai/dsh-tool-browser-element-capture`](../tool-browser-element-capture/README.md) renders selection and verified crop results.

#### Token effect

Only Consumer-rendered text and images contribute model input. Accessibility trees, element metadata, and crop images vary with page state.

#### KV Cache effect

Browser process state, profile contents, page ids, observations, and selections do not change the reusable request prefix; Consumer configuration and visibility own any prefix change.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- File presence and installation markers do not prove launch readiness; operating-system dependencies and executable integrity still require a real launch.
- Chromium receives the shared credential-scrubbed child environment.
- The dedicated profile is separate from the user's daily browser profile to avoid profile locks and unrelated personal state.
- Text/keyboard input, scrolling, trace, PDF, HAR, durable visit history, profile inventory/delete/rename, and per-tab profile selection remain unsupported.
- Human selection requires a visible headed browser window even though non-interactive operations support headless execution.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because the provider has no independently observable relation: `BrowserRuntime` owns provider registration, and each operation enforces page, observation, selection, and handle validity before publishing a result.
