# Agent Note: Browser Playwright CDP bridge for Browser Use

Status: implemented

English | [中文](2026-09-29-browser-playwright-cdp-bridge-for-browser-use.zh.md)

## Problem

The persistent browser provider (`dsh-browser-playwright`) launched Chromium instances with isolated internal contexts, preventing model-driven Browser Use providers (`browser-use-playwright-mcp` or `browser-use-chrome-devtools-mcp`) in `mode: attach` from discovering or attaching to an already-open desktop browser session. Operating an existing browser tab without shared debugging endpoints forced agents to launch a secondary detached browser, duplicating resources and discarding the user's live session state.

## Decision

Extend the `BrowserProvider` capability interface with an optional `cdpEndpoint?(): string | undefined` method. The `dsh-browser-playwright` provider introduces an optional `remoteDebuggingPort` configuration option (validated within TCP port range 1024 to 65535, with optional environment variable fallbacks via `DSH_BROWSER_CDP_PORT` or `CINLAN_BROWSER_CDP_PORT`).

When `remoteDebuggingPort` is configured, Chromium launches with `--remote-debugging-port=<port>`, and `cdpEndpoint()` returns `http://127.0.0.1:<port>`. Browser Use agents configured with `mode: attach` can connect directly to this endpoint to inspect and manipulate pages alongside desktop user operations.

In addition, update `@deepseek-ai/dsh-experimental-browser-use-runtime` package metadata to declare explicit workspace peer dependencies for `@deepseek-ai/dsh-mcp-client` and `@deepseek-ai/dsh-scope`, while retiring the unreferenced legacy `@deepseek-ai/dsh-code-runtime` dependency.

## Alternatives considered

**Launch a secondary browser process exclusively for Browser Use.** Launching a secondary instance prevents agents from reusing existing user authentication states and increases system memory consumption.

**Dynamically allocate and inspect ephemeral CDP ports from Chromium stderr.** Parsing stderr adds asynchronous process-binding complexity and fails when stdout/stderr streams are redirected or suppressed under sandboxed execution.

**Expose raw Chromium WebSocket debugger URLs instead of an HTTP endpoint.** WebSocket URLs contain transient page GUIDs that rotate across restarts, whereas the local HTTP CDP endpoint provides stable endpoint resolution for MCP attach runners.

## Consequences

Live Sessions with `browser-use-playwright-mcp` can attach to the persistent Playwright browser when `remoteDebuggingPort` is set. The browser provider remains headless by default unless configured otherwise.

If no port or environment variable is set, no debugging port is opened and `cdpEndpoint()` returns `undefined`, preserving isolation for standard execution profiles.

## Verification

`packages/browser/browser-playwright/tests/provider.spec.ts` verifies valid and invalid `remoteDebuggingPort` range validation, launch option arguments containing `--remote-debugging-port`, and `cdpEndpoint()` return values with 100% statement, branch, function, and line coverage. `packages/experimental/browser-use-runtime/tests` verifies full Session resource acquisition and MCP client attachment.
