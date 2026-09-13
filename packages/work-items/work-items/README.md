---
description: "Work Items package reference."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items

English | [中文](README.zh.md)

## Summary

This package implements the provider-neutral Work Items Service Definition; the sections below define its runtime contract.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

WorkItemsRuntime is the Service Definition for normalized external Work Items and durable approved writes. It registers GitHub and Linear providers, selects an explicit source or exactly one usable provider, and forwards bounded reads while owning the prepare/confirm/cancel write ledger. It does not perform HTTP or resolve credentials; storageDomain owns durable bytes.

## Service API

| Member | Behavior |
|---|---|
| registerProvider(provider) | Registers one github or linear provider for the calling plugin lifetime and returns a disposer. |
| list(request, signal?) | Selects the request source and returns a bounded normalized page. |
| get(request, signal?) | Selects the provider from the configured source or opaque id prefix and returns one item. |

A detail response must retain the exact requested item id; a mismatched provider response fails with invalid-response.

Provider selection fails explicitly for missing, unavailable, or ambiguous providers. Every returned item and page is rebuilt after runtime validation of its source, branded id, HTTPS URL, text, timestamps, collections, cursor, and 100-item maximum, so Provider-only fields cannot pass through. Provider errors retain safe categories such as authentication-required, forbidden, not-found, rate-limited, invalid-response, and aborted.

## External writes and durability

Providers are read-only by default; allowWrites explicitly enables create, comment, state, and assignment. prepareWrite validates and persists an immutable preview without mutation. confirmWrite accepts only its operationId, rechecks scope and target content revision, and never replaces approved fields. writeApprovalTtlMs controls preview expiry and defaults to 300000 ms. cancelWrite cancels only unexecuted previews.

Writes require storageDomain. The separate work_item_writes v1 domain stores operations and receipts. A running record is committed before the network effect. Concurrent or repeated confirmations in one Host dispatch once and reuse the receipt. After a sequential restart, a retained running record becomes unknown and is never resent. An external success followed by a local receipt-write failure is not permission to resend. Verify unknown outcomes at the provider; a definite rejection requires a new preview instead of automatic retry. History returns the newest 1–100 rows for the selected source, with the UI requesting 20; records are not automatically deleted.

Statuses are prepared, running, succeeded, failed, unknown, canceled, and expired. Revision preflight is not an external atomic compare-and-swap; another client may still change the issue after the check. Do not run multiple writing Hosts against one database concurrently.

## Model Experience

Indirectly, through the tool-work-items Consumer, which renders normalized records and write receipts.

#### KV Cache effect

None; provider registration and read operations do not change the model request prefix.

## Known Limitations and Deferred Work

- External deletion, automatic mutation retries, and multiple Hosts concurrently sharing the write database are unsupported.
- Workspace links are optional projections supplied by a Host Consumer; the service does not resolve checkout state or expose provider transport to model-facing Consumers.


<a id="dev-note"></a>
### Dev Note

This package keeps provider credentials and response normalization in its owning layer.

No runtime invariant companion is published because provider responses are validated and rebuilt before public reads return, and Cordis effects own registration disposal; the service retains no second authority.
