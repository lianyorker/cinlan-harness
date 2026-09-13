---
id: 'general/protocol/06-douyin-feishu-quoted-reply'
title: 'Douyin to Feishu quoted-reply bridge'
title_en: 'Douyin to Feishu quoted-reply bridge'
summary: >
  Preserve a source-session token when forwarding a Douyin private message to
  Feishu, then route only replies quoting a message emitted by the bridge.
summary_en: >
  Preserve a source-session token when forwarding a Douyin private message to
  Feishu, and route only replies quoting a bridge-emitted message.
board: 'general'
category: 'protocol'
signals:
  - 'Feishu quoted reply'
  - 'Douyin bidirectional bridge'
  - 'request.MGet empty'
  - 'conversation_short_id precision'
  - 'Douyin self-message echo'
  - 'message_id cache'
  - 'parent_id'
  - 'root_id'
  - 'session token'
  - 'Douyin message_type 27'
  - 'Douyin cmd 500 empty content'
  - 'Douyin cmd 211 get_by_id'
  - 'Douyin image AES-256-GCM'
  - 'resource_url.skey'
  - 'application/octet-stream image'
  - 'Feishu image_key'
mcp_tools:
  - 'kb_router'
keywords:
  - 'im.message.receive_v1'
  - 'quote_text'
  - 'reply_to'
  - 'DY session token'
  - 'int64 JSON string'
difficulty: 'intermediate'
tags:
  - 'protocol-analysis'
  - 'websocket'
  - 'message-routing'
language: 'en'
last_updated: '2026-07-30'
related_articles:
  - 'general/protocol/05-douyin-frontier-smoke'
---

# Douyin to Feishu quoted-reply bridge

## Scenario

A local bridge forwards Douyin Web private messages to a Feishu application bot. An operator needs a human Feishu reply to reach the original Douyin private conversation without routing arbitrary group traffic. conversation without routing arbitrary group traffic. conversation without routing arbitrary group traffic. conversation without routing arbitrary group traffic.

## Input signal

- The outbound Feishu API returns an `open_message_id`.
- A later `im.message.receive_v1` event contains `parent_id` or `root_id`.
- The forwarded text contains a short opaque source-session marker such as `[DY:XXXXXXXXXX]`.
- The bridge has no durable message database and should not fetch arbitrary Feishu history.

## Method

1. Generate a per-route source-session token when forwarding a Douyin private event and keep its target conversation metadata in memory.
2. After a successful Feishu send, cache `message_id -> complete forwarded text` for the same lifetime as the source-session token.
3. For every Feishu text event, handle `/bind` first.
4. For other events, require the bound target chat and resolve `parent_id`, then `root_id`, against the local sent-message cache.
5. Emit a normalized platform event with the cached text in `metadata.quote_text`; the bridge extracts `[DY:...]`, removes the marker and forwards only the new reply text to Douyin.
6. Ignore ordinary messages, unknown message IDs, other chats, empty replies and expired cache entries.
7. Encode `conversation_short_id` as a decimal string across the Rust-to-Go JSON boundary, then parse it back to `int64` before the outbound IPC request.
8. Ignore Douyin events whose `user_id` equals `self_id`; the WebSocket also pushes messages sent by the logged-in account.
9. A `cmd=500` image push can contain `message_type=27` and a valid `server_message_id` while leaving `MessageBody.content` empty. In that case, call `POST /v1/message/get_by_id` with command/body tag 211 and the push's conversation fields plus `server_message_id`. Use the same Web SDK session auth as command 610 (`auth_type=1`, no web-protect fields), then replace only the normalized event content; preserve the push's routing and sender fields.
10. For Douyin `message_type=27`, keep `resource_url.large_url_list[0]` as an image component, with `origin_url_list[0]` and `url_list[0]` as compatibility fallbacks. Download only HTTPS URLs on the observed Douyin image CDN hosts, revalidate every redirect, reject unsupported image types, and cap the body at Feishu's 10 MB limit.
11. Preserve `resource_url.skey` across the Rust event and Go router boundary. If it is present, decode the 32-byte hex key and decrypt the downloaded body as AES-256-GCM: the first 12 bytes are the nonce and the remainder is ciphertext plus the 16-byte authentication tag, with no additional data. Validate image magic only after authenticated decryption. This matches the first-party PC IM `imageDecryptor` Worker; do not log the media key, ciphertext, full signed URL, or plaintext.
12. Upload the bytes through `POST /open-apis/im/v1/images` with `image_type=message`, then send `msg_type=image`. Cache both the source header message ID and image message ID against the same token-bearing text, so quoting either message resolves the original Douyin session.

## Operation chain

