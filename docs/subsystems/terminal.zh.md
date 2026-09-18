# 持久 PTY 会话

[English](terminal.md) | 中文

PTY 后端、`ctx.terminals` 与面向模型的消费方共享的类型。[持久 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.zh.md) 负责记录决策依据；本页记录来自 [`packages/terminal/terminal/src/types.ts`](../../packages/terminal/terminal/src/types.ts) 的跨包词汇。

## 标识与就绪

`TerminalSessionId` 是由服务铸造的branded id。可选名称是拥有者本地的显示元数据；授权比较的是拥有该会话的确切 `Agent`，而不是名称或猜测的 id。

`TerminalWaitReason` 说明一次发送为何返回。它与 `TerminalSessionStatus` 无关：一次发送可能因静默或超时而返回，但顶层 shell 仍然存活；`session_exit` 表示该 shell 已退出，而不是某个任意的前台子进程已退出。

```ts type-equiv
/** Why one interactive send returned control to its caller. */
type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
```

```ts type-equiv
/** Top-level PTY process status, independent of a send's wait reason. */
type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }
```

## 后端与活跃会话

后端负责启动某种已注册类型的会话并检测其就绪状态。`TerminalSessionService` 只在初始化成功后才发布返回的会话，随后负责 id 授权与清理。无法清理部分启动资源时，后端会以 `TerminalBackendCleanupError` 拒绝启动；这样，资源释放流程既能保留清理失败，也不会用它替换调用方的取消原因。后端会话拥有终端状态，并负责让已捕获的资源完全停稳。

```ts type-equiv
/** Replaceable provider for one PTY session type. */
interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
```

```ts type-equiv
/** Backend-owned live session retained by {@link TerminalSessionService}. */
interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Start one exclusive send operation. */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: TerminalReadRequest): TerminalReadResult
  /** Signal the verified foreground process group. */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}
```

## 发送与保留输出

一个活跃会话同时只接受一个活动发送。该操作向通用后台任务提供读取后即推进的输出游标，并向前台调用方提供最终结果。`TerminalReadResult` 则为有界的会话 scrollback 单独分页。

```ts type-equiv
/** Live backend-owned send; exactly one may be active per PTY session. */
interface TerminalSendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  done: Promise<TerminalSendResult>
  /** Consume output produced since the prior call. */
  readOutput(): TerminalSendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  cancel(): boolean
}
```

```ts type-equiv
/** Settled result for one foreground or background send. */
interface TerminalSendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  sessionStatus: TerminalSessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  truncated: boolean
}
```

## 归属与持久性

`TerminalSessionService` 会将一项等待完成的清理附加到确切的拥有者作用域，拒绝其他拥有者的操作，并让会话在后端或工具插件重载期间保持存活。PTY 状态与原始字节仍局限在进程内。模型输入与有界返回输出通过现有 `tool/call`、`tool/result` 和任务结果路径持久保存，而不是重复记录 PTY 会话事件。

## 侧边栏终端连接

`ctx.sidebarTerminals` 通过 `SidebarTerminals` 将 UI 标签页和 agent（智能体）终端连接到渲染器。适用于浏览器的值声明在 [`sidebar-terminals/src/types.ts`](../../packages/terminal/sidebar-terminals/src/types.ts) 中；[服务定义](../../packages/terminal/sidebar-terminals/src/index.ts) 负责操作约定，[包参考](../../packages/terminal/sidebar-terminals/README.zh.md) 负责提供方生命周期与浮动窗口目录策略。

| 标识类型 | 含义 |
|---|---|
| `SidebarTerminalSessionId` | 与 Session 服务使用相同的 `SessionId` 品牌。 |
| `SidebarTerminalTabId` | 由侧边栏存储铸造的持久 UI 标签页标识。 |
| `SidebarAgentTerminalId` | agent 终端注册表标识，独立于 UI 标签页。 |
| `SidebarTerminalAttachmentId` | 服务端签发的、连接到某个进程代次的一次连接标识。 |
| `SidebarTerminalProcessId` | 服务端签发的原生进程标识，在连接重建后保持不变。 |
| `FloatingWorkspaceWindowId` | 一个浮动应用窗口的已校验 UUID。 |

