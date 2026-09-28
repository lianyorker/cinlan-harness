# Agent Note: Remote WebSocket waits for application readiness

Status: implemented

English | [中文](2026-09-23-gateway-waits-for-application-readiness.zh.md)

## Problem

The Web Host keeps its HTTP listener alive while a profile restart is still mounting and auditing controllers. Gateway registered the Remote WebSocket upgrade route as soon as `connection` and `webServer` were injected, so a browser that reconnected during that interval could open a carrier before the application was ready. Connection then had to recover a stream whose Host services were not yet available.

## Decision

Gateway registers the WebSocket upgrade route only after the launcher-provided `ctx.appReady` signal commits successful startup. A Host that does not provide this optional signal keeps the existing immediate registration behavior, preserving embedded compositions. In-process Gateway invocation and streams do not depend on the signal.

The readiness listener is an effect-owned subscription. Disposing Gateway cancels a pending listener and disposes any mux created after readiness, including active sockets. A listener copied by a concurrent commit is guarded by a closed flag, so it cannot register a route after disposal.

## Alternatives considered

**Reject upgrades inside an always-registered route until ready.** This leaves a route and mux alive during the unsafe interval and changes the failure into an application-level WebSocket response; delaying registration lets Connection apply its existing carrier retry policy.

**Make every Host provide readiness.** Embedded Hosts and tests can own their startup ordering without a launcher, so making the service mandatory would add a requirement outside Gateway's transport contract.

**Delay the HTTP listener itself.** The Web page and ordinary HTTP lifecycle already belong to the launcher and WebServer; only Remote stream admission needs this gate, so delaying the listener would broaden restart behavior unnecessarily.

## Consequences

Restarting browser clients may observe a closed or unavailable Remote carrier until startup commits, then reconnect through the existing Connection backoff. No Remote stream enters a partially initialized Host. Hosts without a launcher readiness service retain the prior behavior, and the in-process transport remains available throughout. Complete-output overflow teardown is specified separately in the [Gateway output-limit note](2026-09-25-gateway-complete-output-limit-teardown.md).

## Testing

The Gateway Host suite verifies a pending readiness subscription rejects WebSocket admission, a committed signal accepts it, an already-ready signal registers immediately, and disposal removes the subscription without allowing a late commit to register a route.
