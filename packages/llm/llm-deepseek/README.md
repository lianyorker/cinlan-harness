---
description: "Configure DeepSeek Chat Completions or Messages on the deepseek-official route, with thinking, image input, and per-request settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek

English | [中文](README.zh.md)

## Summary

Stream DeepSeek models through the `deepseek-official` route with configurable thinking, vision input, and an advisory model catalog. Chat Completions is the default; Messages is an explicit choice. Endpoint, credentials, catalog, and thinking policy resolve per request, so valid settings changes apply to the next request without restarting. Choose this package for DeepSeek's API or a compatible gateway; it can run beside pi-ai because they use different route names.

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

Mount this plugin when a composition streams DeepSeek models through the harness LLM service. It registers the single `deepseek-official` route and resolves connection facts per request, so a composition entry plus an optional user settings section drive the whole adapter.

### When to choose it

Choose this adapter for DeepSeek's official API or a gateway that implements the selected Chat Completions or Messages protocol. Choose `dsh-llm-pi-ai` when the composition also routes other providers through pi-ai's catalogs. The two adapters can be mounted together because their route names do not collide; another adapter claiming `deepseek-official` fails with `DUPLICATE_ADAPTER`.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    protocol: chat-completions   # optional; messages requires an explicit choice
    apiKeyEnv: DEEPSEEK_API_KEY  # credential reference, resolved per request
    baseURL: https://api.deepseek.com # optional; $DEEPSEEK_BASE_URL then this default
    reasoningEffort: high        # optional; off | low | high | max
    maxTokens: 256000            # optional per-request output cap
    maxRequestFilesBytes: 134217728
    maxInlineRequestImageBytes: 20971520
    maxImagesPerRequest: 600
    filesApiTimeoutMs: 60000
```

A request selects the route with `provider: deepseek-official`; the model id passes through to the wire, so new DeepSeek models need no re-registration. Omitted `models` advertises `deepseek-flash` (DeepSeek-V41-Flash) with text and image input and `deepseek-v4-pro` with text input; both have a 1,000,000-token context window. An explicit list replaces those defaults, and unlisted model ids still pass through as text-only routes. Clients, including model discovery tools, can read the advisory entries through `ctx.llm.listModels('deepseek-official')`. Image-capable entries may set `imagePixelBudget` to a positive integer or `low`, and may set `imageMaxBytes`. An entry may declare `systemPromptUpdate: in-history` when its endpoint reads the latest `system` message at any position of `messages` as the complete effective system prompt; the adapter reports the mode on the resolved model and the prepared call, and the agent loop then appends a changed prompt after the cached history instead of rewriting the leading system message ([decision rule](../../core/agent-loop/README.md#understand-the-implementation)). The default `deepseek-flash` entry declares this mode; V4 Pro does not. An explicit catalog controls each model's capabilities, and any value other than `in-history` fails at load with `llm-deepseek: catalog model "<id>" systemPromptUpdate must be "in-history" when present`.

| Field | Default | Meaning |
|---|---|---|
| `protocol` | `chat-completions` | Wire protocol: `chat-completions` or `messages` |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference resolved per request through the credentials seam, then the environment |
| `baseURL` | Protocol root | Explicit value wins, then `$DEEPSEEK_BASE_URL`; otherwise `https://api.deepseek.com` for Chat or `https://api.deepseek.com/anthropic` for Messages |
| `thinking` | `enabled` | Deployment policy; `disabled` locks every request to `off` |
| `reasoningEffort` | `high` | Default effort: `off`, `low`, `high`, or `max` |
| `maxTokens` | `256,000` | Per-request output cap; a model's own cap and explicit request values win |
| `defaultContextWindow` | `1,000,000` | Capacity fallback for models without an exact value |
| `models` | V41 Flash + V4 Pro | Advisory catalog shown by discovery consumers |
| `streamIdleTimeoutMs` | `300,000` | Maximum provider idle time per outstanding stream read |
| `maxRequestFilesBytes` | `128 MiB` | High watermark for retained request-image bytes before oldest-first offload |
| `maxInlineRequestImageBytes` | `20 MiB` | Independent base64 fallback high watermark |
| `maxImagesPerRequest` | `600` | High watermark for retained request-image count |
| `imageOffloadByteQuantum` | `64 MiB` | Files-mode oldest-prefix removal quantum |
| `inlineImageOffloadByteQuantum` | `10 MiB` | Inline-mode oldest-prefix removal quantum |
| `imageOffloadCountQuantum` | `20` | Count-overflow removal quantum |
| `filesApiTimeoutMs` | `60,000` | Per-image Files resolution deadline |
| `fileExpiresAfterSeconds` | `604,800` | Requested uploaded-image lifetime |
| `fileRefreshMarginSeconds` | `3,600` | Remaining lifetime below which an id is replaced |
| `fileQuotaCleanupBatch` | `100` | Oldest harness-owned files removed before one quota retry |
| `retryPolicy` | normal, 5 retries | Provider-owned retry policy executed by `dsh-llm-retry` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-deepseek) is the exhaustive source for every accepted field and its JSDoc.

