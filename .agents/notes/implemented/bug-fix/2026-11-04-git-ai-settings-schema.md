# Agent Note: Git AI settings schema ownership

Status: implemented

English | [中文](2026-11-04-git-ai-settings-schema.zh.md)

## Problem

The Git settings page wrote `sourceControlAi` through the shared `git-source-control` namespace, but the Host schema omitted that field. The settings provider could not preserve the AI configuration as a validated durable preference, despite the client types and controls exposing it.

## Decision

`GitSourceControlSettingsSchema` owns the defaults and validation for `sourceControlAi`, beside the other durable Git preferences. `GitSourceControlSettings` requires the resolved AI settings object; callers that need defaults use the shared schema rather than maintaining a second optional interpretation. Recipe templates, diff budgets, toggles, and optional runner metadata are bounded by this schema.

The schema is browser-safe and imports the shared default object from `ai-author.ts`; that module imports settings types only, so the defaults have one runtime owner without a cycle.

## Alternatives considered

**Keep `sourceControlAi` optional and rely on UI fallbacks.** This leaves persistence validation unable to accept the field and allows UI consumers to disagree about defaults. A resolved schema value gives Host and Client one typed configuration.

**Store AI preferences in a second namespace.** This would split Git preferences across owners and require separate Settings registration and page bindings. The existing Git settings namespace already owns the controls and is the smallest consistent persistence owner.

## Consequences

The shared schema accepts and normalizes AI settings in Host and browser consumers, and existing records without the new field receive defaults. The Git sidebar applies saved enablement, recipe, diff-budget, and sensitive-file settings when preparing a draft. Its one-shot runner uses the attached Session's recorded provider route, permits a recipe to override only the model id, and records the exact model request in a log-only Session event before dispatch. The generated text only fills the commit editor; it does not mutate Git. Diff review and PR-description recipes still have no action consumers.

## Testing

The `git-settings` schema tests cover default resolution, invalid budgets, and a custom recipe override. The Git settings page, AI author helper, sidebar Git view, and Git Remote controller suites cover editing, prompt construction, model routing, pre-dispatch logging, cancellation, deadline, provider failures, and draft-only output. These tests do not prove a full profile restart round trip for the settings field or a real-provider request.
