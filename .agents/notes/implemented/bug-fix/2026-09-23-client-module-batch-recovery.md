# Agent Note: Client module batch recovery and diagnostics

Status: implemented

English | [中文](2026-09-23-client-module-batch-recovery.zh.md)

## Problem

A shared startup combo can reject at transport or execute without registering every graph row. Replaying it can duplicate factories that already registered, while a generic Loader message hides the row-specific cause from the boot page.

## Decision

\`ClientModuleSystem\` shares one transport promise per URL, retries a rejected batch once, and remembers every URL whose script completed. A batch that still lacks a row is marked failed and the row uses its single-resource URL; a completed batch is never replayed for another missing row. Single-resource failures remain retryable on a later import. Dependency arrival errors name both the consumer and failed dependency.

The loader records the last \`import()\` or \`prefetch()\` failure for each graph row, including transport, registration, dependency cascade, and factory execution. A successful operation and \`invalidate()\` clear the record. \`ClientModuleLoader.importError()\` exposes the record using the same \`/client\` id normalization as import.

\`AppWebEntry\` keeps collecting Loader entry-creation and await failures long enough to audit every entry. The audit uses the recorded module error when present, so the framework-free boot page shows the actionable row failure instead of only the Loader wrapper.

## Alternatives considered

**Replay every batch for each missing row.** A sequential script can have registered earlier rows before failing to register the requested row; replaying would hit duplicate registration and obscure the original failure.

**Fail the whole graph after one batch error.** The host provides a one-resource response for every row, so isolating only the missing rows preserves already registered plugins and allows the rest of the graph to start.

**Keep import details in the console only.** The boot page is the visible recovery surface when Loader activation fails; retaining the last row error lets it identify transport, dependency, and factory failures without requiring developer tools.

## Consequences

A broken startup batch costs one retry plus one fallback request per missing row at most, while rows registered by the batch remain usable. Error records are page-local and are discarded after recovery or invalidation; they do not alter the boot wire or persisted session data. Loader failures that do not correspond to a module row still use their original diagnostic.

## Testing

Client module tests cover shared retry, batch fallback, partial registration, executed-URL memory, retryable one-resource failures, dependency causes, factory failures, record clearing, and \`/client\` lookup. Web boot tests cover the recorded import message on a fiberless entry. TypeScript and \`oxlint\` checks run for both packages; real-API E2E is not involved.
