---
description: "Persistent engagement ledger (ctx.engagementLedger, campaign_* tools) with assessment-grant scope enforcement"
kind: "package-reference"
---
# @cinlan/engagement-ledger

English | [中文](README.zh.md)

## Summary

This package mounts `ctx.engagementLedger` plus the `campaign_*` tool set: persistent campaign bookkeeping for authorized security engagements — assets, fingerprints, steps, PoC attempts, and stage progression through `recon → fingerprint → match → verify → exploit → lateral → report`. The ledger lives at `<clh home>/security/engagement-ledger/campaigns.json` (temp-file + rename writes) and is purely passive: no follow-up turns, no agent spawning, no network effects.

## Using this package

Mount it in a composition that also provides `tools`, `assessmentScope`, and `vulnPlaybook`. `campaign_create` snapshots the *current* root grant's targets into the campaign and refuses empty scopes; every `campaign_upsert` asset write re-checks the host against the **live** `ctx.assessmentScope` root grant (exact, `*.` suffix, `url-prefix` hostname, and IPv4 CIDR matching, honoring `excludedTargetIds`). Changing the profile's grant therefore changes what the ledger accepts — the recorded scope snapshot is provenance, not a bypass.

`campaign_next` returns stage instructions, pending assets, and playbook candidates per fingerprint (via `ctx.vulnPlaybook`), plus a stall hint after two zero-progress rounds — each call counts as one round.

## Origin

Ported from a reviewed third-party plugin's campaign store (`dsh-prompt-custom`). Removed in the port: autopilot follow-up engine (`agent.followup`), the plugin-local scope field, and the HTTP/UI surface. Added: enforcement against the native assessment grant instead of a duplicate scope, flattened attempt parameters, and `campaign_create` gating on a non-empty grant.

## Model Experience

Indirectly, through the `campaign_*` tools the model calls; the ledger never injects text into the model context on its own.

#### KV Cache effect

No direct effect; campaign state enters model context only through `campaign_*` tool results the model requests.

## Known Limitations and Deferred Work

- The ledger records but does not authorize effects — real actions still flow through `assessment-scope-tool-policy` on tool calls.
- `rounds`/`lastProgress` drive only a hint; no autonomous loop consumes them.