```text
Douyin private event
  -> if image content is empty: cmd=211 get_by_id
  -> [DY:token] + formatted text [+ image component]
  -> download encrypted media -> AES-256-GCM authenticated decrypt
  -> Feishu create-message API
  -> optional image upload -> image_key -> image message
  -> every emitted message_id cached (24h, bounded)
  -> Feishu parent_id/root_id event
  -> metadata.quote_text
  -> route session lookup
  -> Douyin private send
```

## Tool mapping

| Task                       | Evidence                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| Feishu event delivery      | `im.message.receive_v1` long connection logs                              |
| Message association        | `message_id`, `parent_id`, `root_id`                                      |
| Route association          | `[DY:XXXXXXXXXX]` and in-memory session map                               |
| Empty image push hydration | `cmd=500 MessageBody.content=""`, then `cmd=211 /v1/message/get_by_id`    |
| Douyin image source        | `message_type=27`, `resource_url.large_url_list[0]` with legacy fallbacks |
| Douyin image decryption    | `resource_url.skey`; nonce=`body[0:12]`, ciphertext+tag=`body[12:]`       |
| Feishu image delivery      | `im/v1/images` `image_key`, then `msg_type=image`                         |
| Runtime verification       | `/status` `reply_cache_size`, `bridge.forwarded`, `bridge.failed`         |
| Offline regression         | `go test ./internal/platform/feishu ./internal/bridge`                    |

## Verification criteria

- The Feishu message is sent successfully and has a non-empty `message_id`.
- A direct quote of that message produces one Feishu platform event.
- The event contains `metadata.quote_text` and `metadata.reply_to`.
- The router sends only the reply body to the original Douyin `chat_id`.
- A successful cycle changes bridge counters from `forwarded=1, failed=0` to `forwarded=2, failed=0`; the outbound Douyin echo does not create a third Feishu message.
- A normal group message or a quote from a previous process produces no outbound Douyin request.
- Cache expiry and the 8192-entry bound are observable in unit tests or status.
- A Douyin image produces a token-bearing Feishu header and a real image message; quoting the image message routes a text reply to the same Douyin conversation.
- If the image push content is empty, command 211 returns the complete `MessageBody.content`; hydration does not change the event's conversation, sender or server message ID.
- Image downloads send no account credentials, accept only the approved HTTPS CDN hosts and redirects, close response bodies, and reject oversized or non-image content.
- Encrypted image bodies authenticate successfully with AES-GCM before upload; a wrong key, truncated body, changed tag or non-image plaintext is rejected.

## Live verification

On 2026-07-30, a fresh Douyin image was forwarded as a real Feishu image after the bridge restarted. A Feishu quote reply to that image completed the outbound Douyin send to the original private conversation. The post-check status was `ready=true`, `bridge.forwarded=3`, `bridge.failed=0`, `bridge.duplicates=0`, and Feishu `reply_cache_size=3`; the extra source event and quote reply were both handled without a failed route. both handled without a failed route. both handled without a failed route. both handled without a failed route.

## Common mistakes

- Enabling a bidirectional route while `douyin.send_enabled` is false.
- Trying to resolve a quote by fetching arbitrary history, which adds a broader Feishu read permission and changes the trust boundary.
- Associating only the latest chunk of a split message; cache the complete text for every returned message ID.
- Accepting every group message and accidentally creating an unsolicited Douyin outbound channel.
- Serializing a 19-digit `conversation_short_id` as a JSON number. Go decodes numbers in `map[string]any` as `float64`, so values above `2^53` are rounded. The resulting `cmd=610` can fail with the misleading `request.MGet empty`.
- Reusing the protected `cmd=100` wrapper for `cmd=211/610`. Current PC IM uses `auth_type=1` and no web-protect fields for message or conversation lookup.
- Concatenating all CDP cookies without rejecting empty names. An unnamed cookie produces an invalid `=value` entry even when every named cookie is correct.
- Caching only the header message ID. Feishu replies may quote the image message itself, so every emitted message ID must point to the same token-bearing source text.
- Assuming the older `origin_url_list[0]` field is always present. The 2026-07-30 PC IM bundle reads `large_url_list[0]` by default; preserve ordered fallbacks and cover both payload shapes in regression tests.
- Treating empty `cmd=500` content as a malformed image. Use the push's `server_message_id` to fetch the complete body with command 211, and log only a redacted payload shape if hydration fails.
- Downloading arbitrary component URLs. Treat the message payload as untrusted input and enforce scheme, host, redirect, content-type, size, and timeout checks without forwarding Cookie or Authorization headers.
- Treating `application/octet-stream` as either an unsupported format or a trusted image. When `resource_url.skey` is present it is encrypted media: authenticate/decrypt first, then validate the plaintext image magic.
