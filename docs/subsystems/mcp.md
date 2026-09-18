# MCP connections and management

English | [中文](mcp.zh.md)

MCP connects external tool servers to the Harness and exposes their connection state for inspection. The [client bridge](../../packages/mcp/mcp-client/README.md) owns live connections and discovered tools; [management](../../packages/mcp/mcp-management/README.md) saves server definitions for one launch profile. This reference covers the types declared by those packages.

## Connection identity and observation

Source: [`mcp-client/src/types.ts`](../../packages/mcp/mcp-client/src/types.ts). A durable managed record and a live launcher instance have separate identities. The [root registry](../../packages/mcp/mcp-client/src/registry.ts) reports immutable snapshots with stable object identity between changes; Agent-scoped launchers do not contribute rows.

| Type | Fields and meaning |
|---|---|
| `McpServerId` | Branded durable address allocated by the profile record owner; changing `serverName` preserves it. |
| `McpConnectionId` | Branded identity for one live launcher instance; not a saved server address. |
| `McpOwner` | `kind: managed` carries `recordId`; `kind: composition` carries the actual composition owner `label`. Observation alone grants no mutation authority. |
| `McpToolDescriptor` | Public `name`, `description`, and `inputSchema` from the last committed discovery. |
| `McpConnectionState` | `phase`, reconnect `attempt`, optional `retryAt` and `errorCode`, and committed `tools`. Startup uses attempt 0; `retryAt` is Unix milliseconds and appears only during backoff. |
| `McpConnectionSnapshot` | The connection state plus live `id`, `serverName`, `transport` (`stdio` or `streamable-http`), and `owner`. It excludes executable configuration, endpoint, environment, and authorization headers. |

`McpConnectionState.phase` is `connecting`, `ready`, `backoff`, `error`, or `stopped`. `ready` means discovery committed and no later error was observed. A retained tool list during an outage does not imply successful calls; stop or retry exhaustion removes it.

`McpConnectionError` classifies failures without upstream text or credentials: `missing-credential`, `authentication-failed`, `connection-failed`, `tool-sync-failed`, `namespace-conflict`, or `close-timeout`. A stopped connection with `close-timeout` retains its namespace reservation because transport shutdown is unconfirmed.

## Saved server definitions

Source: [`mcp-management/src/types.ts`](../../packages/mcp/mcp-management/src/types.ts). Desired records contain credential references; resolution for each connection attempt stays private. Arguments and endpoint paths are public configuration and must not contain secrets.

| Type | Fields and meaning |
|---|---|
| `McpServerCommon` | `serverName`, `enabled`, optional `toolCallTimeoutMs`, and optional `reconnect`. The name is a local tool namespace matching `[A-Za-z0-9_-]{1,32}`. |
| `ReconnectConfig` | Optional `enabled`, `initialDelayMs`, `maxDelayMs`, and `maxAttempts`. Delays use milliseconds; `maxDelayMs` also sets the stable-uptime window that resets the attempt budget. Omitted values use the client bridge’s resolved defaults. |
| `McpStdioServer` | Common fields plus `transport: stdio`, `command`, literal `args`, `cwd`, and `env` mapping variable names to `CredentialRef` values. |
| `McpHeaderReference` | Credential `ref` and non-secret `prefix`, concatenated privately when resolving the header. |
| `McpHttpServer` | Common fields plus `transport: streamable-http`, `url`, and `headers` mapping names to `McpHeaderReference`. URLs exclude userinfo, query strings, and fragments. |
| `McpServerInput` | The `transport`-discriminated union of stdio and HTTP definitions, without a durable id. |
| `McpServerRecord` | An input plus durable `id: McpServerId`; server names remain unique within the profile’s desired collection. |

## Management snapshots and mutations

The [management service](../../packages/mcp/mcp-management/src/index.ts) separates persisted intent from observed connection readiness. Saving or enabling a record can succeed while its connection reports an activation error. A reconnect or connection failure does not change the saved collection revision.

| Type | Fields and meaning |
|---|---|
| `McpManagedServerView` | Desired `record`, actual `observed` connection state, and `applying` indicating whether its desired configuration still needs to be applied to the owned child. |
| `McpExternalServerView` | A connection snapshot whose `owner.kind` is `composition`; management exposes it for observation only. |
| `McpManagementSnapshot` | `profile`, desired collection `revision`, `reconciling` for pending managed operations, managed `servers`, and composition-owned `external` connections. |
| `McpSaveRequest` | Optional `id`, complete `record: McpServerInput`, and `expectedRevision`. Omitting the id creates; supplying it replaces that record. |
| `McpSaveResult` | Durable `id` and current `snapshot`, so callers need not recover a created identity by matching user-supplied text. |
| `McpRemoveRequest` | `id` and `expectedRevision`; removal stops the owned connection before committing deletion. |
| `McpSetEnabledRequest` | Removal-request fields plus `enabled`; the desired switch persists before the child lifetime is reconciled. |
| `McpServerRequest` | Managed record `id` for reconnect or probe in the current profile; it cannot address an external composition. |

