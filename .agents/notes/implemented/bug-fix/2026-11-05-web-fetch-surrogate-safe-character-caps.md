# Agent Note: Web fetch character-cap boundary safety

Status: implemented

English | [中文](2026-11-05-web-fetch-surrogate-safe-character-caps.zh.md)

## Problem

The HTTP fetch provider, PDF extractor, and model-facing `web_fetch` renderer applied character caps with direct UTF-16 `slice()` calls. A cap that landed on the first code unit of an emoji could emit an unpaired surrogate into the provider result or Session-visible tool text.

## Decision

All character-capped web fetch paths use `truncateWithoutSplittingSurrogatePair` from `@deepseek-ai/dsh-output-retention`. The HTTP provider applies it after charset decoding, PDF extraction applies it while consuming the remaining page budget, and `web_fetch` applies it to the conversion source and complete rendered output. Character limits continue to count UTF-16 code units; a boundary cut drops the incomplete pair and stays within the configured cap.

## Alternatives considered

**Use `Array.from()` to count Unicode code points.** This changes the existing UTF-16 code-unit contract and can allow twice as many code units through a configured character cap.

**Keep direct `slice()` and rely on JSON serialization.** JSON serialization does not make an unpaired surrogate a valid user-visible character and leaves provider results inconsistent with model-facing output.

## Consequences

HTTP text, PDF text, source conversion, and final fetch output no longer create a new unpaired surrogate at a cap boundary. The shared helper remains the single implementation for this mechanical rule; byte-oriented `TextRetainer` behavior is unchanged. The web-fetch HTTP package now declares its workspace dependency and TypeScript project reference explicitly.

## Testing

Focused HTTP and `web_fetch` suites cover emoji caps at decoded-body, source-conversion, and complete-output boundaries. Both web packages pass their strict package typechecks, bilingual README pairing, and `git diff --check`.
