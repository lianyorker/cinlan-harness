---
description: "Secret-free account authorization state, caller-owned prompt streams, and local credential deletion over Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-account-controller

English | [中文](README.zh.md)

## Summary

The `account` Remote namespace exposes registered authorization flows to Account Settings without exposing credential records. It lists methods and local configured state, routes notices and prompt metadata only to the caller that started an attempt, accepts answers through a one-way command, and deletes local credential records without claiming issuer revocation.

## Table of Contents

- [Use the Remote](#use-the-remote)
- [Security and lifetime](#security-and-lifetime)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-the-remote"></a>
## Use the Remote

`snapshot` returns a complete list of registered authorization flows. `watch` immediately yields that secret-free view and then coalesces flow registration, in-flight, and credential-presence changes. Each flow contains its credential key, provider label, methods, in-flight state, and local record presence, kind, and writability. It never contains the record payload.

`authorize` opens a stream owned by the calling surface. The first frame supplies branded attempt and method identities. Later frames carry provider notices, prompt metadata, prompt withdrawal, and a discriminated settlement. Notice links cross the wire only when they are absolute HTTP(S) URLs without URL credentials. Failures use fixed classes instead of upstream exception text.

Call `answer` with the active attempt and prompt identities. Text and secret answers are resolved directly to the waiting authorization flow and never enter a snapshot, stream frame, controller log, or retained attempt view. Call `cancel` with the attempt identity to withdraw only that caller-owned operation.

`deleteCredential` accepts keys belonging to registered flows. It holds the authorization service's per-key exclusive reservation across the complete local read and delete, so direct authorization callers and controller attempts cannot start while deletion is pending; it also retains the controller's early in-flight check and rejects read-only records. A successful result reports whether a local record existed and fixes `issuerRevoked` to `false`: this operation does not call the issuer.

<a id="security-and-lifetime"></a>
## Security and lifetime

The controller depends on `typert`, `authorization`, and `credentials`. Authorization registry subscriptions and credential update events drive complete replacement snapshots. A complete snapshot is limited to 256 KiB and each authorization frame to 64 KiB as serialized UTF-8 JSON. A paused watcher accumulates no history, each authorization queue retains at most 32 frames, and the Client independently retains at most 16 notices. Only notice frames may be discarded; if control frames cannot stay within either limit, the authorization is cancelled and its stream fails with `account/output-limit`.

Caller cancellation or controller disposal aborts the owned authorization. Prompt cancellation combines the attempt signal with any flow-supplied prompt signal, so a provider cannot keep the controller waiting by omitting a prompt-local signal. The authorization service retains the credential key until the flow runner actually settles, so local deletion and a replacement attempt remain blocked after a non-cooperative flow's caller has received cancellation. The controller disposer directly detaches paused watch listeners, closes authorization attempts, rejects pending prompts, and waits for its `runAttempt` work; it does not own the provider runner retained by the authorization service. Generated `./typert` and `./remote` entries publish the Host descriptors and Client namespace.

No invariant companion is published because the controller has no durable projection independent from the authorization and credential services.

<a id="further-exploration"></a>
## Further Exploration

- [Credentials subsystem](../../../docs/subsystems/credentials.md) — credential keys, record storage, and authorization flow ownership.
- [Authorization seam](../../credentials/authorization/README.md) — provider registration, human interaction, and settlement.
- [API Gateway reference](../../../docs/api-gateway.md) — Remote generation and invocation.

<a id="model-experience"></a>
## Model Experience

None. Account authorization and local credential management are configuration-time operations, and their notices, prompts, and state do not enter model requests.

#### KV Cache effect

No invalidation; this controller adds nothing to a request prefix.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Local credential deletion cannot revoke issuer-side credential or account access. The user must revoke it at the issuer when required.
- Only currently registered authorization flows are listed. An orphan record from an uninstalled provider remains outside this Settings view.
- Attempts are process-local and caller-owned. Reloading the initiating page cancels the stream and requires a new authorization attempt.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because this controller has no independent durable projection; authorization and credentials own the state relationships it observes.
