---
description: "Trusted-local Remote management of direct phone pairing."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-pairing-controller

English | [中文](README.zh.md)

## Summary

The pairing Remote namespace exposes listener status, enable/disable, invitation creation/cancellation, and device revocation. It delegates lifecycle and persistence to [remote-access](../../remote-access/remote-access/README.md).

## Authority

Management executes only inside an authenticated trusted-local Gateway invocation. Direct calls without an authenticated caller and delegated paired-device calls cannot enable the listener, issue invitations, or change device grants. The executor checks authority; hiding a method in the phone UI is not its authorization mechanism.

## Model Experience

None, as this controller manages listener readiness and device grants without registering model tools, prompts, or Session content.

#### KV Cache effect

None. Pairing management does not alter model history.

## Known Limitations and Deferred Work

TLS configuration belongs to the remote-access deployment configuration. This controller does not generate certificates, modify trust stores, open firewalls, or provide native mobile builds.

No invariant companion is published: this adapter delegates state and authority checks to its injected lifecycle owner and retains no independent state.
