---
description: "Read-only Gitee Issues provider for configured repositories."
kind: "package-reference"
---

# @cinlan/work-items-gitee

English | [中文](README.zh.md)

## Summary

This provider supplies issues from one configured Gitee repository through REST API v5. It supports bounded list and get requests only; this package does not expose external writes.

## Use this package

Mount the provider with `credentials` and `workItems`. Set `owner` and `repository` to the Gitee repository path. Missing repository settings leave the provider unavailable. Set `provider: gitee` on the Work Items service to select it explicitly, or provide `source: gitee` when multiple providers are mounted.

| Configuration | Behavior |
|---|---|
| `owner` | Repository owner; required for availability. |
| `repository` | Repository name; required for availability. |
| `credentialRef` | Credential reference resolved for every request; defaults to `GITEE_TOKEN`. |
| `timeoutMs` | Per-request timeout from 1 through 120000 ms; defaults to 30000. |
| `maxItems` | Maximum page size from 1 through 100; defaults to 50. |

The provider uses the fixed `https://gitee.com` API origin, sends the token in the `Authorization` header, rejects redirects, bounds response bodies to 2 MB, and validates issue URLs against the configured repository and issue number. Caller cancellation, request timeout, and plugin disposal abort in-flight reads.

## Model Experience

The Work Items tool can list and read Gitee issues using the normalized Work Items fields. Query filtering applies to the fetched page's title and body. The provider does not expose boards, comments, or writes.

#### KV Cache effect

This provider registers no model-request prefix and does not replace existing request tokens.

## Known Limitations and Deferred Work

- One provider instance serves one configured repository.
- Listing and query filtering operate on one bounded API page at a time; cursors are decimal page numbers.
- Gitee integration preflight and repository discovery are not part of this provider.

## Dev Note

The provider owns Gitee response validation and fixed-origin REST requests. The Work Items service owns provider selection and normalized reads; no mutation writer is registered.
