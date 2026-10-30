# Agent Note: Live automatic title admission

Status: implemented

English | [中文](2026-10-19-automatic-title-control.zh.md)

## Problem

Automatic model titles spend additional requests and can replace a generated name while a user works. Disabling the whole provider removes explicit regeneration and forces configuration reloads unrelated to the user preference.

## Decision

The [title service](../../../../packages/session/session-title/README.md) owns a live `automaticEnabled` field, enabled by default. Closing admission removes queued automatic revisions and aborts active automatic calls. Acceptance checks the field again so late results cannot commit. Explicit refresh is independent, deterministic fallback remains available, and user renames keep their pin. Re-enabling accepts future prompts rather than replaying missed automatic work. No Session event or persisted format changes.

The General settings control uses the existing revision-fenced configuration form and accepted Host values. It exists only while the title namespace is served, and the service suppresses its duplicate generated page. Loading and read-only connections cannot mutate the setting.

## Alternatives considered

Disabling the provider also disables explicit regeneration. Hiding only the UI would leave model requests running. Cancelling all title work would discard a deliberate user refresh. Recording a new Session preference would duplicate a deployment-wide configuration choice.

## Consequences

The field affects every Session on that Host, not one Session. Loader tests cover queued and active cancellation, late results, explicit refresh, re-enable, and manual naming. A real profile-editor test verifies file persistence and cold restart; client tests cover accepted readback, refusal, retry, read-only state, namespace withdrawal, and locale-owned copy. These checks do not establish real-model or browser visual acceptance.
