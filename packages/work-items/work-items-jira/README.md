---
description: "Jira Work Items reads and explicitly approved REST writes."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-jira

English | [中文](README.zh.md)

## Summary

This provider supplies Jira issues to the [Work Items service](../work-items/README.md) through the Cloud REST API v3. Reads are available for one configured site and project; external writes are disabled until `allowWrites` is enabled and a consumer completes the service's separate preview and confirmation flow.

## Table of Contents

- [Use this package](#use-this-package)
- [Assignment and failures](#assignment-and-failures)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this function plugin with `credentials` and `workItems`. Set the site HTTPS origin in `origin` and the Jira project key in `project`. Missing site or project configuration leaves the provider unavailable. A service configuration of `provider: jira` selects this provider explicitly; request sources can select it when the service permits multiple providers.

| Configuration | Behavior |
|---|---|
| `origin` | Jira site HTTPS origin, such as `https://example.atlassian.net`. |
| `project` | Uppercase Jira project key, such as `ENG`. |
| `credentialRef` | Credential reference resolved for each request; defaults to `JIRA_CREDENTIAL`. The value must be `email:api-token` for `basic`, or a personal access token for `bearer`. |
| `authScheme` | `basic` (default) sends the credential over HTTP Basic for Jira Cloud; `bearer` sends it as a personal access token for Jira Data Center. |
| `jql` | Extra JQL clause appended to the built project/state query, such as `priority = High`; omitted adds no constraint. |
| `issueType` | Issue type name used when creating issues; defaults to `Task`. |
| `allowWrites` | Defaults to `false`; `true` enables the Provider writer. |
| `timeoutMs` | Per-request timeout from 1 through 120000 ms; defaults to 30000. |
| `maxItems` | Items per page from 1 through 100; defaults to 50. |

Credentials stay on the Host. HTTPS origin checks, refused redirects, bounded responses, caller cancellation, request timeouts, and Provider disposal apply to reads and writes. The provider registers `jira` for the plugin lifetime and removes the registration on release.

<a id="assignment-and-failures"></a>
## Assignment and failures

Create, comment, state, and assignment mutations use the existing Work Items approval ledger. State values are `open` and `closed`, mapped to the first workflow transition whose target status category is non-done or done respectively. Assignment accepts at most one display name or email: it is resolved through `/rest/api/3/user/search` and must match exactly one `atlassian` account. An empty assignment list clears the assignee directly without a lookup. Unknown, ambiguous, malformed, unauthorized, or unavailable lookups block the update. Issue descriptions and comments cross the boundary as bounded Atlassian Document Format; reads flatten it to plain text and writes rebuild paragraphs.

<a id="model-experience"></a>
## Model Experience

This package contributes no prompt or model tool. `@deepseek-ai/dsh-tool-work-items` exposes normalized reads and the durable write-approval protocol; `jira:PROJECT-123` ids route to this provider.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Provider writes remain disabled unless deployment configuration enables `allowWrites`; every model-facing write still requires a durable preview and exact confirmation.
- JQL combines `project = <configured key>`, the state category filter, and the configured `jql` clause; model requests cannot pass arbitrary JQL, and sprint/board views are not supported. Comment history is bounded to the newest 20 entries per item; attachments surface as metadata only — the newest 20 per issue with name, link, size, and MIME type, and binaries are never fetched. Sprint assignment is not normalized because the sprint field id is instance-specific.
- Assignment supports a single account because Jira issues carry one assignee.
- State writes depend on the project workflow exposing a reachable transition for the requested category.

<a id="dev-note"></a>
## Dev Note

Provider response data and credentials remain Host-owned; generated catalogs are the source of API inventory.