`SidebarTerminalTarget` 选择两类目标之一：UI 终端携带 `kind: 'ui'`、`sessionId`、`tabId` 和可选的 `floating`；agent 终端携带 `kind: 'agent'` 和 `uuid`。`SidebarTerminalOpenRequest` 为一次实际连接捕获该目标以及初始 `cols` 和 `rows`。

`SidebarFloatingTerminalDirectory` 在创建浮动 UI 标签页时捕获 `windowId` 和 `directory`。`FloatingWorkspaceTerminalContext` 始终携带 `windowId`；只有 `status: 'ready'` 携带目录，`loading` 和 `unavailable` 则不携带。`ctx.floatingWorkspaceContext()` 返回此上下文或 `undefined`；`ctx.floatingTerminalConsumer` 标记表示一个消费方。这两项贡献本身都不会创建 Host 终端。

`SidebarTerminalCapability` 返回 `status: 'available'` 及 `shellName`，或 `status: 'unavailable'` 及 `reason: 'missing-dependencies'`。读取能力不会启动 shell，也不能证明已配置的 shell 能够启动。

### 输出与控制

`SidebarTerminalFrame` 是有界的流值。每个变体都携带 `attachmentId`；只有数据帧携带用于渲染器确认的序号。

| `type` | 额外字段 | 含义 |
|---|---|---|
| `ready` | `processId`、`pid`、`cwd`、`shellName` | 所捕获进程的初始元数据。 |
| `data` | `sequence`、`data` | 终端文本；在渲染并确认之前持续占用输出额度。 |
| `exit` | `exitCode` | 已连接进程退出。 |

| 请求类型 | 字段 | 语义 |
|---|---|---|
| `SidebarTerminalInputRequest` | `attachmentId`、`data` | 向有效连接写入；已分离的代次不能写入。 |
| `SidebarTerminalResizeRequest` | `attachmentId`、`cols`、`rows` | 更新既有连接的显示尺寸。 |
| `SidebarTerminalAckRequest` | `attachmentId`、`sequence` | 确认渲染器已消费的最高数据帧序号。 |
| `SidebarTerminalReleaseRequest` | `attachmentId`、`mode` | `disconnect` 允许配置的重连宽限期；`park` 保留隐藏的 UI 终端；`close` 终止其 UI 进程。 |
| `SidebarTerminalUiTarget` | `sessionId`、`tabId` | 检查既有 UI 进程，不会启动进程或延长其生命周期。 |
| `SidebarTerminalCloseUiRequest` | `sessionId`、`tabId`、`processId` | 关闭先前观察到的原生进程，包括在断连期间；替代代次会被拒绝，不存在的进程视为已经关闭。 |

`SidebarAgentTerminalSnapshot` 包含 `uuid`、`title`、`command`、`exited`，以及可选且可为 null 的 `exitCode` 和 `exitSignal`。观察某个 Session 会返回其当前 agent 终端列表及后续更新。关闭 agent 终端使用其注册表标识。

`SidebarTerminalError` 携带供传输载体本地化的 `SidebarTerminalErrorCode`：`invalid-request`、`invalid-directory`、`unavailable`、`not-found`、`stale-attachment`、`output-overflow` 或 `ack-timeout`。连接 id 不能授权操作替代进程；渲染器停滞时可能持续占用输出额度，直到其连接超时。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsidebarterminals--sidebarterminals-abstract-seam"></a>

### `ctx.sidebarTerminals` — `SidebarTerminals` (abstract seam)

Sidebar PTY ownership; the provider reuses the UI and agent terminal managers.

