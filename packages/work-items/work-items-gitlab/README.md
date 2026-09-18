---
description: "GitLab Work Items reads and explicitly approved REST writes."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-gitlab

English | [中文](README.zh.md)

## Summary

This provider supplies GitLab issues to the [Work Items service](../work-items/README.md) through REST API v4. Reads are available for one configured project; external writes are disabled until `allowWrites` is enabled and a consumer completes the service’s separate preview and confirmation flow.

## Table of Contents

- [Use this package](#use-this-package)
- [Assignment and failures](#assignment-and-failures)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this function plugin with `credentials` and `workItems`. Set the GitLab namespace in `owner` and project name in `repository`. Missing project configuration leaves the provider unavailable. A service configuration of `provider: gitlab` selects this provider explicitly; request sources can select it when the service permits multiple providers.

| Configuration | Behavior |
|---|---|
| `origin` | HTTPS origin; defaults to `https://gitlab.com`. |
| `credentialRef` | Credential reference resolved for each request; defaults to `GITLAB_TOKEN`. |
| `allowWrites` | Defaults to `false`; enables the provider writer when `true`. |
| `timeoutMs` | Per-request timeout, 1–120000 ms; defaults to 30000. |
| `maxItems` | Page bound, 1–100 issues; defaults to 50. |

Credentials remain in the Host. HTTPS origin checks, rejected redirects, bounded responses, caller cancellation, request timeout, and provider disposal apply to reads and writes. The provider registers `gitlab` for its plugin lifetime and removes that registration on disposal.

<a id="assignment-and-failures"></a>
## Assignment and failures

Create, comment, state, and assignment mutations use the existing Work Items approval ledger. State values are `opened` and `closed`. Assignments accept usernames: every username is looked up through `/api/v4/users?username=…` and must resolve to exactly one matching user with a positive safe-integer id. Matching is case-insensitive. The provider resolves every assignee before sending an issue update and revalidates at execution. Unknown, ambiguous, malformed, unauthorized, or unavailable lookup results prevent that update. An empty assignee list clears assignments without username lookup.

Preview does not mutate the issue. The service stores approvals and terminal receipts in `work_item_writes`; repeating confirmation or reloading a successful receipt does not resend an external mutation. If the service reports an unknown outcome after dispatch, verify it in GitLab before preparing another operation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Work Items service and its tool consumer, which owns rendering of normalized issues and write receipts.

#### KV Cache effect

This provider registers no model-request prefix and does not replace existing request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One provider instance serves one configured project. Assignment requires access to GitLab user lookup as well as issue-write permission.
- External deletion and automatic retry of uncertain writes are not provided. Approval revision checks are not an atomic compare-and-swap at GitLab.
- API requests are rooted at the configured origin; a GitLab deployment under an HTTP path prefix is unsupported.

<a id="dev-note"></a>
### Dev Note

The provider owns REST response validation and username-to-id resolution. The Work Items service owns immutable approval payloads, source selection, and durable receipts. No runtime invariant companion is published because this adapter maintains no independent durable projection; provider state is observed through requests and the service-owned ledger.
