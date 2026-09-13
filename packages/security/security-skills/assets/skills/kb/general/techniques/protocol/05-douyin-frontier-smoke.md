---
id: 'general/protocol/05-douyin-frontier-smoke'
title: 'Douyin frontier WebSocket smoke diagnosis'
title_en: 'Douyin frontier WebSocket smoke diagnosis'
summary: >
  Use frame-level counters and a fixed upstream client to separate frontier
  handshake, server push, and Protobuf decoding failures.
summary_en: >
  Separate frontier handshake, server push, and Protobuf decoding failures
  with frame counters and an upstream A/B client.
board: 'general'
category: 'protocol'
signals:
  - 'Douyin frontier'
  - 'WebSocket'
  - 'binary frame'
  - 'protobuf'
  - 'keepalive'
mcp_tools:
  - 'kb_router'
  - 'anything-analyzer'
keywords:
  - 'frontier-im'
  - 'websocket-client'
  - 'PushFrame'
  - 'ws_binary_frames'
difficulty: 'intermediate'
tags:
  - 'protocol-analysis'
  - 'websocket'
  - 'protobuf'
language: 'en'
last_updated: '2026-07-31'
related_articles:
  - 'general/protocol/03-websocket-protobuf-source-first'
---

# Douyin frontier WebSocket smoke diagnosis

## Scenario

An authenticated Douyin chat page and an independent runtime connect to `frontier-im.douyin.com/ws/v2`. The runtime reports `ready` but does not forward private-message events. forward private-message events. forward private-message events. forward private-message events.

## Input signal

- Chrome 150 sends `Pragma`, `Cache-Control`, `Accept-Language`, `Accept-Encoding`, `Sec-WebSocket-Protocol`, and `Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits`.
- The server returns `101`, selects `pbbp2`, and in the observed session does not return a compression extension response header.
- The runtime can receive text/keepalive frames while `ws_binary_frames=0`; the browser chat history can still show a new message.

## Method

1. Capture the WS URL and User-Agent through CDP `Network.webSocketWillSendHandshakeRequest`. Reconstruct the frontier Cookie in memory with `Network.getCookies({urls:[wsUrl]})`; do not print it.
2. Expose redacted cumulative runtime counters for received frames, binary frames, decoded events, ignored frames, and decode errors.
3. Run a fixed upstream `websocket-client` A/B listener and record only frame opcode, length, and hash.
4. For a local runtime launch, collect Cookie, Device ID, and User-Agent from the logged-in chat page through CDP. CDP can read HttpOnly cookies through `Network.getCookies`; page JavaScript cannot.
5. Treat `DOUYIN_WEB_PROTECT_*` separately from WebSocket material. The chat page may not create `security-sdk/s_sdk_crypt_sdk` or `security-sdk/s_sdk_sign_data_key/web_protect` until its normal outbound security flow has run. Poll the page storage with a bounded interval after that normal client action; do not attempt to reconstruct the current SecureSDK dynamic chunk from a stale saved bundle.

## Verification criteria

- `/status` `ws_connected=true` means the handshake and IPC are ready; it does not prove that a binary PushFrame arrived.
- `ws_binary_frames` must increase before Protobuf decoding can be evaluated. `ws_decode_errors` increasing indicates a schema or decompression path.
- If both clients only receive text frames, inspect whether a new message was actually generated, connection arbitration, and server push conditions before changing the Protobuf schema.
- A redacted CDP collector can report Cookie, Device ID, User-Agent, storage presence, and missing field names. It must not print or persist Cookie, WebProtect fields, private keys, or signed URLs.
- A current-page check showing an empty WebProtect store is an initialization state, not proof that Cookie or Device ID collection failed. Wait for the normal client flow, then retry collection before starting an outbound-enabled bridge.

## Tool mapping

`Chrome CDP Network` provides runtime handshake evidence; `websocket-client` provides upstream handshake A/B; `tokio-tungstenite` is the production runtime; loopback `/status` provides redacted observability. production runtime; loopback `/status` provides redacted observability. production runtime; loopback `/status` provides redacted observability. production runtime; loopback `/status` provides redacted observability.

```powershell
Invoke-RestMethod http://127.0.0.1:18090/status
```
