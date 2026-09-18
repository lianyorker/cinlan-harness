# Execution hosts

English | [中文](execution-host.zh.md)

## Summary

This reference lists the Cordis API declared by the `packages/execution-host` group. [Host identity](../../packages/execution-host/execution-host/README.md) owns process provenance. [Saved execution targets](../../packages/execution-host/execution-host-targets/README.md) owns SSH aliases, revisioned records, connection observations, directory selection, and their cancellation lifetimes. The [worker protocol](../../packages/execution-host/execution-host-worker/README.md) owns initialization, exported roots, bounded directory inspection, and acknowledged cancellation.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxexecutionhost--executionhostservice-abstract-seam"></a>

### `ctx.executionHost` — `ExecutionHostService` (abstract seam)

Execution host identity service: provides stable host identity for artifact provenance and assessment authorization.

```ts cordis-catalog
/**
 * Get the current execution host identity.
 * @returns current host metadata.
 */
abstract current(): ExecutionHostInfo
```

Source: [`packages/execution-host/execution-host/src/index.ts`](../../packages/execution-host/execution-host/src/index.ts)

<a id="ctxexecutionhosttargets--executionhosttargets"></a>

### `ctx.executionHostTargets` — `ExecutionHostTargets`

Concrete saved-target registry and OpenSSH connector for the management UI.

```ts cordis-catalog
/**
 * Read saved targets with current local process provenance and transient observations.
 * @returns the complete management snapshot.
 */
list(): ListTargetsValue

/**
 * Save an OpenSSH alias; credential values remain outside this domain.
 * @param request User-provided label and concrete alias.
 * @returns the durable target, initially disconnected.
 */
create(request: CreateTargetRequest): Promise<TargetValue>

/**
 * Disconnect before atomically replacing editable metadata at its current revision.
 * @param request Exact saved revision and replacement label/alias.
 * @returns the durable replacement record.
 */
update(request: UpdateTargetRequest): Promise<TargetValue>

/**
 * Remove a saved target after its active operations have settled.
 * @param request Exact saved revision to remove.
 * @returns acknowledgement after durable deletion.
 */
remove(request: TargetRevisionRequest): Promise<Record<string, never>>

/**
 * Authenticate, negotiate and perform an actual exported-root inspection before publishing readiness.
 * @param request Exact saved revision used to connect.
 * @param signal Cancellation before connection publication.
 * @returns a generation-bound ready target or a typed operational refusal.
 */
connect(request: TargetRevisionRequest, signal?: AbortSignal): Promise<TargetValue>

/**
 * Disconnect and await remote inspection cancellation acknowledgement.
 * @param request Exact saved target.
 * @returns the disconnected saved target.
 */
disconnect(request: TargetRequest): Promise<TargetValue>

/**
 * Inspect only an advertised remote root on the supplied connection generation.
 * @param request Target, generation and worker-owned relative path.
 * @param signal Cancellation propagated to the remote operation.
 * @returns target provenance and the bounded remote directory result.
 */
inspectDirectory(request: InspectDirectoryRequest, signal?: AbortSignal): Promise<InspectionValue>
```

Source: [`packages/execution-host/execution-host-targets/src/index.ts`](../../packages/execution-host/execution-host-targets/src/index.ts)

<a id="execution-host-targets-events"></a>

### `execution-host-targets/*` events

<a id="execution-host-targetschanged--emit"></a>

#### `execution-host-targets/changed` — emit

Saved records or one live connection observation changed after its commit.

```ts cordis-catalog
/**
 * Saved records or one live connection observation changed after its commit.
 * @mode emit
 */
'execution-host-targets/changed'(): void
```

Source: [`packages/execution-host/execution-host-targets/src/index.ts`](../../packages/execution-host/execution-host-targets/src/index.ts)
<!-- END GENERATED cordis-surface -->
