# Agent Note: Relay deployment and Cinlan identity are independent prerequisites

Status: implemented

English | [中文](2026-10-21-relay-deployment-account.zh.md)

## Problem

A built-in Director address cannot establish that an operator has deployed a private Relay. DeepSeek Platform credentials cannot establish the Cinlan sign-in state shown by the account page. Inferring either fact enables an unavailable route or binds access to another account.

## Decision

The [mobile Host](../../../../packages/bundle/cinlan-remote-tunnel/src/host.ts) requires explicit deployment configuration and the same AccountController projection used by the Cinlan account page. Unconfigured operator responses hide the internal address. Configured users retain custom Director and region selection. New Hosts start locally; saved transport choices are not overwritten.

Cinlan stored-record changes synchronously invalidate the Relay generation, close Relay peers and clear reconnect timers and invitations. Subsequent connection attempts and Relay requests read the current account projection. Direct connections and enrolled device credentials remain intact.

## Alternatives considered

**Infer deployment from a non-empty URL or connection status.** A shipped default and an offline configured service are indistinguishable under that test.

**Disable Relay permanently in the client.** This conceals unavailable deployment without supporting configured installations and cannot enforce Host access.

## Consequences

Operators explicitly configure the deployment before enabling Relay, as described in the [upgrade guide](../../../../docs/upgrade-guide/v0.2.1-alpha.1/cinlan-mobile-connection/guide.md). Stored Sub2API credentials indicate local sign-in; this is not an additional cloud identity verification or a replacement for Director enrollment policy.

## Verification

Host socket tests cover missing deployment, account mismatch, sign-out and reconnection. Client tests cover unavailable, signed-out and configured states; a real Loader test covers credential events, stale reads and disposal. A cold-start Web check confirms one unconfigured notice and a hidden internal address. Public Relay and real account sign-in remain unverified.
