---
id: 'general/protocol/08-wecom-smart-bot-quoted-image'
title: 'WeCom Smart Bot long-connection quoted reply and image bridge'
title_en: 'WeCom Smart Bot long-connection quoted reply and image bridge'
summary: >
  Use the official WeCom Smart Bot WebSocket SDK for bidirectional text and
  image bridging without a Webhook, URL callback, public ingress, or SSH
  relay. Preserve an opaque route token in quoted source text and keep secrets
  out of process arguments and local IPC.
summary_en: >
  Use the official WeCom Smart Bot WebSocket SDK for bidirectional text and
  image bridging without a Webhook, URL callback, public ingress, or SSH relay.
board: 'general'
category: 'protocol'
signals:
  - 'WeCom Smart Bot'
  - 'WeCom long connection'
  - 'openws.work.weixin.qq.com'
  - '@wecom/aibot-node-sdk'
  - 'WECOM_BOT_ID'
  - 'WECOM_BOT_SECRET'
  - 'WeCom quote reply'
keywords:
  - 'quote_text'
  - '[DY:XXXXXXXXXX]'
  - 'WebSocket'
  - 'NDJSON IPC'
  - 'message dedupe'
  - 'media upload'
  - 'media decryption'
difficulty: 'intermediate'
tags:
  - 'protocol-integration'
  - 'websocket'
  - 'message-routing'
  - 'media-handling'
language: 'en'
last_updated: '2026-08-06'
related_articles:
  - 'general/protocol/03-websocket-protobuf-source-first'
  - 'general/protocol/06-douyin-feishu-quoted-reply'
  - 'general/protocol/07-douyin-web-outbound-image'
---

# WeCom Smart Bot long-connection quoted reply and image bridge

## Scenario

A local bridge forwards private messages into one internal WeCom group. The operator replies to the correct source conversation through WeCom's native quote UI. The deployment must not depend on an inbound URL, public reverse proxy, group message-push Webhook, or SSH relay.

## Current Official Interface
- WeCom documents a Smart Bot long-connection mode at `developer.work.weixin.qq.com/document/path/101463`.

- The official Node package is `@wecom/aibot-node-sdk`.
- Authentication uses a Bot ID and Secret.
- The default endpoint is `wss://openws.work.weixin.qq.com`.
- The SDK provides heartbeat, reconnect, `sendMessage`, `uploadMedia`, `sendMediaMessage`, and encrypted media download.
- As of this update, no official Go SDK is published for this interface.

## Method

1. Keep the platform-facing Adapter in the main Go process, but run the official Node SDK as a managed sidecar.
2. Pass Bot ID and Secret only through inherited environment variables. Do not put either credential in TOML, command arguments, stdout, or NDJSON IPC.
3. Reserve stdout exclusively for framed NDJSON. Send sidecar diagnostics to stderr, redact credentials and URLs in Node, and repeat credential
4. Represent sidecar state explicitly: `connected`, `authenticated`, `reconnecting`, `disconnected`, and `error`. Treat only `authenticated` as
5. Resolve the outbound group from an explicit Chat ID or a group `/bind` command. Do not infer the most recent group.
6. Keep `[DY:...]` in each bridge-emitted source message. Normalize WeCom's quoted content to `metadata.quote_text`, then route only through the
7. Use `sendMessage(chatid, markdown)` for active text. Split at UTF-8 boundaries and avoid automatic request retries when an ambiguous response
8. For outbound images, validate and normalize bytes in Go, transfer bounded base64 through local IPC, call `uploadMedia`, then `sendMediaMessage`.
9. For inbound images, call the SDK's encrypted download helper, cap the body, transfer bounded base64 to Go, validate JPEG/PNG/GIF/WebP again, and write a
10. Keep message-ID dedupe and route-token TTL in memory. A restart invalidates prior quote tokens and runtime group binding.

## Operation Chain

```text
Douyin private event
  -> [DY:token] source text + optional normalized image
  -> Go WeCom Adapter
  -> local NDJSON request
  -> official Node SDK
  -> WeCom Smart Bot long connection

Operator quotes source text + @Smart Bot + reply
  -> official Node SDK message event
  -> quote content -> metadata.quote_text -> [DY:token]
  -> Router session lookup
  -> original Douyin private conversation
```

## Status Contract

| Field                    | Meaning                                        |
| ------------------------ | ---------------------------------------------- |
| `credentials_configured` | Bot ID and Secret are loaded                   |
| `long_connection_ready`  | SDK authentication completed                   |
| `target_chat_configured` | explicit Chat ID or `/bind` is present         |
| `connected`              | both long connection and target chat are ready |

It is valid for `long_connection_ready=true` and `target_chat_configured=false` during first-time group binding.

## Verification Criteria

- The SDK reports `connected` followed by `authenticated` with no credential output.
- The Go process reports long-connection ready through its status endpoint.
- A quote event preserves the source token in `metadata.quote_text`.
- Normal unquoted traffic, unknown tokens, expired tokens, and route mismatches produce no source-platform send.
- Text and image requests receive correlated IPC responses and honor timeout.
- Inbound image temporary files are removed after success, failure, duplicate, cancellation, and unknown-token paths.
- The sidecar exits when the parent closes stdin or sends `shutdown`.
- Package audit reports no known high-severity production dependency issue.
- Real-group text and image delivery is still required before production completion; an authenticated WebSocket alone is not recipient-delivery proof.

## Constraints and Common Mistakes

- Do not retain the old combination of group Webhook outbound plus encrypted HTTP callback inbound when the long-connection interface is available.
- Do not implement the wire protocol from memory when the official SDK exists.
- Do not emit SDK logs on stdout; one non-JSON line corrupts IPC framing.
- Do not mark the Adapter ready before authentication.
- Do not treat a configured Bot as a configured group; active messages require a valid chat ID.
- Do not log Bot ID, Secret, signed media URL, media AES key, base64, message body, or temporary path.
- Do not expose local status, IPC, or browser CDP ports to the network.