### Streaming with thinking and images

An image-capable route resolves each durable reference into a deterministic request version under its pixel and byte budgets. `imagePixelBudget` accepts a positive integer or `low`; omission uses 640,000 total pixels, `low` uses 512×512 total pixels, and `imageMaxBytes` defaults to 1 MiB. Alpha images use WebP effort 0 and opaque images use JPEG on the 85/75/60 quality ladder, keeping the smallest output when every candidate exceeds the target. Every retained image is preceded by text naming its complete attachment id and actual request dimensions. When the current filesystem maps the attachment provider's host object, that text also carries a read-only execution-world path and the extension for a writable copy. Text-only and unlisted routes receive stable attachment placeholders while durable history keeps the image references.

Both protocols upload exact request bytes through their DeepSeek Files endpoint and send file-id blocks. A failed or timed-out file resolution rebuilds the whole request with inline base64: data URLs for Chat Completions and native image-source blocks for Messages. Requests never mix file ids with inline images. Cached ids are scoped by the resolved Files root and API key, refreshed before expiry, and shared through waiter-local cancellation. A stale-file response permits one replacement attempt; quota failure deletes one configured batch of the oldest harness-owned files before one upload retry.

Files mode bounds retained request versions by `maxRequestFilesBytes` and `maxImagesPerRequest`; inline fallback has its own base64 budget. Both remove an oldest prefix in configured byte or count quanta. Each omitted image gets its own model-visible placeholder with its display name or attachment id and, when available, normalized dimensions, media type, and current read-only path. The stepped high-watermark policy avoids rewriting an old request prefix after every new image.

`reasoningEffort` selects `off`, `low`, `high`, or `max` when deployment policy permits thinking. Enabled efforts serialize as Chat Completions `reasoning_effort` or Messages `output_config.effort`; `off` sends `thinking.type: disabled`. Unsupported efforts fail with `UNSUPPORTED_REASONING_EFFORT` before network I/O, and `thinking: disabled` rejects non-`off` defaults at plugin load. Session-title requests force thinking off.

### Messages protocol

Set `protocol: messages` explicitly. Without an endpoint override it uses `https://api.deepseek.com/anthropic`; a configured root ending in `/v1` is used directly, and other roots gain `/v1` before `/messages` or `/files`. Messages endpoints must be HTTP(S) URLs without credentials, query parameters, or fragments. The transport sends `x-api-key`, `anthropic-version: 2023-06-01`, and the Files beta header when file references are present; it refuses redirects.

Messages preserves signed thinking only for valid same-model replay metadata. Invalid metadata produces a diagnostic and falls back to the durable provider-neutral blocks without changing stored messages. Malformed or non-object historical tool arguments serialize as an empty object, keeping the tool name, call id, and result. Fresh completed tool calls still require valid object JSON. Later system snapshots either replace the top-level system prompt or, for an explicitly capable model, follow the next user/tool-result turn in history.

Messages Files metadata has no remote expiry; the upload creation time plus `fileExpiresAfterSeconds` bounds local reuse. List and retrieve responses do not invent expiration. Quota recovery scans Messages pages to select the oldest harness-owned files.

### Dynamic configuration

Connection facts are re-read once per operation through the optional settings and credentials seams. A `llm-deepseek:` section in the user settings document overrides any field without a restart; a snapshot that fails a beyond-schema bound keeps the last good facts and logs the failure. The API key resolves per stream call from the same snapshot that supplies the endpoint, image and Files policies, and idle budget, so a rejected settings generation contributes none of them. Image requests resolve the attachment service at request time, so load order does not freeze image availability. Switching protocols preserves an explicit endpoint and the configured model list; the endpoint must serve the selected protocol. A prepared call keeps its protocol and credentials even if settings change before dispatch.

