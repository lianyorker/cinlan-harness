---
id: 'general/protocol/07-douyin-web-outbound-image'
title: 'Douyin Web private-message outbound image'
title_en: 'Douyin Web private-message outbound image'
summary: >
  Reconstruct a Douyin Web private-message image send from a redacted browser
  observation: upload configuration, VOD apply/upload/commit, then IM cmd 100.
summary_en: >
  Reconstruct a Douyin Web private-message image send through upload config,
  VOD apply/upload/commit, and an IM cmd 100 message.
board: 'general'
category: 'protocol'
signals:
  - 'Douyin outbound image'
  - 'ApplyUploadInner'
  - 'CommitUploadInner'
  - 'message_type 27'
  - 'Content-CRC32'
  - 'resource_url'
  - 'cipher_v2'
mcp_tools:
  - 'kb_router'
keywords:
  - 'Douyin Web'
  - 'VOD AWS4'
  - 'TOS upload'
  - 'message_type=27'
  - 'resource_url.skey'
difficulty: 'advanced'
tags:
  - 'protocol-analysis'
  - 'web-im'
  - 'media-upload'
language: 'en'
last_updated: '2026-07-31'
related_articles:
  - 'general/protocol/03-websocket-protobuf-source-first'
  - 'general/protocol/06-douyin-feishu-quoted-reply'
---

# Douyin Web private-message outbound image

## Scenario

An internal bridge needs to send a JPEG or PNG received from an authorized chat platform into a Douyin Web private conversation. Text send is already available through IM Protobuf `cmd=100`, but a media message requires a short-lived upload credential and an encrypted VOD upload chain first.

## Input signal
- Browser source contains `ApplyUploadInner`, `CommitUploadInner`, or `cipher_v2`.

- A normal image message has `message_type=27` and `aweType=2702`.
- The upload endpoint expects `Content-CRC32` and `X-Storage-U`.
- The final content has `resource_url.oid`, `resource_url.skey`, image size, dimensions, and MD5.

## Method

1. Capture two harmless image sends from the logged-in Web client. Record only paths, request field names/types, response field names/types, status, and
2. Fetch `public_image_config` from `/aweme/v1/web/im/upload/config/v2` and keep its STS values in memory.
3. Create a VOD AWS4 `ApplyUploadInner` request with `FileType=image`, `IsInner=1`, and `NeedFallback=true`. Parse the first upload node, store
4. Upload the exact image bytes to `/upload/v1/<StoreUri>`. Send the server authorization, URL-encoded session key, and lowercase eight-character IEEE
5. Send `CommitUploadInner` with `Encryption` configured as `cipher_v2` and `policy-set=check,thumb,medium,large`. Parse the returned encryption URI,
6. Acquire the target conversation ticket, then send IM Protobuf `cmd=100`, `message_type=27`, with a JSON image payload built from the commit result.
7. Copy inbound platform media into a private runtime directory before IPC; reject symlinks, paths outside that directory, non-JPEG/PNG files, and

## Operation chain

```text
platform MediaId
  -> validated local JPEG/PNG temporary file
  -> selected [DY:XXXXXXXXXX] private conversation
  -> private runtime-media copy
  -> Web upload config (in-memory STS)
  -> VOD ApplyUploadInner (AWS4)
  -> TOS binary upload (CRC32 + session key)
  -> VOD CommitUploadInner (cipher_v2)
  -> IM cmd=100, message_type=27
```

## Tool mapping

| Task                         | Tool / evidence                                                      |
| ---------------------------- | -------------------------------------------------------------------- |
| Browser protocol observation | Chrome CDP Network plus redacted source bundles                      |
| Static confirmation          | `rg` against PC IM bundles for VOD action and image JSON field names |
| Upload signing               | Deterministic Rust AWS4 unit fixture                                 |
| IPC containment              | Go and Rust filesystem boundary tests                                |
| Bridge routing               | `[DY:...]` session-selection tests and callback cleanup tests        |

## Verification criteria

- Image upload config, apply, binary upload, commit, and final send each return a success status in an authorized browser observation.
- The final Protobuf has `cmd=100`, `message_type=27`, and the expected image content fields without emitting any secret to logs.
- A valid temporary image is removed after success, missing/expired session token, duplicate callback, unavailable target, and send failure.
- The runtime refuses relative paths, symlinks, paths outside its private media directory, unsupported image formats, and files over 10 MiB.
- An actual deployed callback test confirms that the destination conversation receives the image; an HTTP 200 alone is not recipient-delivery proof.

Run the offline regression suite from the workspace root:

```powershell
go test -count=1 ./cinlan-douyin-bot/internal/bridge ./cinlan-douyin-bot/internal/platform/wecomapp ./cinlan-douyin-bot/internal/platform/douyin
cargo test --locked --manifest-path .\cinlan-douyin-bot\runtime\douyin\Cargo.toml
```

## Common mistakes

- Treating a browser upload credential as a persistent configuration value.
- Logging `Authorization`, STS tokens, upload host query strings, image secret keys, or source media URLs.
- Using decimal CRC32 or uppercase hex instead of lowercase padded hex.
- Sending `message_type=7` with image JSON instead of `message_type=27`.
- Accepting a temporary local path without a cleanup owner on every router early-return path.
- Equating a successful API response with recipient-side image delivery.
