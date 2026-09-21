# 执行主机

[English](execution-host.md) | 中文

## 概述

本参考列出 `packages/execution-host` 包族声明的 Cordis API。[Host 身份](../../packages/execution-host/execution-host/README.zh.md)负责进程来源信息。[保存的执行目标](../../packages/execution-host/execution-host-targets/README.zh.md)负责 SSH 别名、带修订号的记录、连接观测、目录选择及其取消生命周期。[worker 协议](../../packages/execution-host/execution-host-worker/README.zh.md)负责初始化、导出的根目录、有界目录检查和确认后的取消。

[执行绑定](../../packages/execution-host/execution-binding/README.zh.md)将 Workspace 和 Session 关联到捕获的本地或 SSH 部署。租约将 provider 选择、目录、权限策略与进程实例保持在同一环境；Session 所有权和持久化仍位于控制端 Host。保存目标的检查就绪不代表执行就绪。托管运行时激活保留显式前驱部署，普通目标编辑则使历史配置失效。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxexecutionbindings--executionbindings"></a>

### `ctx.executionBindings` — `ExecutionBindings`

One controller Host retains Session authority while project effects use captured providers.

```ts cordis-catalog
/**
 * Read a live or durable Session selection without activating an Agent.
 * Admission changes invalidate an observation captured across an await; a published Agent is authoritative.
 * @param sessionId - known Session identity.
 * @param signal - observation cancellation.
 * @returns immutable location; legacy known Sessions are local only while no admission supersedes that observation.
 */
async bindingForSession(sessionId: SessionId, signal?: AbortSignal): Promise<ExecutionBinding>

/**
 * Retain the same execution incarnation as the live Agent, or acquire its durable binding.
 * Admission changes invalidate every awaited cold result before it can fall back to local execution.
 * @param sessionId - owning Session identity.
 * @param signal - caller cancellation before lease delivery.
 * @returns caller-owned lease; never creates or drives an Agent.
 */
async forSession(sessionId: SessionId, signal?: AbortSignal): Promise<ExecutionLease>

/**
 * Capture paired providers and canonicalize a directory in that execution world.
 * @param binding - selected immutable deployment.
 * @param cwd - absolute directory in that deployment.
 * @param signal - caller cancellation before lease delivery.
 * @returns caller-owned lease retained through any spawned work.
 */
acquire(binding: ExecutionBinding, cwd: string, signal?: AbortSignal): Promise<ExecutionLease>

/**
 * Bind an unpublished Agent before its consumers mount and reserve target authorization through publication.
 * @param agentCtx - creation-owned scoped context.
 * @param agent - unpublished Agent and its durable Session.
 * @param binding - explicit selection for a new Session; omitted reuses its log.
 * @returns synchronous publication commit; scope rollback releases the authorization and provider lease.
 */
async setup(agentCtx: Context, agent: Agent, binding?: ExecutionBinding): Promise<AgentSetupCommit>

/**
 * Address the providers installed during this exact Agent admission.
 * @param agent - prepared or published Agent.
 * @returns provider context, execution platform and immutable selection.
 */
executionForAgent(agent: Agent): Pick<ExecutionLease, 'ctx' | 'platform' | 'binding'>
```

Types: [Agent](core.zh.md) · [AgentSetupCommit](../../packages/core/agent/README.zh.md) · [ExecutionBinding](../../packages/execution-host/execution-binding/README.zh.md) · [ExecutionLease](../../packages/execution-host/execution-binding/README.zh.md) · [SessionId](core.zh.md)

Source: [`packages/execution-host/execution-binding/src/index.ts`](../../packages/execution-host/execution-binding/src/index.ts)

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
 * Save an inspection alias and optional SSH execution deployment; private key contents stay outside this domain.
 * @param request User-provided label, concrete alias and optional execution configuration.
 * @returns the durable target, initially disconnected.
 */
create(request: CreateTargetRequest): Promise<TargetValue>

/**
 * Disconnect before atomically replacing editable metadata at its current revision.
 * Every ordinary edit invalidates all retained execution revisions, including credential and trust rotations.
 * @param request Exact saved revision and replacement metadata; omitting execution removes its configuration.
 * @returns the durable replacement record.
 * @throws `conflict` while Agent admission reserves this target; retry after reservation release.
 */
update(request: UpdateTargetRequest): Promise<TargetValue>

/**
 * Activate a verified runtime deployment at an exact saved revision without disconnecting live operations.
 * Preserve predecessor execution configurations for exact historical Session resume.
 * @param request Current target revision used by the verified installation.
 * @param execution Complete verified deployment, including both bootstrap fields.
 * @param signal Installation lifetime; cancellation before queued persistence starts rejects activation.
 * @returns the committed target at revision + 1; stale requests reject without changing selection or history.
 */
activateExecution(request: TargetRevisionRequest, execution: SshExecutionConfiguration, signal?: AbortSignal): Promise<TargetValue>

/**
 * Capture an immutable deployment identity without reading credentials or opening a connection.
 * @param request Exact saved target revision to capture.
 * @returns a deeply frozen snapshot without the private key path; incomplete deployments throw incompatible.
 */