### Provider-specific request fields

When `ctx.deepseekLlmApiExtensions` is present, the adapter prepares its registered top-level fields from the exact serialized base request before `fetch`. Preparation or field collisions fail before HTTP; after a 2xx response, the adapter accepts every captured contribution before consuming SSE. Transport and non-2xx failures do not accept them. Shipped compositions use this for the optional incremental `dsh_session_log` field and the default-on active `dsh_plugin_packages` inventory; both stay outside model input.

### Failures and recovery

Non-2xx responses fail with stable codes: `AUTH` (401/403), `QUOTA`, `RATE_LIMIT`, `CONTEXT_WINDOW_EXCEEDED`, `INVALID_REQUEST`, `SERVER`, and `HTTP_<status>` otherwise; pre-response transport failures throw `TRANSPORT`, caller aborts throw `ABORTED`, and stream-idle expiry throws `TIMEOUT`. Request-extension preparation, field collision, or post-2xx acceptance fails with `REQUEST_EXTENSION`. A normalized-image rejection names every plausible attachment and its durable position when the provider does not identify a file id. Stale-file rejection invalidates the named mappings (or every mapping used by the attempt) and permits one replacement chat attempt. Protocol violations throw `STREAM_CLOSED` or `MALFORMED_RESPONSE`, and a terminal `stop` with no content blocks becomes `EMPTY_RESPONSE`, which the default retry policy retries. A request with no key anywhere fails with `MISSING_CREDENTIAL`, and a malformed credential fails with `INVALID_CREDENTIAL` naming the reference to fix — never any part of the key.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the adapter; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The plugin is built on one explicit resolve step and one registration fact. `resolveAdapterOptions()` is the single path from raw config to validated connection facts, and the adapter re-reads those facts through a thunk once per operation — base URL, catalog, request defaults, image and Files policies, and idle budget all take effect on the next request, while an in-flight stream keeps the facts it started with. The only fact captured at registration is the retry policy: when its resolved value changes, the plugin re-registers the route in place, in one synchronous section, so no request observes a gap.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, per-request resolution, settings and credential wiring |
| [`src/adapter.ts`](src/adapter.ts) + [`src/model-info.ts`](src/model-info.ts) | Request-local protocol selection, shared capabilities, and Chat Completions transport |
| [`src/file-store.ts`](src/file-store.ts) + [`src/files-api.ts`](src/files-api.ts) | Scoped upload caching, expiry, stale-id recovery, quota cleanup, and remote file operations |
| [`src/serialize.ts`](src/serialize.ts) + [`src/protocols/messages/serialize.ts`](src/protocols/messages/serialize.ts) | Protocol-specific thinking, image, tool, and system-message serialization |
| [`src/sse.ts`](src/sse.ts) | `eventsource-parser` SSE framing for the direct `fetch` stream |
| [`src/translate.ts`](src/translate.ts) | SSE payload translation into harness `StreamChunk` values; tool-call `id` and `name` are identity, so a continuation delta repeating them empty or null leaves the established value alone |
| [`src/protocols/messages/adapter.ts`](src/protocols/messages/adapter.ts) + [`src/protocols/messages/translate.ts`](src/protocols/messages/translate.ts) | Messages transport, streaming blocks, usage, and native replay metadata |

### Wire flow

One stream resolves deterministic request images, prefers Files ids, prepares request extensions, dispatches the selected protocol, accepts extensions after HTTP 2xx, and translates SSE into harness chunks. Shared Files recovery and extension acceptance keep the two protocols aligned. Messages stores only index-aligned thinking signatures alongside provider-neutral content; Chat Completions ignores that native metadata. Model calls carry attribution, the anonymous user id, and an optional session id outside model input.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the service contract to the twin adapter, the retry executor, and the shared types.

