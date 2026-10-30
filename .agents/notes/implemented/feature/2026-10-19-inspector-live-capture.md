# Agent Note: Live Inspector capture requests

Status: implemented

English | [中文](2026-10-19-inspector-live-capture.zh.md)

## Problem

Changing capture through plugin reload replaces the debugging Worker and browser endpoint. A UI setting must not enable sensitive collection without explicit acknowledgement or confuse persisted intent with an applied runtime state.

## Decision

The [Inspector reference](../../../../packages/experimental/inspector/README.md#host-fetch-capture) owns a live capture reference and an awaitable handle operation. Capture transitions serialize over one observer owner; disabling restores fetch and drains old observations, while Worker identity and retained records survive. Observer installations use distinct request-id namespaces to prevent collisions in the retained Worker store. Stopped wrapper references delegate to their original fetch; late response and error completion does not publish more observations or cancel the application’s request. Closing rejects pending enable operations and waits for capture cleanup before releasing the Worker. Installation failure rejects the handle operation and permits retry. The Host plugin logs asynchronous apply failures without claiming its saved config is runtime status.

The existing Developer tools section consumes only the generic settings namespace, not experimental runtime exports. It requires a fresh sensitive-data acknowledgement for each UI enabling action, closes confirmation on backend withdrawal or read-only state, and writes through the revision-fenced form. Persisted true resumes on Host restart without another acknowledgement. Neither the preference nor its UI mounts a missing debugging backend. The [default-off decision](2026-10-19-inspector-fetch-opt-in.md) remains active; this adds a live consumer without changing debugger authority or experimental isolation.

## Alternatives considered

Remounting loses the endpoint and requires browser reconnect. Reporting a saved value as active hides apply failures. Confirmation alone does not enforce programmatic profile writes, which remain explicit configuration operations. Deleting retained diagnostics on disable would add an unrelated data-erasure behavior.

## Consequences

Disabling stops observation, not access to already retained secrets or debugger evaluation. Tests cover real Worker interval capture, default-off behavior, serial transitions, failed installation and retry, close races, same-fiber Loader updates, profile cold restart, confirmation cancellation and invalidation, read-only state, and accepted-value UI feedback. Browser visual and stable product promotion remain separate work.
