---
description: "@deepseek-ai/dsh-browser"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser

English | [中文](README.zh.md)

## Summary

This package owns one layer of the persistent Browser capability; its detailed service, provider, policy, or tool contract is defined by the sections below.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

`BrowserRuntime` is the Service Definition for persistent browser pages. It owns provider registration, deterministic provider selection, provider-neutral requests and results, branded cross-package ids, and `BrowserError`; concrete transport, model tools, permissions, attachments, and presentation remain in sibling packages.

## Service API

| Member | Behavior |
|---|---|
| `registerProvider(provider)` | Registers one stable provider id for the calling fiber and returns a disposer; blank or duplicate ids fail immediately. |
| `listPages(signal?)` | Lists the selected provider's persistent pages. |
| `openPage(request, signal?)` | Opens one page and returns its branded `BrowserPageId`. |
| `navigate(request, signal?)` | Navigates one page; the provider invalidates any prior observation. |
| `snapshot(request, signal?)` | Returns an accessibility tree, branded `BrowserObservationId`, and observation-scoped `BrowserElementId` values. |
| `click(request, signal?)` | Clicks an element only when its page, observation, and element ids are current. |
| `selectElement(request, signal?)` | Uses an optional Provider extension to wait for one human-selected element and returns temporary selection metadata. |
| `captureElement(request, signal?)` | Uses an optional Provider extension to return a verified observation-bound or selection-bound element crop. |
| `screenshot(request, signal?)` | Returns bounded encoded viewport bytes for Consumer-owned attachment persistence. |
| `closePage(request, signal?)` | Closes one persistent page. |

Every asynchronous member rejects through its returned Promise, including provider-selection failures that are known before provider I/O.

## Provider selection

`provider` optionally pins one provider id. Without it, execution requires exactly one registered provider whose cheap local `available()` check returns true.

| State | `BrowserError.code` |
|---|---|
| Configured id is not registered | `BROWSER_PROVIDER_CONFIGURED_MISSING` |
| Configured provider is unavailable | `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE` |
| No usable provider exists | `BROWSER_PROVIDER_UNAVAILABLE` |
| More than one usable provider exists | `BROWSER_PROVIDER_AMBIGUOUS` |
| A provider id is blank or duplicated | `BROWSER_PROVIDER_ID_INVALID` / `BROWSER_PROVIDER_DUPLICATE` |

Selection occurs for every call, so HMR disposal and provider availability changes do not leave a cached backend selection.

## Identity and freshness

`BrowserPageId`, `BrowserObservationId`, `BrowserElementId`, and `BrowserElementSelectionId` are opaque branded strings. An element id is valid only inside its exact observation. The optional capture extension accepts either an exact observation target or a temporary selection id; providers reject stale runtime generations, observations, selections, or elements with structured errors rather than guessing which live page or element the caller meant.

## Native extensions

BrowserAutomationProvider provides explicit home/search resolution, active profile identity, back/forward, page visits, network metadata, and cookie import. BrowserTransferProvider supplies observation-bound file uploads, page-owned download listings, and bounded byte reads. Providers without these extensions fail with BROWSER_FEATURE_UNSUPPORTED. Cookies enter only through the human Remote, not a model import tool; Consumers still own permissions.

## Model Experience

### Consumer-owned browser results

#### What the model sees

The package contributes no model text directly. [`@deepseek-ai/dsh-tool-browser`](../tool-browser/README.md) renders `ctx.browser` results and preserves `BrowserError` failures through the ordinary tool-result path.

#### Token effect

The Service Definition adds no request or result tokens; the model-facing Consumer owns those costs.

#### KV Cache effect

Provider registration, selection, and freshness state do not change the model request prefix; Consumer configuration owns any cache-affecting text or schema change.

## Known Limitations and Deferred Work

- Text entry, scrolling, PDF, and trace remain unsupported; core Providers may omit native extensions.
- Browser is not OS Computer Use. Native windows, desktop applications, global keyboard or pointer input, and operating-system controls require a separate capability.
- The Service Definition has no public provider-status event or page-change subscription; callers observe current state through operations and structured failures.


<a id="dev-note"></a>
### Dev Note

The package keeps transport, policy, and model-facing responsibilities in their dedicated layers; generated artifacts are not hand-edited.

No runtime invariant companion is published because provider selection and observation freshness are enforced before operation results are returned.
