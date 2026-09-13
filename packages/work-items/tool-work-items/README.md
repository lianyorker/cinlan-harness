---
description: "Model-facing Work Items reads and durable external-write approval tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-work-items

English | [中文](README.zh.md)

## Summary

This package is the model-facing Consumer for the provider-neutral [`ctx.workItems`](../work-items/README.md) capability. It owns six tool definitions, bounded model-input validation, stable system guidance, canonical result projection, timeout metadata, concurrency declarations, and generic render intent; it does not import a concrete provider or perform HTTP, credential resolution, endpoint selection, header construction, or GraphQL execution.

## Table of Contents

- Summary
- Tools
- Approval protocol
- Configuration
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

## Tools

| Tool | Arguments | Result and side effect |
|---|---|---|
| `work_items_list` | Optional `source`, structured `scope`, `query`, `state`, `cursor`, and `limit` | A bounded page of normalized GitHub or Linear Work Items; read-only. |
| `work_items_get` | Opaque `id` returned by a Work Items read | One normalized Work Item; read-only. |
| `work_items_prepare_write` | One `create`, `comment`, `state`, or `assign` mutation | A durable immutable preview with an `operationId`; it does not contact the provider to mutate state. |
| `work_items_confirm_write` | Exact `operation_id` from a stored preview | Executes that stored preview or returns its existing receipt; no replacement mutation fields are accepted. |
| `work_items_cancel_write` | Exact `operation_id` from a stored preview | Cancels an unexecuted preview without contacting the provider. |
| `work_items_list_writes` | Required provider `source` and `limit` | Bounded durable previews and receipts; it does not issue provider mutation requests. |

## Approval protocol

A model-facing write is always two-step: prepare persists the exact mutation and its target revision, then confirmation accepts only the persisted `operation_id`. The Consumer never lets a confirmation call replace the approved mutation. `running` and `unknown` receipts can represent an external request whose outcome is not locally known; the system guidance forbids automatic retry, and the model should verify the provider or the Host UI before deciding on a new preview.

Read scopes are structured GitHub `owner`/`repository` or Linear `team`/`project` values. The model cannot submit an arbitrary URL, endpoint, header, token, credential reference, or GraphQL text. Tool results rebuild normalized item and receipt fields and omit the Provider writer's internal scope string, so credential configuration metadata does not enter model context.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `60000` | Cooperative timeout metadata attached to every Work Items tool call. |

Unknown keys and timeout values that are non-positive, non-integer, unsafe, or above the runtime timer limit fail during plugin setup. Read tools and write-history reads declare sibling concurrency safety; prepare, confirm, and cancel retain ordering because they operate on one durable approval ledger.

## Model Experience

### Work Items system prompt

#### What the model sees

The plugin adds one stable section explaining normalized reads, the immutable prepare/confirm/cancel protocol, exact operation identities, and the handling of uncertain receipts.

##### Work Items guidance

```markdown
Use work_items_list or work_items_get for Work Items reads. External changes use two steps: call work_items_prepare_write to persist an immutable preview, inspect its operation_id and mutation, and call work_items_confirm_write with exactly that operation_id only after the requested approval. work_items_confirm_write and work_items_cancel_write never accept replacement mutation fields. A running or unknown result may have reached the provider; do not retry it automatically. Use work_items_list_writes or the provider UI to verify uncertain outcomes. Provider scope is deployment-configured; never invent an endpoint, header, token, or GraphQL text.
```

#### Token effect

The fixed guidance adds a stable request-prefix cost while this Consumer is active.

#### KV Cache effect

The prompt prefix remains reusable while the plugin scope and guidance text are unchanged. Loading, unloading, or changing the Consumer can invalidate reuse from the first changed prompt token.

### Work Items tool schemas

#### What the model sees

When visible, the model receives six `work_items_*` definitions for normalized reads, durable preview approval, cancellation, and receipt history. The generated [tool schema catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-work-items) records their exact parameter schemas and descriptions.

#### Token effect

The six fixed definitions add a stable request-prefix cost whenever the Consumer is visible; mutation bodies and read filters add data-dependent call tokens.

#### KV Cache effect

Unchanged definitions and visibility preserve a reusable prefix. Configuration or tool-scope changes invalidate reuse from the first changed schema token.

### Work Items tool results

#### What the model sees

Read results contain normalized item fields and bounded pagination. Write results contain the exact mutation, operation identity, status, target summary, receipt, and safe error code; internal provider scope and credential metadata are omitted. An `unknown` result is a verification signal, not a retry instruction.

#### Token effect

Item bodies, labels, assignees, and write previews are data-dependent and remain in the session context until compaction. Pagination and explicit limits bound each returned page or history read.

#### KV Cache effect

Tool results append after the reusable request prefix and do not alter already cached prompt or tool-definition tokens.

## Known Limitations and Deferred Work

- External writes require a configured Provider with `allowWrites` enabled and durable `storageDomain`; this Consumer does not enable either setting.
- An uncertain or recovered `unknown` receipt is never automatically retried; the provider or Host UI must establish the outcome before a new preview is prepared.
- The Consumer does not provide repository/team discovery, bulk mutations, deletion, arbitrary provider endpoints, caller-selected headers, credential values, or caller-authored GraphQL text.
- Provider-specific state names, assignment rules, pagination behavior, and availability remain owned by the selected Work Items Provider.

<a id="dev-note"></a>
### Dev Note

The Consumer deliberately projects only the model contract. Provider credentials, transport, response normalization, durable ledger semantics, and Host/UI presentation remain in their owning packages.

No runtime invariant companion is published because ToolRuntime owns logged call/result relations and WorkItemsRuntime owns provider registration and durable write state; this package retains no second authority.
