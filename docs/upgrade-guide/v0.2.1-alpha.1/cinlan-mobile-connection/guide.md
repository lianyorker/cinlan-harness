---
kind: upgrade-guide
description: "Cinlan Mobile uses versioned encrypted pairing with direct or self-hosted Director/Cell routing."
---

# Cinlan mobile connection

English | [中文](guide.zh.md)

## Change

The mobile companion connects to a Web or Desktop Host through a single direct mode (`local` or `lan`) or a self-hosted `relay` mode. Pairing links contain a short-lived, single-use ticket; the Host stores only credential digests and can revoke each device independently. Director and Cell deployments issue regional leases and forward encrypted WebSocket frames without reading application messages.

The mobile listener is separate from the loopback operator API. It serves the built mobile application and accepts only the versioned pairing, authentication, session, prompt, and approval protocol. The protocol uses a pinned Host public key, nonce-bound context, expiry, replay checks, payload limits, and connection-bound credentials.

## Deployment

Run the supported `dsh` profile for the Host or the `mobile-relay` profile for a combined, Director, or Cell node. Set `stateFile` to a private `0700` directory. A Cell requires `directorUrl`; a remote Director or Cell requires HTTPS unless `allowInsecureNetwork` is explicitly enabled for a development LAN. Keep the operator API on loopback and expose only the mobile listener or relay ports.

Configure one Host connection mode in Companion settings. `local` binds the mobile listener to loopback, `lan` binds it to the selected local address, and `relay` obtains a regional lease from the configured Director. Do not copy pairing links into logs or issue them after their displayed expiry.

## Migration

1. Replace any old PIN or room-manager deployment with the current `cinlan-mobile-host` and `@cinlan/mobile-relay` rows. The versioned protocol has no legacy PIN or relay compatibility path.
2. Give each Director and Cell a distinct private `stateFile`, region id, URL, capacity, and enrollment policy. Configure every Cell in the Director's `regions` list and verify `/health` before pairing a Host.
3. Open Companion settings, select exactly one connection mode, set the machine name and optional region, then leave each text field to save. Generate a new pairing link for every device; old links cannot be reused.
4. Verify device revoke, reconnect, lease renewal, and Cell failover with the focused Host/Cell tests and the browser companion scenario before exposing a LAN address.

## Limitations

The current E2EE handshake pins a long-lived Host key and is not a claim of Orca-equivalent security or complete forward secrecy. Protect Host state files and browser storage, use HTTPS for remote Director discovery, and treat a lost phone as a revoked device.
