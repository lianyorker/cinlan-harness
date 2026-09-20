# Agent Note: Same-Host phone pairing uses explicit carrier authority

Status: implemented

English | [中文](2026-09-20-same-host-phone-pairing.zh.md)

## Problem

A phone needs to observe and control the same Sessions as Desktop without acquiring whole-Host browser authority or opening a second Session writer. Existing local carrier authentication identifies a trusted operator but cannot express per-device revocation, Session references, or restricted interaction rights.

## Decision

An opt-in HTTPS carrier runs inside the existing Desktop Host and shares its update admission, Gateway, Session, question, and approval owners. Connection requires explicit same-process carrier authority for shared Fetch and RPC dispatch. One Connection instance supplies the identity shared by its local HTTP and WebSocket adapters; each device grant has a separate opaque identity and cancellation lifetime.

Gateway binds delegated policies to those identities. It authorizes arguments before lookup, projects aggregate results and stream items, filters events before queueing or recording delivery, and checks event-response ownership. Delegated queues have frame and byte limits. Missing policies fail closed. Local management checks the authenticated unary invocation at its executor, so a paired device cannot issue its own invitation or broaden a grant.

Invitations have short lifetimes and bounded attempts, and successful exchange consumes a code once under serialized ownership. Credentials stores a digest, scopes, Session references, absolute expiry, and durable revocation metadata. The raw credential is issued only through a Secure, HttpOnly, SameSite=Strict cookie. Persistence commits before revocation cancels active requests and sockets; authentication cannot mint authority from a read that raced a revocation.

The carrier checks exact advertised HTTPS authority, Origin, and protocol version without changing the existing local trust fence. It reuses the Connection HTTP bridge and binds each WebSocket opener to authenticated authority. The Gateway mux counts pending and failed openings until delivery settles and closes a paired carrier before allocating an over-limit opening, so quota rejection cannot grow a queued error path. TLS requires a configured certificate valid for the advertised host. The [browser trust decision](2026-07-28-api-browser-trust-boundary.md) remains authoritative for local browser request protection; the [Typert invocation decision](2026-08-02-typert-remote-method-calls.md) retains descriptor and lookup ownership.

## Alternatives considered

**Issue the existing browser administrator cookie to phones.** This loses per-device and Session-scoped authority and would expose settings, credentials, plugins, and native actions.

**Boot another Web Host or proxy CLI output.** This introduces another writer or a separate interpretation of Session state. Reusing original controllers and interaction owners preserves persistence and audit settlement.

**Guard only UI actions or Gateway endpoints.** Raw Fetch routes bypass Gateway, and event streams can disclose data before a response is authorized. Enforcement belongs before each dispatch and event delivery.

**Automatically bypass self-signed certificate errors.** A displayed fingerprint does not establish browser trust. Operators must provision a valid trust chain; no system trust change or disabled certificate validation is part of pairing.

## Consequences

The direct browser client can use existing conversation rendering and Session generation replacement semantics. Pending questions and approvals replay through their original owner, with first-response settlement and cancellation retained. Unknown methods, new request fields, unrelated event kinds, and raw Fetch resources require explicit policy work before a device receives them.

The listener defaults to disabled and requires both TLS configuration and the Desktop lifecycle capability. Direct phone-browser evidence does not establish signed Android or iOS delivery. TLS provisioning, native distribution, and additional file or subagent capabilities remain separate concerns.
