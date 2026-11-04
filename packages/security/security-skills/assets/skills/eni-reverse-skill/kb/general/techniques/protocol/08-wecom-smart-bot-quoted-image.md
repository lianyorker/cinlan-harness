---
id: "general/protocol/08-wecom-smart-bot-quoted-image"
title: "WeCom Smart Bot quoted-reply and image bridge"
title_en: "WeCom Smart Bot quoted-reply and image bridge"
summary: >
  Use the WeCom Smart Bot API callback quote payload to route an operator reply
  to the original Douyin private conversation without accepting unquoted group
  traffic. Keep the opaque route token in the quoted source text and treat
  media handling as offline-verified until a real group callback succeeds.
summary_en: >
  Use the WeCom Smart Bot API callback quote payload to route an operator reply
  to the original Douyin private conversation without accepting unquoted group
  traffic.
board: "general"
category: "protocol"
signals:
  - "WeCom Smart Bot"
  - "WeCom aibot callback"
  - "WeCom quote reply"
  - "EncodingAESKey"
  - "WECOM_AIBOT_TOKEN"
  - "WECOM_WEBHOOK_URL"
  - "aeskkey"
  - "WeCom webhook image"
keywords:
  - "quote_text"
  - "[DY:XXXXXXXXXX]"
  - "AES-CBC"
  - "PKCS#7"
  - "SHA-1 signature"
  - "group Webhook"
  - "message dedupe"
difficulty: "intermediate"
tags:
  - "protocol-analysis"
  - "webhook"
  - "message-routing"
  - "media-handling"
language: "en"
last_updated: "2026-07-31"
related_articles:
  - "general/protocol/04-encrypted-webhook-contract-first"
  - "general/protocol/06-douyin-feishu-quoted-reply"
  - "general/protocol/07-douyin-web-outbound-image"
---
# WeCom Smart Bot quoted-reply and image bridge

## Scenario

A bridge forwards Douyin private messages into one internal WeCom group. The
operator must reply to the correct Douyin conversation by using WeCom's native
quote UI, rather than copying a routing token or relying on the most recent
conversation.

## Input Signal

- A WeCom Smart Bot is in API URL callback mode.
- Group replies arrive as encrypted JSON with `msg_signature`, `timestamp`,
  `nonce`, and an outer `encrypt` value.
- The decrypted payload has a top-level `msgtype` and optional `quote` object.
- The bridge's source text contains an opaque marker such as `[DY:XXXXXXXXXX]`.
- An image or `mixed` callback contains a temporary WeCom media URL and may
  carry `aeskey` or `aeskkey` material.

## Method

1. Keep the group message-push Webhook and Smart Bot callback distinct. The
   former sends source messages; the latter receives group replies. Both must
   be attached to the same internal group.
2. For group traffic, require the operator to quote a bridge-emitted source
   text, `@` the Smart Bot, and provide a reply. The documented `quote` object
   contains quoted content but no stable parent message ID.
3. Preserve `[DY:...]` in the source text. Decode quoted text or mixed content
   into `metadata.quote_text`, extract the marker, then route only to the
   in-memory session mapped by that marker. Never fall back to the latest
   Douyin contact.
4. Verify the callback SHA-1 signature before decrypting. Decrypt the
   `random(16) || uint32_be(length) || JSON || receive_id` frame with
   AES-256-CBC, validate PKCS#7 padding and require an empty receive ID for the
   Smart Bot contract used here.
5. Reserve the incoming callback `msgid` before media work. Release that exact
   reserved ID if image download/decryption fails so WeCom can retry; retain it
   after the event is accepted to suppress duplicate delivery.
6. For source images, download only the allowlisted Douyin HTTPS image hosts,
   follow only allowlisted redirects, AES-GCM decrypt when `skey` is present,
   validate JPEG/PNG and require the group Webhook's 2 MiB image limit. Send
   the Webhook `image` payload as base64 plus lowercase MD5.
7. For Smart Bot inbound images, download only allowlisted WeCom HTTPS media
   hosts, cap the body, decrypt AES-CBC only when a media key is supplied,
   validate JPEG/PNG, and store it in a mode-0600 temporary file. Router owns
   cleanup on success, failed routing, duplicate events, and cancellation.

## Operation Chain

```text
Douyin private event
  -> [DY:token] source text + optional JPEG/PNG
  -> WeCom group message-push Webhook
  -> operator quotes source text + @Smart Bot + reply
  -> encrypted Smart Bot callback
  -> signature verification + CBC frame decryption
  -> quote content -> metadata.quote_text -> [DY:token]
  -> Router session lookup
  -> original Douyin private conversation

Smart Bot image reply
  -> allowlisted HTTPS media download
  -> optional AES-CBC decrypt -> JPEG/PNG validation
  -> private temporary file -> Router -> Douyin image send -> cleanup
```

## Tool Mapping

| Task | Evidence or tool |
| --- | --- |
| Official callback contract | WeCom Smart Bot receiving-message documentation: `document/path/100719` |
| Callback signature/frame | `internal/platform/wecom/callback.go` and `callback_test.go` |
| Group image payload | `internal/platform/wecom/adapter.go` and `adapter_test.go` |
| Reply routing | `internal/bridge/router.go` and `router_test.go` |
| Full offline verification | `go test -count=1 ./...`, `go vet ./...` |

## Verification Criteria

- A quoted text callback produces `metadata.quote_text` containing the original
  token, and the Router sends only the new reply content to the mapped Douyin
  private conversation.
- A callback with no quote token, an expired token, a route mismatch, or a
  normal unquoted group message produces no Douyin outbound send.
- The same callback `msgid` is suppressed after acceptance, while a failed
  image download using that `msgid` can be retried successfully.
- Outbound Webhook images have verified JPEG/PNG bytes, base64 body, lowercase
  MD5, and are no larger than 2 MiB.
- Inbound media files are validated before routing and removed after every
  Router terminal path.
- HTTP 200 and offline tests are not recipient-delivery proof. Validate one
  source image and one quoted image reply in the real configured group before
  marking this chain production-ready.

## Constraints and Common Mistakes

- Do not use the self-built application XML callback as a replacement for
  Smart Bot quote routing; its documented message shape has no quote or parent
  association field.
- Do not remove `[DY:...]` from the source text. Smart Bot `quote` has content,
  not a parent message ID.
- Do not log the Webhook URL, Token, EncodingAESKey, encrypted callback body,
  media key, signed media URL, or plaintext image.
- Do not regard page or schema observations of `aeskey`/`aeskkey` as completed
  production verification. Keep the actual callback payload redacted and test
  it in the real group.
- Do not expose the local status server publicly. Publish only the callback
  path through a reverse proxy or Cloudflare Tunnel.
