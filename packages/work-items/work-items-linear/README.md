---
description: "Work Items package reference."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-linear

English | [中文](README.zh.md)

## Summary

This package implements one provider-neutral Work Items layer; the sections below define its runtime contract.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

This Provider reads Linear issues through the fixed https://api.linear.app/graphql endpoint. It resolves a CredentialRef for each request, rejects redirects, bounds GraphQL response bytes and page size, and maps validated issue nodes into the common Work Item contract. Requests carry only configured team/project identifiers and bounded filters.

## Configuration

| Key | Meaning |
|---|---|
| team / project | Structured Linear scope identifiers; at least one is required for availability. |
| credentialRef | Per-operation credential reference; the secret never crosses the Provider. |
| timeoutMs / maxItems | Request timeout and maximum page size. |

The Provider does not accept an endpoint, query URL, arbitrary headers, or caller-supplied GraphQL text. It classifies HTTP and GraphQL authentication, authorization, not-found, rate-limit, response, and cancellation failures without returning response bodies. Unloading the Provider aborts in-flight fetch and response-read work before removing its registration; if credential resolution is pending, its result is discarded before any network request starts.

## Explicit writes

allowWrites defaults to false. When enabled, the public service's preview/confirm API drives external mutations. Creation requires a configured team. State accepts a workflow state ID from the same team; assignment accepts one user UUID or an empty list to unassign. Each mutation rechecks the issue against the configured team/project scope. Each execution sends at most one mutation request and never retries it. HTTP 400/422 and definite input rejections are classified separately; network or malformed-response failures become potentially executed unknown outcomes in the public service. See the [Work Items service](../work-items/README.md) for approval and recovery semantics.

## Model Experience

Indirectly, through the tool-work-items Consumer, which renders normalized records and write receipts.

#### KV Cache effect

None; credential resolution and Linear requests do not change the model request prefix.

## Known Limitations and Deferred Work

- Bulk mutation, deletion, discovery, and arbitrary saved views are not provided; supported mutations use the service-owned preview/confirm approval API.
- Team and project filters use configured provider identifiers; discovery and arbitrary saved views are not supported.


<a id="dev-note"></a>
### Dev Note

This package keeps provider credentials and response normalization in its owning layer.

No runtime invariant companion is published because each request validates external data and the provider persists no response cache.
