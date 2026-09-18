---
description: "Exact known-Turn usage totals over live and durable Sessions for Host reporting consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-query

English | [中文](README.zh.md)

## Summary

This Host service reports recorded usage across live and cold Sessions without starting Agents. It reuses token-meter's completed-Turn accounting, includes retries, excludes fork-inherited events, and separates exact known totals from missing accounting. Use it for local usage reports whose source is Harness Session history.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside a concrete [Session Query provider](../session-query-sqlite/README.md). Call `ctx.usageQuery.query(request, signal)` from trusted Host code. Browser clients use the authenticated [Usage controller](../../api/usage-controller/README.md).

| Config | Default | Meaning |
|---|---|---|
| `maxSessions` | 200 | Maximum Session observations per query |
| `maxEvents` | 200,000 | Maximum source events admitted to aggregation, including inherited prefixes |
| `timeoutMs` | 15,000 | Cooperative deadline covering listing, cold reads, and aggregation |
| `maxRangeDays` | 366 | Maximum interval length |

All bounds are positive integers. A query accepts inclusive `from` and exclusive `to` Unix millisecond timestamps, plus optional exact `provider` and `model` filters. Interval membership uses Turn start, so a Turn crossing midnight belongs to its start date. A fork beginning mid-Turn exposes its own tail as unknown, using its first own lifecycle event for interval membership.

A complete empty report has zero Turns and no token total. A Turn with provider-reported zero usage has a real zero token total. A Turn without complete accounting increases `unknownTurns`; its tokens never become zero. When known and unknown Turns coexist, token values are the exact subtotal of the known Turns. Reasoning tokens are an output subset and are never added twice. Optional cache and reasoning buckets remain absent unless every known Turn reports them.

Provider/model groups are emitted only at the attribution granularity proven by the canonical fold. A Turn spanning several models may retain a single provider but has no single model. Failed retry attempts often have no model attribution; their tokens still contribute to the unfiltered known subtotal. Exact filters exclude unattributable Turns and mark the response partial rather than assigning them to a guessed route. Provider/model lists describe the unfiltered interval.

Queries return coverage counts and stable partial reasons when a source fails or a configured observation/event bound prevents inclusion. Caller cancellation, service disposal, deadline expiry, invalid intervals, and unsafe aggregate integers reject the operation. Dispose the caller's request controller when its result is no longer needed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The service reads live-preferred observations through `sessionQuery`, disables projection computation, and disposes every observation lease. It processes only each observation's own event suffix, partitions it into Turns, and calls the public `deriveTurnTokenUsage` function from token-meter. Recorded step starts and retry starts provide attempt counts; repeated usage samples do not create extra attempts.

Each request owns one deadline and carries caller/lifetime cancellation through the underlying reads. Unloading aborts all in-flight queries and awaits their settlement. The service stores no usage ledger or reporting cache and does not append Session events. No invariant companion is published because each report derives its usage from Session observations through token-meter's canonical Turn accounting, with no independently maintained usage state to reconcile.

<a id="dev-note"></a>
### Dev Note

Durable-fixture tests cover restart, retries, inherited history, live cuts, unknown/zero distinctions, exact filters, source limits, cancellation, and awaited teardown. The controller package supplies the Loader/HTTP authentication composition. Public browser report types live in `./types` so type-only consumers do not import the Host service entry.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session Query](../session-query/README.md) owns live/cold observations and prepared-log caching.
- [Token meter](../../llm/token-meter/README.md) owns complete-Turn accounting and optional provider buckets.
- [Usage controller](../../api/usage-controller/README.md) owns browser transport and sanitized query failures.
- [Usage settings](../../client/ui-settings-usage/README.md) owns filters, rendering, and CSV download.

-----

<a id="model-experience"></a>
## Model Experience

None, as the service reads recorded accounting without registering prompts, tools, or model-visible events.

#### KV Cache effect

None; usage queries do not assemble or send provider requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The report covers retained Harness history on the connected Host. Deleted Sessions and external CLI/provider history are absent. It is not an invoice, has no monetary estimates, and does not infer missing provider usage. The interval spans independently captured Session observations rather than one global database transaction.

Session and event bounds limit aggregate work, not cold-log decoding. The existing observation API can prepare a complete cold log before its event count is known. Its cancellation remains cooperative; compressed log frames may finish decoding before observing abort. A strict pre-decode byte/event admission policy requires support from the Session Query and persistence owners. Bounds select newest-created Sessions first and report omitted coverage explicitly.