`expectedRevision` compares the complete profile collection, not one server. A stale value rejects the mutation. `probe` refreshes `tools/list` on an initialized connection without invoking a tool or starting a disabled server; cancellation preserves the previous tool generation.

`McpManagementErrorCode` is `conflict`, `invalid-config`, `not-found`, `disabled`, `not-ready`, `storage-failed`, `stopped`, `probe-failed`, or `close-failed`. These fixed classifications are safe for Remote errors and localized UI text. An unconfirmed close retains the record and prevents replacement of that child.

## Launcher handles

The client’s programmatic launcher shares the same connection supervisor as its composition plugin. Launch-time ownership and credential resolution are separate from plugin configuration.

| Type | Fields and meaning |
|---|---|
| `ConnectionOutcome` | Optional `error` from the initial attempt. A fulfilled `ready` promise alone does not establish connection readiness. |
| `ConnectionHandle` | `ready` reports initial settlement; `getSnapshot()` and `subscribe()` expose committed state; `probe(signal)` refreshes descriptors; `dispose()` joins cleanup. Concurrent disposals share one completion. |
| `McpLaunchOptions` | Optional `owner`, `resolveConfig(signal)` for fresh credentials on each attempt with unchanged server identity, and `redact(text)` for removing known secrets from public metadata. |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcpmanagement--mcpmanagement"></a>

### `ctx.mcpManagement` — `McpManagement`

Persist desired state independently from connection readiness and own only programmatic children.

```ts cordis-catalog
/**
 * Read the manager's current complete profile view.
 * @returns Stable readback between desired or observed changes.
 */
getSnapshot(): McpManagementSnapshot

/**
 * Observe committed desired state and actual connection changes.
 * @param listener - Notification callback.
 * @returns Disposer for this observer.
 */
subscribe(listener: () => void): () => void

/**
 * Persist a validated definition at the requested profile revision, then start applying it.
 * @param request - New or existing record and revision last observed by the editor.
 * @returns Durable identity and a readback that separates desired state from connection state.
 */
async save(request: McpSaveRequest): Promise<McpSaveResult>

/**
 * Remove a record only after its owned connection has stopped.
 * @param request - Owned record and expected collection revision.
 * @returns Durable removal and completed child teardown.
 */
async remove(request: McpRemoveRequest): Promise<McpManagementSnapshot>

/**
 * Save enablement before reconciling its connection lifetime.
 * @param request - Explicit desired enablement and expected revision.
 * @returns Saved switch and current observed connection state.
 */
async setEnabled(request: McpSetEnabledRequest): Promise<McpManagementSnapshot>

/**
 * Replace an enabled owned child after its previous lifetime has quiesced; resolve credentials anew.
 * @param request - Owned record identity.
 * @returns Connecting or failed observed state without changing the desired revision.
 */
async reconnect(request: McpServerRequest): Promise<McpManagementSnapshot>

/**
 * Refresh tools through an initialized managed bridge; never starts a disabled server or calls a tool.
 * @param request - Owned record identity.
 * @param signal - Caller cancellation of the tools/list request.
 * @returns Current status and the newly observed tool descriptors.
 */
async probe(request: McpServerRequest, signal: AbortSignal): Promise<McpManagementSnapshot>
```

Source: [`packages/mcp/mcp-management/src/index.ts`](../../packages/mcp/mcp-management/src/index.ts)

<a id="ctxmcpregistry--mcpregistry"></a>

### `ctx.mcpRegistry` — `McpRegistry`

Root/profile connection catalog; Agent-scoped launchers do not contribute.

```ts cordis-catalog
/**
 * Read immutable rows, stable between changes.
 * @returns the current secret-free observations.
 */
getSnapshot(): readonly McpConnectionSnapshot[]

/**
 * Observe row changes.
 * @param listener - callback without a payload.
 * @returns effect-scoped unsubscribe.
 */
subscribe(listener: () => void): () => void
```

Source: [`packages/mcp/mcp-client/src/registry.ts`](../../packages/mcp/mcp-client/src/registry.ts)
<!-- END GENERATED cordis-surface -->
