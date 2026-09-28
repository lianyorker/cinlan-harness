# Agent Note: Multimodal tool-result retention

Status: implemented

English | [中文](2026-09-23-cinlan-multimodal-tool-result-retention.zh.md)

## Problem

Tool results can contain ordered text and images, while model context limits and image pricing vary by provider route. A byte-only text cap cannot account for visual request cost, preserve image positions, or give the model a usable way to recover an omitted attachment.

Nested PTC calls add a second requirement: the program must receive the complete canonical value, while the model-facing dispatch log and durable tool result stay bounded. A failed nested call must remain an error result and must not create a successful recovery context.

## Decision

`@deepseek-ai/dsh-spill-policy` accepts final content composed only of `text` and `image` blocks after downstream `tools/post-execute` decisions settle. It retains ordered head/tail content under `maxInlineTokens` and leaves unsupported block types unchanged.

The budget includes retained text, indivisible image blocks, omission-gap text, image recovery descriptors, and route-specific visual pricing. Text may split at a safe surrogate-pair boundary; an image is retained or omitted as a whole, and retained blocks preserve their original order.

The policy saves the complete ordered text representation through `ctx.spillStore.saveText()`. Image bytes remain in attachment storage; each saved image position records a readable attachment path and dimensions so the model can use `read_image` after reading the spill file. Explicit `read` and `read_image` model-facing results bypass retention, including nested PTC forwarding: reapplying a cap below one image’s cost would make recovery impossible. Their dispatch log copies remain bounded.

Image pricing is resolved from the active agent request route, with the configured provider/model fallback. Missing route pricing, attachment access, filesystem access, storage, ownership, or notice budget preserves the original content and logs a warning; a successful tool call is never converted to `isError` by spill recovery failure.

`projectContent` runs before the spill policy. MCP tools therefore expose image blocks to retention, while `finalizeContent` remains a later last-mile transform. Invalid-argument failures do not retain a projector captured for a successful execution.

For successful nested PTC image results, the policy may add a recovery user message with source `{ kind: 'plugin', plugin: 'tools-ptc' }`. Results with `isError` do not add that context; their image content remains part of the error result.

## Consequences

The deployment knob is estimated tokens rather than UTF-8 bytes. Existing byte-sized budgets require recalibration, and model-visible snapshot fixtures must record the resulting preview and notice.

Text-only nested logs can be bounded asynchronously without delaying the program value. Image-bearing nested results other than explicit recovery are retained before model forwarding so the dispatch log and recovery path describe the same ordered content.

The previous spill storage decision remains active for ownership, locator opacity, local file safety, and cleanup. This Note supersedes only its text-only retention mechanics; the relationship is recorded in [the storage Note](2026-07-08-tool-output-spill-files.md).

## Alternatives considered

**Keep a UTF-8 byte cap.** Rejected: it cannot price images by route or express an attachment recovery cost in the same model-facing budget.

**Drop images from the preview and save only text.** Rejected: omission would be silent and the model could not recover the original visual input at its position.

**Use an official `ptc-mode` recovery source.** Rejected: Cinlan uses the existing `MessageSourceMap` entry `{ kind: 'plugin', plugin: 'tools-ptc' }`; changing it would alter local session semantics.

## Verification

Focused retention, notice, multimodal, spill-policy, core tools, MCP, and client spill tests cover token boundaries, image ordering, pricing, recovery, PTC forwarding, failure fallback, and HMR disposal. Actual `tool-fs` recovery with attachments and provider pricing covers native and nested PTC reads when the cap is below one image’s cost, including bounded dispatch logs and no redundant model-facing spill. TypeScript project checks cover tools, MCP, spill-policy, and the token-meter export.

The bilingual package and subsystem documentation, generated configuration catalog, and this Note describe `maxInlineTokens` and the image recovery contract. The `multimodal-spill-ends` and `multimodal-spill-middle` headless scenarios provide current-format Session JSONL replay evidence for bounded image results and omitted-image notices.