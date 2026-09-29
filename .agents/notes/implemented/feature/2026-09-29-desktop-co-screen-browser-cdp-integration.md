# Agent Note: Desktop co-screen browser CDP integration

Status: implemented

English | [中文](2026-09-29-desktop-co-screen-browser-cdp-integration.zh.md)

## Problem

Human users operating the Cinlan Desktop environment view pages in sidebar webviews or persistent browser windows, while autonomous Browser Use agents require a Chrome DevTools Protocol (CDP) debugging endpoint to inspect and manipulate pages. Without a shared CDP debugging switch on the Desktop Electron shell and forwarding on the core browser runtime facade, agents could not attach to the live desktop environment, preventing co-screen pair programming where human and agent observe and interact with the same browser state.

## Decision

Introduce `desktopRemoteDebuggingPort` in `apps/desktop/src/browser-remote-debugging.ts` to resolve the configured CDP port from `DSH_DESKTOP_RENDERER_DEBUG_PORT`, `DSH_DESKTOP_CDP_PORT`, or `CINLAN_DESKTOP_CDP_PORT` (validated between 1024 and 65535). Configure `app.commandLine.appendSwitch('remote-debugging-port', ...)` in `apps/desktop/src/main.ts` when a port is configured, and permit webview DevTools inspection under `DesktopBrowserGuests` when remote debugging is active.

Extend the `BrowserRuntime` Service Definition in `packages/browser/browser/src/index.ts` with a `cdpEndpoint(): string | undefined` facade method that forwards to the active provider.

Add an end-to-end co-screen integration suite in `packages/bundle/cinlan-browser/tests/co-screen.spec.ts` demonstrating unified runtime boot, CDP port exposure, `--remote-debugging-port` persistent context launch, model tool execution, and element capture coexistence.

## Alternatives considered

**Require separate detached browser instances for user and agent.** Opening independent Chromium processes wastes system resources, doubles memory consumption, and forces users to re-authenticate across separate browser profiles.

**Attach solely via Electron main-process debugger webContents APIs.** Using proprietary Electron debugger APIs bypasses the standard MCP protocol and prevents external tools such as `@playwright/mcp` or Chrome DevTools MCP from connecting over standard WebSocket endpoints.

**Hardcode fixed debugging ports in desktop bootstrap.** Hardcoding ports leads to collisions when multiple desktop instances or local development servers run concurrently.

## Consequences

Desktop users and autonomous agents can share live browser sessions on the configured CDP port. Both the 16 native persistent browser tools and external MCP Browser Use providers can attach to and operate on the shared session.

When no debugging port is configured in the environment, standard isolation remains enforced without listening debugging ports.

## Verification

`apps/desktop/tests/browser-remote-debugging.spec.ts` covers port resolution priority, empty strings, and out-of-range port boundaries. `packages/browser/browser/tests/browser.spec.ts` verifies `cdpEndpoint()` forwarding on `BrowserRuntime`. `packages/bundle/cinlan-browser/tests/co-screen.spec.ts` verifies end-to-end co-screen execution with the complete `cinlan-browser` bundle.
