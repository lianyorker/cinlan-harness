# Agent Note: Sub2API account authorization

Status: implemented

English | [中文](2026-09-25-sub2api-account-authorization.zh.md)

## Problem

Sub2API account credentials authenticate the account-management API, while model requests need an API key issued by that account. Treating those values as one credential would persist account tokens in the model path, expose them to provider code, and make local credential deletion look like issuer revocation when it is not.

## Decision

The Host-side `llm-pi-ai` plugin registers a `password` flow under `llm-pi-ai/sub2api` only when the `dsh-authorization` service is injected. The flow always uses `https://api.cinlan.online/api/v1`, asks for the Cinlan account email and password, and asks for a TOTP code only when the login response requires two-factor authentication. The Account Settings client presents this flow as one Cinlan account card; provider and model configuration remain separate. The flow exposes no QR or device-login endpoint; same-Host phone pairing remains a separate feature owned by its pairing surface ([decision](../architecture/2026-09-20-same-host-phone-pairing.md)).

The flow uses the fixed `https://api.cinlan.online/api/v1` root and calls `/auth/login`, `/auth/login/2fa`, `/keys`, and `/auth/logout`. It lists keys before creating one, selects an active key matching the stored value or the `Cinlan Harness` name, and creates a key with that name when no reusable key exists. A created response must contain a positive safe-integer id and a non-empty key.

Only `{ kind: 'api-key', key }` is committed to `llm-pi-ai/sub2api`. Account access and refresh tokens remain in memory; the flow validates returned tokens before credential mutation, and its `finally` block submits any refresh token to logout. The flow checks its authorization signal before listing, before commit, and inside the credential mutation.

A failed commit or cancellation attempts to delete a newly created key with a fresh bounded cleanup signal for each reconciliation or delete request. A response missing only the id can be reconciled by the returned key value; an unreadable response or response with no safe identifier is not deleted by name because a concurrent login could own that key. Failed deletes, ambiguous ownership, cleanup request deadlines, and refresh-token logout failures produce `SUB2API_CLEANUP_FAILED` and log that the issuer may still hold residual state. An uncertain post-failure local credential read is also reported as cleanup failure without deleting the key, because local ownership cannot be confirmed. The authorization service observes the target-key `credentials/record-updated` event in the flow's asynchronous context and requires the flow to call `session.commit()` after that write. The `sub2ApiCleanupTimeoutMs` configuration field bounds each compensating key-delete, reconciliation, or logout request and defaults to 10,000 milliseconds.

The base bundle mounts `dsh-authorization` and `dsh-api-account-controller` beside `dsh-credentials-local` and `llm-pi-ai`; the web bundle mounts the feature-owned Account Settings plugin. The controller projects only registered-flow metadata and credential presence, gives the initiating caller a private notice/prompt stream, and accepts prompt answers through a one-way Remote command. Complete snapshots are limited to 256 KiB and individual frames to 64 KiB as serialized UTF-8 JSON; a 32-frame queue may discard only notices and fails closed when control frames cannot fit. Secret answers remain component-local until the command, while local sign-out states that it does not revoke remote access and is serialized against authorization for the same key, including the retained key of a cancelled runner that has not settled. The Account Settings client exposes only the fixed Cinlan flow, even though the Host authorization registry can retain other provider flows for compositions that need them. The Cinlan account flow does not select or configure a model route; model routes remain explicit `llm-pi-ai` settings.

This decision extends the generic credential and authorization ownership in the [credential records and authorization flows note](../architecture/2026-08-13-credential-records-and-authorization-flows.md); that note remains authoritative for the record union, flow settlement, and optional authorization seam.

## Alternatives considered

**Persist account access or refresh tokens as the model credential.** That would mix account-management authority with the key consumed by a model gateway and would make token redaction and rotation part of every model request. The flow commits only the issuer API key.

**Create a new remote key on every login.** Local deletion cannot revoke an issuer-owned key, so repeated login would accumulate active keys. Listing and reuse by stored value or stable name keeps the supported flow single-key oriented.

**Treat local record deletion as remote revocation.** The credentials service has no issuer-specific operation and cannot claim that a remote key was revoked. The flow performs best-effort cleanup only for a key it created during the failed attempt and can identify without a concurrent-owner guess; it reports residual state when cleanup does not complete.

**Let account login configure a model route.** Account authentication and model routing have separate owners and lifecycles. The account flow stores only the issuer API key; model routes remain explicit LLM settings with their own model and protocol contract.

## Consequences

A successful login stores no account token in settings, credentials diagnostics, or Session data. A later login can reuse an active issuer key because Sub2API returns the full key in the authenticated list response. Local sign-out still removes only the local record; an operator must revoke an issuer key through Sub2API when remote revocation is required. A refresh-token logout failure makes the authorization fail with cleanup-failed rather than reporting success.

The Account Settings surface makes the in-process authorization reachable but does not make an attempt durable. A process or page restart during prompts cancels the caller-owned stream; a new attempt can start after the runner releases its retained key, while a non-cooperative runner remains visibly busy until it settles or the process exits. A remote key can remain active after an unbounded server failure or an unreadable create response with no safe identifier; the error code, UI copy, and log make that limitation explicit rather than presenting local success or issuer revocation.

## Verification

`packages/llm/llm-pi-ai/tests/sub2api.spec.ts` covers the fixed API root, key creation, stored-key reuse, two-factor login, malformed token/list/create responses, missing credentials, commit failure and uncertain commit state, missing ids, failed deletes, logout HTTP and timeout cleanup failures, post-commit notification failure, and cancellation with remote cleanup. `packages/llm/llm-pi-ai/tests/loader-composition.spec.ts` boots the shipped plugin through Loader with and without authorization, invokes the flow against a validation failure, and observes flow removal after the pi-ai fiber is disposed. `packages/api/account-controller/tests/controller.host.spec.ts` covers prompt relay, secret-free projections, exact and oversized UTF-8 output limits, control-frame queue exhaustion, HTTP(S)-only notice links, cancellation, settled-attempt command rejection, delete/authorize serialization, local-only deletion, safe failure classes, and disposal. `packages/client/ui-settings-account/tests` covers stream and unary-command disposal, secret masking, attempt-identity frame rejection, the non-revocation warning, safe links, and Loader composition. `packages/bundle/base/tests/base.spec.ts` pins the authorization and account-controller rows and dependencies.