snapshotExecution(request: TargetRevisionRequest): SshExecutionSnapshot

/**
 * Resolve a binding against its exact current or explicitly retained runtime activation revision.
 * Ordinary target edits and removal invalidate all retained revisions.
 * @param snapshot Captured SSH deployment identity, validated as durable input.
 * @returns an independent SSH configuration with that revision's privateKeyFile; deleted, unretained or altered bindings throw conflict.
 */
resolveExecution(snapshot: SshExecutionSnapshot): SshConfig

/**
 * Reserve authorization for one captured deployment through a synchronous publication commit.
 * Ordinary edits and removal reject while held; an already-started invalidating mutation rejects reservation.
 * Runtime activation remains compatible because it explicitly retains the authorized predecessor revision.
 * @param snapshot Captured SSH deployment identity, validated before reservation.
 * @returns caller-owned synchronous authorization; release on publication commit or rollback.
 * @throws `conflict` when an ordinary target edit or removal already owns mutation admission.
 */
reserveExecution(snapshot: SshExecutionSnapshot): ExecutionAuthorization

/**
 * Remove a saved target after its active operations have settled.
 * @param request Exact saved revision to remove.
 * @returns acknowledgement after durable deletion.
 * @throws `conflict` while Agent admission reserves this target; retry after reservation release.
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

Types: [ExecutionAuthorization](../../packages/execution-host/execution-host-targets/README.zh.md) · [SshConfig](../../packages/ssh/ssh/README.zh.md) · [SshExecutionConfiguration](../../packages/execution-host/execution-host-targets/README.zh.md) · [SshExecutionSnapshot](../../packages/execution-host/execution-host-targets/README.zh.md)

Source: [`packages/execution-host/execution-host-targets/src/index.ts`](../../packages/execution-host/execution-host-targets/src/index.ts)

<a id="ctxexecutionruntimes--executionruntimes"></a>

### `ctx.executionRuntimes` — `ExecutionRuntimes`

One controller Host owns provisioning; observers never own its cancellation.

```ts cordis-catalog
/**
 * Check the shipped generation through a pinned SSH identity and explicit remote Node.
 * @param request - Deployment coordinates; no ambient credentials are used.
 * @param signal - Cancels this read-only observation.
 * @returns Missing or fully verified installed generation and actual Node information.
 */
detect(request: RuntimeLocation, signal?: AbortSignal): Promise<RuntimeInspection>

/**
 * Capture an explicit installation as a Host-owned task and return immediately.
 * @param request - Exact target revision and deployment coordinates.
 * @returns Redacted task receipt; closing a Client does not cancel it.
 */
start(request: RuntimeStartRequest): RuntimeTaskValue

/**
 * Read a retained task without extending its execution authority.
 * @param request - Exact Host-issued task identity.
 * @returns Redacted immutable snapshot.
 */
get(request: RuntimeTaskRequest): RuntimeTaskValue

/**
 * Read the bounded task inventory retained by this Host process for reconnecting Clients.
 * @returns Redacted task snapshots.
 */
listTasks(): RuntimeTasksValue

/**
 * Observe a task; observer cancellation only detaches this stream.
 * @param request - Exact Host-issued task identity.
 * @param signal - Read-only subscription lifetime.
 * @returns Initial and settled task observations.
 */
async *follow(request: RuntimeTaskRequest, signal?: AbortSignal): AsyncGenerator<RuntimeTaskValue, void>

/**
 * Cancel only the specified Host task and await its publication/cleanup outcome.
 * @param request - Exact Host-issued task identity.
 * @returns Settled outcome; an already committed activation remains succeeded.
 */
async cancel(request: RuntimeTaskRequest): Promise<RuntimeTaskValue>
```

Types: [RuntimeInspection](../../packages/execution-host/execution-runtime/README.zh.md) · [RuntimeLocation](../../packages/execution-host/execution-runtime/README.zh.md) · [RuntimeStartRequest](../../packages/execution-host/execution-runtime/README.zh.md) · [RuntimeTaskRequest](../../packages/execution-host/execution-runtime/README.zh.md) · [RuntimeTaskValue](../../packages/execution-host/execution-runtime/README.zh.md) · [RuntimeTasksValue](../../packages/execution-host/execution-runtime/README.zh.md)

Source: [`packages/execution-host/execution-runtime/src/index.ts`](../../packages/execution-host/execution-runtime/src/index.ts)

<a id="execution-host-targets-events"></a>

### `execution-host-targets/*` events

<a id="execution-host-targetschanged--emit"></a>

#### `execution-host-targets/changed` — emit

Saved records or one live connection observation changed after its commit. Listener failures are logged and cannot alter the committed operation or starve later listeners.

```ts cordis-catalog
/**
 * Saved records or one live connection observation changed after its commit.
 * Listener failures are logged and cannot alter the committed operation or starve later listeners.
 * @mode emit
 */
'execution-host-targets/changed'(): void
```

Source: [`packages/execution-host/execution-host-targets/src/index.ts`](../../packages/execution-host/execution-host-targets/src/index.ts)
<!-- END GENERATED cordis-surface -->
