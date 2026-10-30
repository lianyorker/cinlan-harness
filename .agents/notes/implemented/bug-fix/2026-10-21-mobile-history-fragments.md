# Agent Note: Bound complete mobile messages independently of encrypted frames

Status: implemented

English | [中文](2026-10-21-mobile-history-fragments.zh.md)

## Problem

A real Session history snapshot exceeds the encrypted channel's 512 KiB plaintext-frame limit. Rejecting that snapshot closes the connection before the phone can render history, even though the desktop can read the same Session. Reducing message content would discard the canonical controller records.

## Decision

The [encrypted channel](../../../../apps/mobile-relay/src/crypto.ts) retains per-frame authentication, sequence checks and the 512 KiB plaintext limit. Complete JSON messages have a separate 16 MiB limit; messages above 256 KiB use ordered fragments. A receiver retains one bounded assembly and publishes only the complete JSON message. The [Host](../../../../packages/bundle/cinlan-remote-tunnel/src/host.ts) serializes complete outgoing messages, awaits socket send callbacks and limits the pending message count.

## Alternatives considered

**Raise the frame limit alone.** This would increase the maximum individual encryption and socket frame allocation without separating complete history size from transport pressure. Fragmentation retains the existing frame limit.

**Truncate history records.** This would hide controller output and break the phone's history projection. The transport preserves the complete controller message within its explicit limit.

## Consequences

Host and phone assets require coordinated deployment for fragmented messages; the [upgrade guide](../../../../docs/upgrade-guide/v0.2.1-alpha.1/mobile-history-fragments/guide.md) documents this requirement. Saved credentials and Session logs are unchanged. Histories above 16 MiB still fail rather than truncating; pagination remains separate work.

## Verification

The channel tests exercise multibyte messages, atomic reassembly, malformed sizes, ordering, replay, interleaving and complete-message limits. The Host socket test exercises a large snapshot followed by another request. Browser verification against a real Host confirms history rendering, reconnection, refresh and Session switching; real model streaming, a second real Host and phone hardware remain unverified.