```ts cordis-catalog
/** Read native availability without spawning a shell.
 * @returns Current availability.
 */
abstract capability(): SidebarTerminalCapability

/** Attach to a process and observe its output.
 * @param request - immutable target and initial geometry.
 * @param signal - attachment lifetime.
 * @returns bounded terminal frames until exit or release.
 */
abstract open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame>

/** Write input to the attached process.
 * @param request - input for a live attachment.
 */
abstract input(request: SidebarTerminalInputRequest): void

/** Resize the attached process display.
 * @param request - updated display geometry.
 */
abstract resize(request: SidebarTerminalResizeRequest): void

/** Acknowledge output after the renderer consumes it.
 * @param request - highest data sequence rendered by xterm.
 */
abstract ack(request: SidebarTerminalAckRequest): void

/** Release a view of its captured process.
 * @param request - disposition for this attachment's process generation.
 */
abstract release(request: SidebarTerminalReleaseRequest): void

/** Observe an existing UI process without spawning or extending its lifetime.
 * @param request - existing UI tab.
 * @returns its native process identity, or null; never spawns or extends its lifetime.
 */
abstract inspectUi(request: SidebarTerminalUiTarget): SidebarTerminalProcessId | null

/** Request termination of an observed UI process and reject replacement generations.
 * @param request - exact observed native generation; missing processes are already closed, replacements are rejected.
 */
abstract closeUi(request: SidebarTerminalCloseUiRequest): void

/** Observe the agent terminals owned by a Session.
 * @param sessionId - owning Session.
 * @param signal - consumer lifetime.
 * @returns current agent terminal list and later updates.
 */
abstract watch(sessionId: SidebarTerminalSessionId, signal: AbortSignal): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]>

/** Request termination of an agent terminal.
 * @param uuid - agent-owned terminal explicitly closed by its user.
 */
abstract closeAgent(uuid: SidebarAgentTerminalId): void
```

Source: [`packages/terminal/sidebar-terminals/src/index.ts`](../../packages/terminal/sidebar-terminals/src/index.ts)

<a id="ctxterminals--terminalsessionservice"></a>

### `ctx.terminals` — `TerminalSessionService`

In-process registry for replaceable PTY backends and exact-Agent sessions.

```ts cordis-catalog
/**
 * Register one backend type for this effect scope.
 * @param backend - provider with a non-empty unique type.
 * @returns disposer that removes exactly this contribution.
 */
registerBackend(backend: TerminalBackend): () => void

/**
 * List registered backend types in registration order.
 * @returns fresh backend type names.
 */
listBackends(): string[]

/**
 * Create and publish one owner-scoped session after backend setup succeeds.
 * @param owner - exact registered Agent that owns access and cleanup.
 * @param request - backend type plus optional owner-local name and cwd.
 * @param signal - cancellation of unpublished setup.
 * @returns published identity, metadata, status, and MOTD.
 */
async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult>

/**
 * Test whether an exact owner has a published session or unpublished spawn.
 * @param owner - exact live owner to inspect.
 * @returns true across the entire spawn-to-close interval, with no publication gap.
 */
hasOwnerActivity(owner: Agent): boolean

/**
 * Start one exclusive interactive send.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - explicit text, submit behavior, and cancellation.
 * @returns live operation handle for foreground await or task registration.
 */
startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation

/**
 * Read one bounded scrollback page from an owned session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - optional newest-relative offset and line count.
 * @returns bounded retained text and pagination metadata.
 */
read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult

/**
 * Deliver an allowed signal through an owned backend session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param signal - allowed POSIX signal name.
 * @returns delivered foreground process-group identity.
 */
signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>

/**
 * Close one owned session and remove it only after quiescent backend cleanup.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param reason - diagnostic cleanup reason.
 * @returns true for a newly closed session, false when the same close is already in flight.
 */
async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean>

/**
 * List fresh snapshots for exactly one owner.
 * @param owner - exact owner whose sessions are visible.
 * @returns owner-visible snapshots in publication order.
 */
list(owner: Agent): TerminalSessionSnapshot[]
```

Types: [Agent](core.zh.md)

Source: [`packages/terminal/terminal/src/index.ts`](../../packages/terminal/terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
