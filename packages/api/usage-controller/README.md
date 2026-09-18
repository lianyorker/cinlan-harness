---
description: "Query recorded token usage by time, provider, and model through the authenticated browser API, with explicit unknown usage and partial results."
kind: "package-reference"
---
# Usage Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-usage-controller` lets authenticated browser clients read token usage over a selected time interval. Reports include exact known subtotals, provider/model groups, and explicit unknown or incomplete accounting. Queries include stored Sessions without activating an Agent or changing conversation logs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package in a Host composition with `typert` and `usageQuery`. Browser calls also require the [Gateway](../gateway/README.md) and authenticated [Connection](../../client/connection/README.md) carrier; the [usage query service](../../session-query/usage-query/README.md) owns storage access and query limits.

### Minimal configuration

Add this row to the composition that provides those services:

```yaml
- name: '@deepseek-ai/dsh-api-usage-controller'
```

| Field | Default | Meaning |
|---|---|---|
| None | — | This controller has no configuration fields; query bounds belong to the usage query service. |

Call `ctx.remote.usage.query(request, signal)` with inclusive `from` and exclusive `to` Unix millisecond timestamps. Optional `provider` and `model` fields select exact route identities. On a successful `RemoteResult` envelope, its [UsageQueryResult](src/types.ts) value preserves the query service's totals, route groups, and coverage information; an unknown token count remains unknown, and a partial report remains a known subtotal.

### Authentication and failures

Connection rejects unauthenticated HTTP requests before the controller or usage storage runs. A valid browser cookie comes from Connection's launch-token exchange. Cancellation propagates from the caller through the query service to persistence reads.

| Remote error code | Recovery |
|---|---|
| `usage/invalid-query` | Choose a valid interval and route filter. |
| `usage/query-timeout` | Choose a shorter interval. |
| `usage/query-failed` | Refresh and try again. |

Error responses contain fixed public messages and empty details. They exclude underlying exceptions, file paths, conversation text, and credential values.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host service registers as `usageController` and exposes the `usage` Remote namespace. Its decorated `query` method passes the request and cancellation signal to `usageQuery` and returns the same result. Loader removal withdraws the service's callable endpoint; removing its query dependency also deactivates the controller.

[Controller source](src/index.ts) owns error translation; [browser-safe type exports](src/types.ts) refer to the query service's type-only entry. The [API tests](tests/api.host.spec.ts) exercise durable current-format logs through Loader, real JSONL and SQLite providers, and authenticated HTTP dispatch. No runtime invariant companion is published because the controller owns no independent accounting or authorization state that could diverge from those services.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Usage query service](../../session-query/usage-query/README.md) — accounting semantics and deployment bounds.
- [Connection](../../client/connection/README.md) — browser authentication and RPC transport.
- [Typert Gateway](../gateway/README.md) — Remote dispatch and generated bindings.

-----

<a id="model-experience"></a>
## Model Experience

None, as usage reporting reads accounting without registering a prompt, tool, or Session event.

#### KV Cache effect

No effect; usage queries leave model requests and conversation logs unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The controller preserves the underlying query's coverage limits.

- Missing provider accounting and bounded or unreadable sources can produce partial results; consumers must display those indicators instead of presenting a subtotal as complete usage.
- Direct Host service calls do not authenticate a browser; browser consumers use the Connection-owned API carrier.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
