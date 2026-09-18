---
description: "Inspect recorded Turn usage with UTC and route filters, explicit accounting gaps, and CSV export."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

## Summary

Use the Usage settings page to inspect recorded Turns and provider-reported tokens in a UTC interval. Filter by exact provider and model, refresh live data manually, and download the displayed report as CSV. Missing accounting and partial scans remain visible, so a known zero cannot be confused with unavailable usage.

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

The Usage entry belongs to Settings → Experimental. Dates mean midnight UTC: the start date is inclusive and the end date is exclusive. The initial interval includes today and the preceding six UTC dates. Provider and model options come from exact identities observed by the Host before route filtering; selections match those strings exactly.

The unit is **Turns**. Tokens include only known complete Turns, with attempts and retries supplied by the Host's canonical accounting. Reasoning tokens are an output subset. Missing optional cache or reasoning buckets remain unavailable, while an actual zero stays zero. Mixed or unattributed routes remain explicit and never get guessed into filtered totals.

A complete report with no matching Turns is empty. An incomplete scan with no observed matches remains partial, and its zero counts do not establish that no usage occurred. Coverage includes scanned and skipped Sessions, examined events, unattributed Turns, the Host completion time, and localized reasons. An absent Remote service leaves the page available with an unavailable message; a failed query exposes a localized retry state.

Refresh reads the selected interval again. Download CSV uses exactly the displayed result, including its filters, route rows, token buckets, and coverage. Loading, invalid dates, unavailable service, and query failures disable export. CSV labels follow the current English or Chinese locale, preserve numeric zero, quote multiline labels, and neutralize spreadsheet formulas in provider and model text.

### Composition and configuration

The package has no configuration fields. Its Host entry is inert; the Client plugin contributes to `settings.section` and `settingsMetadata` under section id `usage` and group `experimental`. The enclosing application supplies the settings slot owner, locale service, and authenticated Usage Remote. [Usage API types](../../api/usage-controller/src/types.ts) define the request and report data.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[The registration](src/client/index.ts) owns dictionaries, settings metadata, one query source, and the viewing-state handle. Slot declaration lifetimes remove and restore metadata together with the page. A nested Remote injection calls `ctx.remote.usage.query(request, signal)` and unwraps its `RemoteResult`; its absence never creates a replacement service.

[The source](src/client/source.ts) owns report snapshots and one AbortController per request. Superseded requests cannot publish; page unmount cancels current work; plugin disposal clears listeners, aborts outstanding work, and awaits settlement. The renderer binds its stable observable through the inject hooks compartment. [The view store](src/client/filters.ts) holds only dates and route choices, with no Host data or durable settings writes.

[The page](src/client/UsageSection.tsx) receives framework props and plain callbacks. It accepts a report for rendering and export only when the echoed request matches the current filters. [CSV projection](src/client/csv.ts) shares accounting cells with the route table and releases temporary download resources after activation. Controls use native settings primitives and semantic theme tokens.

**Runtime invariant:** No companion is published. This page presents the Host's report and owns no independent cross-plugin accounting relationship; request ordering and registration disposal are covered by package tests.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These references own settings composition, query semantics, and framework data flow.

- [Settings domain](../ui-settings/README.md) — section metadata and slot declarations.
- [Usage query types](../../session-query/usage-query/src/types.ts) — exact accounting and bounded scan fields.
- [Client slots](../../../docs/subsystems/slots.md) — framework hooks, view stores, and injection.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The report is limited by recorded accounting and the Host's bounded scan.

- Refresh is manual; the page does not subscribe to live usage changes.
- Tokens are recorded provider usage, not billing charges. Missing or incomplete usage cannot be reconstructed by this page.
- Filters address exact attributable routes. Mixed routes and missing attribution can make a filtered report partial.
- The Host enforces query range and scan limits; a rejected range requires changing the selected dates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
