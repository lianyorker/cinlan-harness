# Agent Note: Explicit Inspector fetch capture

Status: implemented

English | [中文](2026-10-19-inspector-fetch-opt-in.zh.md)

## Problem

Enabling runtime inspection implicitly captured complete fetch URLs, headers, and bodies, including credentials. Session data inspection and debugger activation do not establish intent to retain network payloads.

## Decision

The [Inspector library and plugin](../../../../packages/experimental/inspector/README.md#host-fetch-capture) and optional Inspector bundle default `captureFetch` to false. Only explicit true installs the fetch observer. A non-capturing Worker leaves the current global fetch function untouched, while source publishing and debugging remain available. Explicit capture retains its existing unredacted fields, bounds, cancellation, and cleanup.

This partially supersedes the implicit-capture choice in the [Session Inspector decision](2026-09-24-session-inspector.md); data ownership, navigation, and runtime transport remain active. The bundle stays experimental and off by default. No stable composition gains a debugger or a new setting as a result of this change.

## Alternatives considered

Hiding the Network panel does not prevent observation. Treating ordinary coding-view visibility as capture consent assigns security-sensitive behavior to a presentation preference. Partial ad hoc redaction could imply a guarantee without accounting for secrets in arbitrary URLs and bodies.

## Consequences

Network diagnosis requires a deliberate profile or library option and plugin reload. Disabling capture does not remove debugger evaluation authority; local debug endpoints remain privileged. Tests use synthetic local traffic and a real Worker to verify default and explicit-false no-capture behavior, explicit-true complete capture, global fetch restoration, Loader composition, rollback, and teardown. These checks are not stable promotion or browser visual acceptance.