- [dsh-llm service](../llm/README.md) — the provider-neutral service this adapter registers on.
- [llm-pi-ai adapter](../llm-pi-ai/README.md) — the library-backed twin serving other providers and gateways.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the `StreamChunk` protocol and adapter contract.
- [llm-retry](../llm-retry/README.md) — the retry executor that applies this adapter's `retryPolicy`.
- [DeepSeek request extensions](../deepseek-llm-api-extensions/README.md) — lifecycle and acceptance semantics for provider-specific top-level fields.
- [Session-log upload](../../session/session-log-deepseek/README.md) — the opt-in incremental `dsh_session_log` contribution.
- [Plugin package inventory](../plugin-package-inventory-deepseek/README.md) — the default-on `dsh_plugin_packages` contribution.
- [Twin LLM adapters](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md) — why DeepSeek ships two structurally different adapters.
- [Mandatory app attribution headers](../../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md) — the identity every provider request carries.

-----

<a id="model-experience"></a>
## Model Experience

### DeepSeek request

#### What the model sees

The selected DeepSeek model receives the harness system prompt, message history, tool schemas, stop sequences, and call config (`maxTokens`, `reasoningEffort`, `temperature`) without adapter-authored prompt prose. Provider-specific request-extension fields remain outside model input. The vision model normally receives retained user and tool-result images as Files API references beside attachment handles and request-preview dimensions. It also receives a normalized-object path when the current execution filesystem maps the attachment provider's host object; the descriptor marks this copy read-only and warns that normalization may have resized or re-encoded the upload. A Files resolution failure sends all retained images as inline data URLs instead, and an over-budget older image keeps the access resolved for that request in its placeholder. Reasoning content from a prior assistant turn is passed back verbatim, whether or not that turn called a tool.

#### Token effect

Provider tokenization governs exact text and image-token input. The adapter declares per-route `imageRequestPricing`: it reproduces oldest-first image offload from durable byte lengths and prices each retained image at its projected dimensions with the published v4 vision accounting (14px patch grid, 3:1 downsampling, 384-token cap, worst-case alignment pad). This lets the token meter price image pressure before a request; reported usage remains authoritative. Reasoning passback carries every reasoned turn's chain of thought into later requests, while dropping over-budget images avoids paying those tokens again. Cache-read usage is reported when available. `totalTokens` is the exact `prompt_tokens + completion_tokens` aggregate and is omitted if a supplied `total_tokens` disagrees. Messages usage reports input, output, cache-read, and cache-write counters separately and sums them into `totalTokens`.

#### KV Cache effect

An unchanged assembled prefix is eligible for DeepSeek cache reuse, which this adapter reports in usage. Deterministic request-image bytes do not make the full prefix immutable: a changed execution-world path rewrites historical descriptor text, a refreshed upload can replace a `file_id`, and Files-to-base64 fallback changes the image representation. Any of these, or a model-route, prompt, schema, history, or image-budget change, may prevent reuse from the first affected token; reasoning passback appends on every reasoned turn. On a catalog entry declaring `systemPromptUpdate: in-history`, a system prompt change inside a continuing request series is appended after the cached history, so the prefix through that history stays reusable; a tool-schema change still prevents reuse from the first altered token.

### DeepSeek response

#### What the model sees

Reasoning, text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the request's logged reasoning effort and `maxTokens`; only loop-retained blocks affect later input.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix; dropped blocks have no later cache effect. Changing the provider or model selects a different cache domain.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the adapter stops and future work begins. They are current package constraints, not a general DeepSeek comparison or a task backlog.

- **A settings `models` list replaces the composition list wholesale** — settings-layer merging is per-field, and arrays are one field; per-entry catalog merging would need a keyed shape.
- **`tool_choice` is not mapped** — not part of the core vocabulary (shared with the pi-ai twin).
- **Requests use raw `fetch`, not `@cordisjs/plugin-http`** — no shared proxy or interception configuration.
- **Content support is protocol-specific** — Chat Completions skips plugin-added block types and sends `(no output)` for empty tool output; Messages rejects unsupported blocks and preserves empty tool-result content.
- **Images are input-only durable attachments** — direct external URLs and assistant image output are not supported; DeepSeek input normally uses the Files API and uses inline base64 only for per-request recovery.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- OpenRouter-specific app attribution headers are deferred to a future explicit OpenRouter adapter or mode; OpenAI-compatible gateway requests carry only the shared attribution baseline.
- The `off` reasoning effort never crosses the wire as `reasoning_effort: 'off'`; it serializes as `thinking: { type: 'disabled' }` and omits the field, which keeps the wire spelling valid for gateways that reject unknown effort values.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
