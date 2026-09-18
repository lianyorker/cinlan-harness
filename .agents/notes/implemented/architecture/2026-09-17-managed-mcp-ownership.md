# Agent Note: MCP management separates desired records from observed connections

Status: implemented

English | [中文](2026-09-17-managed-mcp-ownership.zh.md)

## Problem

A settings switch records user intent but cannot prove that an external server started or stopped. Replacing an unconfirmed child can duplicate tool namespaces, and deleting its desired record can hide an outstanding process. Editing composition-owned entries from a separate settings database also creates competing owners. Credential values and untrusted server descriptions can leak through management diagnostics unless public data is deliberately constrained.

## Decision

The [manager](../../../../packages/mcp/mcp-management/README.md) owns revisioned records for the actual current profile and programmatic children created from those records. The [bridge](../../../../packages/mcp/mcp-client/README.md) owns SDK connections, discovery, tool registration, and cleanup. External root composition connections appear read-only with their actual entry or plugin owner. Agent-scoped connections do not become profile-managed records, and the UI does not claim patch-layer provenance that the Loader does not expose.

Save and enable commit desired state before activation. A startup failure therefore preserves the enabled record and its observed error. Removal confirms cleanup before committing deletion. A failed removal write can restart the still-committed enabled definition. Reconnect resolves credential references afresh; refresh performs discovery only on the current live connection and never invokes a model tool.

Bridge shutdown orders contribution withdrawal, SDK cleanup, and namespace release within one owned disposal path. An unconfirmed close retains the failed manager handle and quarantines the namespace, refusing replacement. Desired disablement may remain committed while the failure stays visible. The disposed contribution is absent from the public registry and tool runtime even when the separate failed handle remains retained. The manager invariant compares these actual observations, not the mere presence of a process handle.

Desired records hold credential references. Resolved values are excluded from public snapshots, errors, managed diagnostics, and displayed descriptors. A secret in a public tool name rejects discovery instead of inventing a different tool identity. HTTP configuration rejects URL user information, queries, and fragments. The [controller](../../../../packages/api/mcp-controller/README.md) streams committed snapshots through the existing authenticated carrier; cancellation directly releases subscriptions even when a generator is paused at a yielded frame.

The [native page](../../../../packages/client/ui-settings-mcp/README.md) keeps drafts separate from the authoritative snapshot, renders actual discovered tools and owners, and indexes localized static field copy only. The [original MCP decision](../feature/2026-07-07-mcp-client-plugin.md) still owns SDK selection, tool naming, and model-tool bridging. Management reuses that implementation; the earlier decision is complementary and remains active.

## Alternatives considered

**Rewrite arbitrary Loader composition from the settings database.** A record cannot safely own a connection whose actual configuration belongs to a separate plugin or preset. Read-only observation preserves that owner.

**Delete or replace after a shutdown timeout.** A timeout is not evidence that the external server stopped. Quarantine preserves the failure and prevents namespace reuse while cleanup is unconfirmed.

**Treat successful save as connected, or implement a second bridge for managed servers.** Desired state and external readiness can differ. One bridge preserves the same discovery, execution, and teardown semantics across both ownership paths.

## Consequences

Management covers root connections in the current profile and preserves configured timeout and retry values without exposing every option as a setting. Static environment and header credential references are supported; OAuth, Resources, Prompts, and per-Agent assignment controls are outside this implementation. Package READMEs own the complete configuration and failure behavior.

Real Loader compositions exercise revision conflicts, discovery, committed enablement, cleanup refusal, rollback after write failure, and authenticated controller calls. The close-failure regression verifies an empty registry and absent tool contribution for a disabled quarantined child, then dispatches the actual invariant check; the negative control still rejects a healthy live registration for a disabled record. Stream tests cover waiting and paused cancellation. Runtime bundles emit bridge, registry, and invariant entries together and publish shared chunks so artifact verification can check their identities.
