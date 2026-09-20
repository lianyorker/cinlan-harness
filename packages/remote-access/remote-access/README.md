---
description: "Opt-in HTTPS phone pairing into the existing Desktop Host and Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-access

English | [中文](README.zh.md)

## Summary

This package owns the direct HTTPS listener, one-time pairing invitations, durable device grants, and Session-scoped Gateway policy. Desktop supplies its existing update admission and paired assets through the typed RemoteAccessHost capability. It does not start a second Host or Session writer.

## Configuration and authority

The listener defaults to disabled. Set host, port, advertisedOrigin, tlsCertificatePath, and tlsPrivateKeyPath before enabling it locally. An absent TLS path or Host capability produces not-configured status without opening a port. Invalid configured certificate dates, hostname, key, or address fail enablement. The advertised origin must use HTTPS; forwarded headers never change it. Configuration also bounds invitation lifetime and attempts, credential lifetime, request bytes and timeout, connections, logical streams, and queued event frames/bytes.

A local Gateway invocation creates an invitation with explicit Session references and read/send/stop/question/approval scopes. The exchange consumes the code once and persists only a digest of the randomly generated device credential. A Secure, HttpOnly, SameSite=Strict host cookie carries the credential. Expiry and durable revocation terminate active requests and streams. Device metadata excludes credential values and digests.

The delegated policy authorizes endpoint arguments before provider lookup, projects Session aggregates, filters notifications and pending interactions before delivery, and binds event results to their authenticated device. Raw Fetch resources and unrelated Host methods are denied. The original approval and question owners retain policy, race settlement, and Session audit ownership.

## Model Experience

Indirectly, through existing Session commands that accept authorized phone messages and interaction responses without expanding the requesting Agent's approval policy.

#### KV Cache effect

Pairing and reconnection do not alter model history or cache keys. Existing Session commands own any model-visible changes.

## Known Limitations and Deferred Work

The direct client is a phone browser; signed Android and iOS packages and physical-device provisioning are separate delivery work. A certificate fingerprint display does not make a browser trust a self-signed certificate. Deploy a trusted certificate or provision an appropriate private CA through an operator-controlled process; certificate verification is never disabled.

Text prompts, history, streaming, stop, questions, and approvals form the initial grant surface. File uploads, arbitrary file reads, queue editing, subagent controls, and Host administration require separate authorization work. Disabling the listener is runtime state; a persisted enabled deployment configuration can enable it again at the next Host activation.

No invariant companion is published: grant validity is checked against durable credential records at authentication, and each active capability owns its expiry/revocation signal rather than a separately maintained observation.
