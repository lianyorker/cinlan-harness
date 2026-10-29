---
description: "Work Items package reference."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-github

English | [中文](README.zh.md)

## Summary

This package implements one provider-neutral Work Items layer; the sections below define its runtime contract.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

This Provider reads GitHub Issues from one configured repository through the fixed https://api.github.com origin. It resolves a CredentialRef per operation, sends the credential only in an Authorization header, rejects redirects, bounds response bytes and page size, and maps issues into the provider-neutral Work Item contract. Pull requests are excluded.

## Configuration

| Key | Meaning |
|---|---|
| owner / repository | Structured GitHub repository identifiers. |
| credentialRef | Credential reference resolved for each operation; the value is never returned. |
| timeoutMs / maxItems | Request timeout and maximum page size. |

The Provider accepts no endpoint or arbitrary request headers. Its cheap available check does not contact GitHub or read credentials. Authentication, access, not-found, rate-limit, response, and cancellation failures use safe WorkItemsError categories. Unloading the Provider aborts in-flight fetch and response-read work before removing its registration; if credential resolution is pending, its result is discarded before any network request starts.

## Explicit writes

allowWrites defaults to false. When enabled, the public service's preview/confirm API drives external mutations. Creation and comments use POST; state and assignment use PATCH. State accepts open/closed and assignees use GitHub logins. Each execution sends at most one mutation request and never retries it. HTTP 400/422 and definite input rejections are classified separately; network or malformed-response failures become potentially executed unknown outcomes in the public service. See the [Work Items service](../work-items/README.md) for approval and recovery semantics.

## Model Experience

Indirectly, through the tool-work-items Consumer, which renders normalized records and write receipts.

#### KV Cache effect

None; credential resolution and GitHub requests do not change the model request prefix.

## Known Limitations and Deferred Work

- Pull-request workflows and external issue deletion are not provided.
- Enterprise GitHub origins and repository discovery are not accepted by this Provider.
- Comment history is fetched on single-item `get` only when the issue reports comments, bounded to the newest 20; `list` stays a single request.
- Attachments embedded in issue body markdown are not surfaced as structured metadata.
- The issue milestone surfaces as normalized iteration metadata — title, state, and due date.
- GitHub issues carry no native priority field; priority is not inferred from labels.
- GitHub issues carry no due-date field; milestone due dates surface under `iteration` instead.
- GitHub issues carry no estimate field and no tracked-time field.
- The issue `parent` surfaces as `parentId` when it points at an issue in the configured repository; cross-repository parents are omitted. Sub-issues are children rather than typed relations, so no `links` surface is exposed yet.
- `boards` reads the owner's Projects v2 boards over GraphQL with the same credential: the Status single-select field becomes the columns, each column lists bounded `github:` issue ids. Projects without a single-select field surface no board; draft issues and pull requests are skipped.


<a id="dev-note"></a>
### Dev Note

This package keeps provider credentials and response normalization in its owning layer.

No runtime invariant companion is published because each request validates external data and the provider persists no response cache.
