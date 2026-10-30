---
kind: upgrade-guide
description: Mobile history messages above 256 KiB require matching Host and phone assets.
---

# Deploy Host and mobile assets together

English | [中文](guide.zh.md)

## Change

The encrypted mobile transport sends JSON messages above 256 KiB as authenticated fragments, with a 16 MiB complete-message limit. Older phone assets do not reassemble these messages. Saved device credentials and Session logs are unchanged.

## Migration

1. Deploy the matching Host package and rebuilt mobile assets together.
2. Reload the phone page after restarting the Host through its supported `dsh` profile.
3. Open a previously affected conversation and confirm that its history appears and the connection remains paired. Re-pairing is not required.
