# Typert 远程调用

[English](typert.md) | 中文

以下类型由生成的 Remote 产物、Host Gateway 与消费方 API assembly 共用。[Typert Gateway Agent Note](../../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md) 负责架构与传输决策；本页记录 [`dsh-typert-protocol`](../../packages/typert/protocol/src/types.ts) 和 [`dsh-api-gateway`](../../packages/api/gateway/src/types.ts) 中公共约定的字面定义。

## Lookup 与上下文声明

业务对象包通过声明合并扩展两个空 map。lookup 将一种 Host 对象类型与其 wire identity 关联；上下文声明将一种作用域上下文类别与其 wire identity 关联。生成的 descriptor 引用这些 key，运行时提供方则提供活对象解析行为。

```ts type-equiv
/** Merge-extensible Host object lookup declarations. */
interface TypertLookupMap {}
```

```ts type-equiv
/** Merge-extensible scoped Context declarations. */
interface TypertContextMap {}
```

lookup 的 resolver 卸载后，注册表仍会保留其 wire 声明。因此 SRC 发现过程会继续把该参数归类为 lookup，并因不可用而失败，而不会把 wire 值当作普通业务对象接受。

```ts type-equiv
/** Stable wire declaration retained after a lookup provider unloads. */
interface TypertLookupDefinition {
  /** Merge-declared lookup key. */
  readonly key: string
  /** Source parameter name recognized by the SRC weak parser. */
  readonly parameter: string
  /** Wire field replacing the Host object parameter. */
  readonly wire: string
  /** Canonical Host type symbol used by strict generation. */
  readonly hostTypeSymbol: string
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string
}
```

## 调用 descriptor

`InvocationDescriptor` 是本地反射信息，不是 wire message。Host 与消费方构建会生成彼此对应的 descriptor；请求只发送 endpoint 与具名 `args`。strict codec 携带生成的 schema，SRC codec 则在不恢复结构类型的前提下强制要求 JSON 安全值。取消通过带外 carrier signal 表达：它在业务参数之后注入，绝不进入 `args`。

```ts type-equiv
/** Codec attached to one invocation parameter or result. */
type TypertCodec =
  | {
    readonly mode: 'strict'
    readonly typeSymbol: string
    readonly schema: TypertSchema
  }
  | {
    readonly mode: 'src-json'
  }
```

```ts type-equiv
/** One ordered business parameter in a Remote invocation. */
interface InvocationParameterDescriptor {
  /** Source-level parameter name. */
  readonly name: string
  /** Required key in the wire `args` object. */
  readonly wire: string
  /** Whether the value is JSON or requires a registered Host lookup. */
  readonly source: 'json' | 'lookup'
  /** Lookup key when `source` is `lookup`. */
  readonly lookup?: string
  /** Boundary codec for the wire representation. */
  readonly codec: TypertCodec
  /** Missing wire fields decode to `undefined` only for an explicitly declared `T | undefined`. */
  readonly acceptsUndefined?: true
}
```

```ts type-equiv
/** Carrier-independent description of one exported method invocation. */
interface InvocationDescriptor {
  /** Globally stable generated identity. */
  readonly id: string
  /** Cordis service key owning the method. */
  readonly service: string
  /** Wire namespace, defaulting to the service key. */
  readonly namespace: string
  /** Public instance method name. */
  readonly method: string
  /** Service member invoked when the exported method name is an alias. */
  readonly implementation?: string
  /** Absent for unary calls; stream calls validate and deliver every yielded item. */
  readonly mode?: 'stream'
  /** Receiver selection mode. */
  readonly invocation:
    | { readonly kind: 'direct' }
    | {
      readonly kind: 'context'
      readonly context: string
      readonly wire: string
      readonly codec: TypertCodec
    }
  /** Optional consuming-Context projection for one direct lookup parameter. */
  readonly scope?: {
    /** Context kind whose Client adapter supplies the identity. */
    readonly context: string
    /** Lookup parameter wire field replaced by the Context identity. */
    readonly wire: string
  }
  /** Ordered business parameters. */
  readonly parameters: readonly InvocationParameterDescriptor[]
  /** Transport cancellation injected after business parameters instead of entering wire args. */
  readonly cancellation?: {
    /** Reserved final Host method parameter. */
    readonly parameter: 'signal'
  }
  /** Codec for the unary result or each yielded stream item. */
  readonly result: TypertCodec
  /** Source declaration used only for diagnostics. */
  readonly sourceLocation?: InvocationSourceLocation
}
```

## Typert 注册表

`ctx.typert` 分开保存当前环境的 descriptor、显式选择的 Remote contribution、lookup 提供方与作用域上下文提供方。lookup 提供方拥有稳定 wire 声明和默认 resolver；Host 组合可以为同一个 key 配置 effect-scoped 同步或异步 resolver，配置卸载后恢复默认策略。各项注册都是由 Cordis 持有的 effect，并返回可等待的 disposer。

```ts type-equiv
/** Minimal Typert runtime consumed through dependency inversion. */
interface TypertRegistryContract {
  readonly local: TypertLocalRegistry
  readonly remotes: TypertRemoteRegistry
  readonly lookups: TypertLookupRegistry
  readonly contexts: TypertContextRegistry
}
```

生成的消费方声明会把 direct namespace 合并到 `TypertClientRemote` 继承的 map 中。

```ts type-equiv
/** Merge-extensible direct namespace surface generated for Client Remote services. */
interface TypertRemoteNamespaceMap {}
```

## Host Gateway

Connection 会先解码 carrier envelope，再调用 `ctx.typertGateway`。请求将精确的具名 wire 字段与 carrier 的取消 signal 分开携带；基础设施与边界失败由 `TypertGatewayError` 承载，其 `gateway/*` 码就是普通的 `RemoteError` 码，因此 RPC 适配器会把每个经结构识别的 `RemoteError` 连同其 code 与 details 原样放行，只把无法识别的异常归并为 `gateway/internal`。

```ts type-equiv
/** One Remote method request after a carrier has decoded its envelope. */
interface InvokeRemoteRequest {
  /** Remote namespace selected by the generated descriptor. */
  readonly namespace: string
  /** Exported Service method name. */
  readonly method: string
  /** Named wire values; fields must exactly match the descriptor. */
  readonly args: Readonly<Record<string, unknown>>
  /** Carrier or direct-caller cancellation injected only into cancellation-aware methods. */
  readonly signal?: AbortSignal
}
```

```ts type-equiv
/** Stable infrastructure and boundary failures emitted before or after business execution. */
type TypertGatewayErrorCode =
  | 'gateway/ambiguous-endpoint'
  | 'gateway/arguments-invalid'
  | 'gateway/binding-invalid'
  | 'gateway/context-failed'
  | 'gateway/context-not-found'
  | 'gateway/context-unavailable'
  | 'gateway/definition-unavailable'
  | 'gateway/input-invalid'
  | 'gateway/invocation-unavailable'
  | 'gateway/lookup-failed'
  | 'gateway/lookup-not-found'
  | 'gateway/lookup-unavailable'
  | 'gateway/method-unavailable'
  | 'gateway/provider-mismatch'
  | 'gateway/result-invalid'
  | 'gateway/service-unavailable'
  | 'gateway/signature-invalid'
```

```ts type-equiv
/** Host dispatcher consumed by Connection adapters. */
interface TypertGateway {
  /** Carrier adapter shared by WebSocket and in-process transports. */
  readonly wireStream: TypertGatewayWireStream
  /**
   * Register the application-selected forwarded-event source.
   * @param source - stream factory installed by the Remote assembly.
   * @param host - stable Host facts included in each Client generation's opening frame.
   * @returns disposer removing this exact source and cancelling its active streams.
   */
  registerRemoteEvents(
    source: TypertRemoteEventSource,
    host: RemoteEventHostInfo,
  ): () => Promise<void>
  /**
   * Invoke one live Remote method without assuming a carrier or response envelope.
   * @param request - decoded endpoint and named wire arguments.
   * @returns the business result without output decoding.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  invoke(request: InvokeRemoteRequest): Promise<unknown>
  /**
   * Open one live stream Remote method without assuming a physical carrier.
   * @param request - decoded endpoint and named wire arguments.
   * @returns a cancellation-aware iterable over the business results.
   */
  stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>
}
```

## 消费方 Remote

`ctx.remote` 只暴露由已导入 `/remote` 产物贡献的 namespace。`$mount()` 会把生成的 descriptor 与具体方法作为一项由 fiber 持有的操作统一注册。每个 namespace 都是可追踪的 `remote.<namespace>` Cordis 子服务，其生命周期覆盖已挂载的方法；JavaScript Proxy 与 Host 业务服务类型都不会进入消费方。

```ts type-equiv
/** Client Remote capability implemented by the Gateway and consumed by Remote assemblies. */
interface TypertClientRemote extends TypertRemoteNamespaceMap {
  /**
   * Mount one generated Host-for-Client contribution in the caller's fiber.
   * @param contribution - explicitly selected Remote package artifact.
   * @returns disposer after namespace services and concrete methods are ready.
   */
  $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>
  /**
   * Subscribe to one forwarded Host event. Notifications run in registration
   * order and isolate failures; scoped waterfalls return, delegate through
   * `next()`, or reject the Host dispatch.
   * @template Event - forwarded event name selected by the Host assembly.
   * @param event - forwarded Host event name, unchanged on the wire.
   * @param listener - receives the Client projection of the Cordis `Events` declaration.
   * @returns disposer owned by the calling fiber.
   */
  $on<Event extends TypertRemoteEvent>(event: Event, listener: TypertClientEventListener<Event>): () => void
}
```

## 原生控制器请求与结果

以下 JSON 记录由 `packages/api` 控制器包声明。这些控制器负责相应的 wire 投影；导入的 Automation、Browser、Git、MCP、Terminal、Voice 与 Workspace 能力类型仍由其声明包负责。

### Automation

源码：[automation-controller/types](../../packages/api/automation-controller/src/types.ts)。运行时定义与调用记录见 [Automation](automation.zh.md)。

| 类型 | 字段与语义 |
|---|---|
| `AutomationCancelRequest` | `runId` 标识已准入的调用；取消调用不会删除其周期定义。 |
| `AutomationRunsRequest` | 定义 `id`、可空 `cursor` 和 `limit` 选择按时间倒序排列的有界日志页。 |
| `AutomationPreviewRequest` | `schedule` 与绝对时间 `afterUtc` 选择严格晚于该时刻的五次 UTC 触发时间。 |
| `AutomationFollowFrame` | `baseline` 与 `snapshot` 帧都在 `value` 中携带完整、已提交的 `AutomationSnapshot`。 |
| `AutomationCatalog` | Workspace、Agent 预设、Provider、模型与权限选项，以及已配置的默认值。可用性仅供参考；模型未列出并不禁止显式路由。 |

### Browser

源码：[browser-controller/types](../../packages/api/browser-controller/src/types.ts)。[Browser Service Definition](../../packages/browser/browser/README.zh.md)负责 Provider 请求、页面身份、观测与传输。

| 类型 | 字段与语义 |
|---|---|
| `BrowserProfileValue`, `BrowserPagesValue` | 当前 `profileName`；页面列表还含 `pages` 与 `maxFileBytes`，不公开 profile 文件系统路径。 |
| `BrowserPageRequest`, `BrowserOpenValue` | 既有或新打开的原生 `pageId`。 |
| `BrowserElementSelectionValue` | Provider 校验的人类选择，携带请求页面的一次性身份；取消会中止选择器。 |
| `BrowserElementCaptureCommand` | `pageId` 与 `selectionId` 消耗该选择，捕获其当前可见边界。 |
| `BrowserElementCaptureValue` | 同一页面与选择 id、`verified: true`、已保存的 `image` 引用及其规范化 base64 `data`，用于预览和显式接纳到草稿。 |
| `BrowserHistoryValue`, `BrowserNetworkValue` | `entries` 携带页面访问或网络元数据；网络投影不含请求头或正文。 |
| `BrowserObservationValue` | 当前 `observation` 为显式文件输入控件选择提供新鲜的元素身份。 |
| `BrowserImportCookiesRequest`, `BrowserImportCookiesValue` | 人类显式导入提供预期 `profileName` 与 cookie `json`；回执返回 `imported` 数量及 profile，不回传输入内容。 |
| `BrowserFileUploadRequest`, `BrowserFileUploadValue` | 页面、观测、元素、文件名和有界 `base64` 选定文件输入控件；回执报告已接收的 `bytes`。页面处理函数随后可能提交这些字节。 |
| `BrowserDownloadsValue` | `items` 与 `truncated` 描述页面保持打开期间保留的已捕获传输。 |
| `BrowserDownloadRequest`, `BrowserDownloadValue` | 页面拥有的 `downloadId` 选择有界读取；结果携带供人类保存的 `name`、`base64` 与精确 `bytes`。 |

### 就绪状态与研究

源码：[device-capabilities-controller/types](../../packages/api/device-capabilities-controller/src/types.ts)、[integration-preflight-controller/types](../../packages/api/integration-preflight-controller/src/types.ts)和 [security-research-controller/types](../../packages/api/security-research-controller/src/types.ts)。

| 类型 | 字段与语义 |
|---|---|
| `DeviceCapabilityRequest`, `DeviceCapabilitySnapshot` | `capability` 选择 `computer` 或 `mobile`；结果区分 `not-configured`、`available` 与 `unavailable`，附带脱敏的可空 `reason`。它不授予动作权限。 |
| `MobileSdkSnapshot` | Host `platform`、Android SDK 检测与可选 iOS Simulator 检测；SDK 可用性独立于已连接设备的可用性。 |
| `MobileDeviceListSnapshot` | `devices` 提供选择器身份、名称、状态与逐设备可用性；`available` 汇总列表。 |
| `IntegrationPreflightRequest`, `IntegrationPreflightSnapshot` | 选择 `github`、`gitlab` 或 `gitee`；返回 Provider、连接 `status`、可空的脱敏 `reason` 与可选账户提示。令牌和命令诊断保持私有。 |
| `SecurityResearchSnapshot` | 总体 `status`、预设可见性、根作用域有效性与计数、组件存在性及技能完整性。状态投影不含作用域目标或凭证值。 |
| `SecurityResearchReportRequest`, `SecurityResearchReportValue` | live `sessionId` 与 `json`／`markdown`／`sarif` 格式选择报告。结果携带文件名、媒体类型、精确字节数、base64 和发现数量；它含 Finding 元数据及 Artifact 引用，不含 Artifact 内容。 |

### Terminal 与 Voice

源码：[terminal-controller/types](../../packages/api/terminal-controller/src/types.ts)与 [voice-controller/types](../../packages/api/voice-controller/src/types.ts)。Provider 和后端值仍分别由 [Terminal](terminal.zh.md) 与 [Voice](voice.zh.md)负责。

| 类型 | 字段与语义 |
|---|---|
| `TerminalListRequest`, `TerminalListValue` | `sessionId` 选择所有者；`terminals` 携带脱离运行时的 id、后端类型、可选名称／进程 id，以及运行或退出状态。 |
| `TerminalSpawnValue` | 新终端视图加 `motd`。 |
| `TerminalSendValue` | `viewport`、`waitReason`、`sessionStatus` 与 `truncated` 报告就绪或超时，不把两者当作进程退出。 |
| `TerminalReadValue` | 有界 `text`、`totalLines`、`lineBegin`、`lineEnd` 与 `truncated` 描述回滚缓冲区窗口。 |
| `TerminalSignalRequest`, `TerminalSignalValue` | Session 和终端 id 加允许的信号选定一个进程组；成功返回 `delivered: true` 与 `targetPgid`。 |
| `TerminalKillRequest`, `TerminalKillValue` | Session 与终端 id 选择关闭对象；结果报告 `closed`。 |
| `VoiceModelRequest`, `VoiceModelsRemoveValue` | `modelId` 来自模型列表；成功移除返回空记录。 |
| `api/voice-controller` 中的 `VoiceTranscribeRequest` | `modelId` 加规范的 `pcm16kMonoBase64`：小端、16 kHz 单声道 float32 PCM，解码后最多 16 MiB。该 wire 请求不同于携带已解码采样的 [Voice Service 请求](voice.zh.md)。 |

### Workspace 生命周期投影

源码：[workspace-isolation-controller/types](../../packages/api/workspace-isolation-controller/src/types.ts)与 [worktree-task-controller/types](../../packages/api/worktree-task-controller/src/types.ts)。[Workspace](workspace.zh.md)负责 Provider 租约和任务身份、生命周期及文件系统操作。

| 类型 | 字段与语义 |
|---|---|
| `WorkspaceIsolationLeaseRequest` | 不透明 `leaseId` 寻址 Provider 拥有的租约；调用方不能提供 checkout 路径。 |
| `WorkspaceIsolationListValue`, `WorkspaceIsolationLeaseValue` | 脱离运行时的 `items` 或 `lease` 公开所属 Session、规范来源／checkout 路径、分支／基准／HEAD、阶段、审查状态与时间戳。 |
| `WorkspaceIsolationInspectionValue`, `WorkspaceIsolationComparisonValue` | `inspection` 携带 checkout 状态和当前变更；有界 `comparison` 增加领先／落后数量、提交、变更文件、补丁、截断与已跟踪／未跟踪内容的包含事实。 |
| `WorkspaceIsolationIntegrationValue` | merge 或 cherry-pick 后保留的休眠 `lease`、记录的 `targetBranch` 与结果 `targetHead`。 |
| `WorkspaceIsolationPatchValue` | 租约 id、安全文件名、完整有界补丁 `content`，以及显式的已跟踪／未跟踪内容包含事实。 |
| `WorkspaceIsolationTeardownValue`, `WorkspaceIsolationPruneValue` | teardown 区分 `removed` 与因 `unmerged-branch` 保留的 `review`；prune 报告已移除的孤立 worktree 数量。 |
| `WorktreeTaskCreateRequest` | 名称、Workspace id、来源路径、可选基准引用和可选关联 issue 创建一个任务。 |
| `WorktreeTaskRequest`, `WorktreeTaskCreateValue`, `WorktreeTaskValue` | 不透明 `taskId` 选择生命周期操作；创建与转换返回脱离运行时的 `task` 视图。 |
| `WorktreeTaskListValue` | 完整 `items` 任务视图，携带 workspace、分支／checkout、状态、关联 Session 以及创建／更新时间。 |
| `WorktreeTaskBindSessionRequest`, `WorktreeTaskBindSessionValue` | 任务与 Session id 绑定所有权；结果返回更新后的任务与生效的 `checkoutPath`。 |
| `WorktreeTaskDeleteValue` | `deleted` 携带已删除任务 id；`retained` 还标明安全删除所保留的分支。 |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomationcontroller--automationcontroller"></a>

### `ctx.automationController` — `AutomationController`

Generated Remote owner for the automation namespace.

```ts cordis-catalog
/** Read the committed runtime view.
 * @returns the full state, including explicit unavailability.
 */
@Remote('snapshot') snapshot(): AutomationSnapshot

/** Create a disabled plan.
 * @param draft - explicit draft inputs.
 * @returns the committed disabled definition.
 */
@Remote('create') create(draft: AutomationDraft): Promise<AutomationDefinition>

/** Save a complete revision-fenced replacement.
 * @param update - replacement fenced by the first-edit revision.
 * @returns the committed definition.
 */
@Remote('update') update(update: AutomationUpdate): Promise<AutomationDefinition>

/** Delete a plan while retaining its journal.
 * @param request - target and expected revision; active invocations refuse deletion.
 */
@Remote('delete') delete(request: AutomationDelete): Promise<void>

/** Admit one explicit manual invocation.
 * @param request - target revision and retained idempotency token.
 * @returns the admitted invocation.
 */
@Remote('run') run(request: AutomationRunRequest): Promise<AutomationRun>

/** Cancel an invocation without changing recurrence.
 * @param request - admitted invocation to cancel.
 */
@Remote('cancel') cancel(request: AutomationCancelRequest): Promise<void>

/** Read a bounded journal page.
 * @param request - bounded journal cursor.
 * @returns newest-first committed receipts.
 */
@Remote('runs') runs(request: AutomationRunsRequest): Promise<AutomationRunPage>

/** Preview a UTC schedule without saving it.
 * @param request - UTC schedule and exclusive lower bound.
 * @returns five future UTC timestamps.
 */
@Remote('previewSchedule') previewSchedule(request: AutomationPreviewRequest): Promise<number[]>

/** Read the current Host selector catalog.
 * @returns actual selector metadata; model membership is advisory.
 */
@Remote('catalog') catalog(): Promise<AutomationCatalog>

/** Follow full committed state for one carrier generation.
 * @param signal - carrier cancellation.
 * @returns full committed snapshots with bounded coalescing.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<AutomationFollowFrame>
```

Types: [AutomationDefinition](automation.zh.md) · [AutomationDelete](automation.zh.md) · [AutomationDraft](automation.zh.md) · [AutomationRun](automation.zh.md) · [AutomationRunPage](automation.zh.md) · [AutomationRunRequest](automation.zh.md) · [AutomationSnapshot](automation.zh.md) · [AutomationUpdate](automation.zh.md)

Source: [`packages/api/automation-controller/src/index.ts`](../../packages/api/automation-controller/src/index.ts)

<a id="ctxbrowsercontroller--browsercontroller"></a>

### `ctx.browserController` — `BrowserController`

Authenticated human-facing Browser operations, separate from model tool permissions.

```ts cordis-catalog
/** Read the active profile without launching a browser.
 * @param signal - Caller cancellation.
 * @returns Active profile name.
 */
@Remote('profile') profile(signal: AbortSignal): BrowserProfileValue

/** Launch if needed and list native pages after an explicit UI action.
 * @param signal - Caller cancellation.
 * @returns Current page and profile identities.
 */
@Remote('pages') async pages(signal: AbortSignal): Promise<BrowserPagesValue>

/** Wait for a human to choose an element; cancellation removes the Provider overlay.
 * @param request - Existing native page selected by the caller.
 * @param signal - Caller cancellation, forwarded to the Provider.
 * @returns One-use selection with element identity and visible bounds.
 */
@Remote('selectElement') async selectElement(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserElementSelectionValue>

/** Capture and persist a verified crop without sending a Session message.
 * @param request - Page and one-use selection from selectElement.
 * @param signal - Caller cancellation; cancelled work returns no preview.
 * @returns Digest-verified stored bytes, encoded as base64, and their canonical metadata.
 */
@Remote('captureElement') async captureElement(request: BrowserElementCaptureCommand, signal: AbortSignal): Promise<BrowserElementCaptureValue>

/** Resolve an intent and open it with the active Provider settings.
 * @param request - Home, search, or absolute URL intent.
 * @param signal - Caller cancellation.
 * @returns New page identity.
 */
@Remote('open') async open(request: BrowserNavigationTarget, signal: AbortSignal): Promise<BrowserOpenValue>

/** Read page-local visits; nothing is loaded from another profile.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns At most 100 visits; credentials, queries, and fragments are excluded.
 */
@Remote('history') async history(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserHistoryValue>

/** Read request metadata retained since the page opened.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns At most 100 requests without headers, bodies, or URL query values.
 */
@Remote('network') async network(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserNetworkValue>

/** Observe a page so a human can select a file input.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns Fresh observation and element ids.
 */
@Remote('snapshot') async snapshot(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserObservationValue>

/** Supply explicit file bytes to an observed input, without submitting its form.
 * @param request - Fresh observation ids, basename, and base64 from the chosen file.
 * @param signal - Caller cancellation.
 * @returns Accepted byte count, never file contents.
 */
@Remote('upload') async upload(request: BrowserFileUploadRequest, signal: AbortSignal): Promise<BrowserFileUploadValue>

/** Read page-owned download metadata.
 * @param request - Open page identity.
 * @param signal - Caller cancellation.
 * @returns Retained download ids and states.
 */
@Remote('downloads') async downloads(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserDownloadsValue>

/** Read one bounded completed download for a human save action.
 * @param request - Page and download ids obtained from downloads.
 * @param signal - Caller cancellation.
 * @returns Inert filename and exact file bytes encoded for Remote transport.
 */
@Remote('download') async download(request: BrowserDownloadRequest, signal: AbortSignal): Promise<BrowserDownloadValue>

/** Import an explicit cookie JSON array into the expected active profile.
 * @param request - Active profile name and user-selected file contents.
 * @param signal - Caller cancellation.
 * @returns Accepted count without cookie values; failures also omit values.
 */
@Remote('importCookies') async importCookies(request: BrowserImportCookiesRequest, signal: AbortSignal): Promise<BrowserImportCookiesValue>
```

Source: [`packages/api/browser-controller/src/index.ts`](../../packages/api/browser-controller/src/index.ts)

<a id="ctxdevicecapabilitiescontroller--devicecapabilitiescontroller"></a>

### `ctx.deviceCapabilitiesController` — `DeviceCapabilitiesController`

Probe the selected Provider without exposing desktop content or device identities.

```ts cordis-catalog
/**
 * Check Provider reachability independently from plugin activation.
 * @param request - Device family to check.
 * @param signal - Caller cancellation forwarded to the read-only Provider operation.
 * @returns Readiness and a redacted failure category, never installation or action authorization.
 */
@Remote('check') async check(request: DeviceCapabilityRequest, signal: AbortSignal): Promise<DeviceCapabilitySnapshot>

/**
 * Detect Android SDK and iOS Simulator availability without installing software.
 * @param signal - Caller cancellation.
 * @returns SDK detection results for the mobile emulator settings page.
 */
@Remote('checkSdk') async checkSdk(signal: AbortSignal): Promise<MobileSdkSnapshot>

/**
 * List mobile devices for the default-device selector; redacted to id/name/state/available.
 * @param signal - Caller cancellation forwarded to the Provider.
 * @returns Redacted device list and Provider availability.
 */
@Remote('listMobileDevices') async listMobileDevices(signal: AbortSignal): Promise<MobileDeviceListSnapshot>
```

Source: [`packages/api/device-capabilities-controller/src/index.ts`](../../packages/api/device-capabilities-controller/src/index.ts)

<a id="ctxexecutionhostcontroller--executionhostcontroller"></a>

### `ctx.executionHostController` — `ExecutionHostController`

Remote operations consumed by native execution-host settings.

```ts cordis-catalog
/**
 * Read saved targets and current connection observations.
 * @param signal Carrier cancellation before the read.
 * @returns the complete management snapshot.
 */
@Remote list(signal: AbortSignal): Promise<ListTargetsValue>

/**
 * Subscribe before the initial snapshot and coalesce subsequent observations.
 * @param signal Carrier cancellation; controller disposal also ends the stream.
 * @returns complete snapshots without an unbounded update backlog.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<ListTargetsValue>

/**
 * Persist an OpenSSH alias without connecting.
 * @param request Label and alias; never credentials or flags.
 * @param signal Carrier cancellation before admission.
 * @returns the durable disconnected target.
 */
@Remote create(request: CreateTargetRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Replace saved metadata at its exact revision after disconnecting.
 * @param request Current revision and replacement fields.
 * @param signal Carrier cancellation before admission.
 * @returns the committed target.
 */
@Remote update(request: UpdateTargetRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Remove a target after owned remote work settles.
 * @param request Exact saved revision.
 * @param signal Carrier cancellation before admission.
 * @returns durable deletion acknowledgement.
 */
@Remote removeTarget(request: TargetRevisionRequest, signal: AbortSignal): Promise<Record<string, never>>

/**
 * Authenticate and inspect an exported root before publishing readiness.
 * @param request Target and exact saved revision.
 * @param signal Carrier cancellation propagated through worker settlement.
 * @returns the ready worker identity and connection generation.
 */
@Remote connect(request: TargetRevisionRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Close a target after cancellation acknowledgement for admitted work.
 * @param request Saved target identity.
 * @param signal Carrier cancellation before admission.
 * @returns the disconnected target.
 */
@Remote disconnect(request: TargetRequest, signal: AbortSignal): Promise<TargetValue>

/**
 * Read a bounded directory listing inside an exported root.
 * @param request Target, generation, root and relative path.
 * @param signal Carrier cancellation propagated through worker settlement.
 * @returns the directory result with target provenance.
 */
@Remote inspectDirectory(request: InspectDirectoryRequest, signal: AbortSignal): Promise<InspectionValue>
```

Source: [`packages/api/execution-host-controller/src/index.ts`](../../packages/api/execution-host-controller/src/index.ts)

<a id="ctxintegrationpreflightcontroller--integrationpreflightcontroller"></a>

### `ctx.integrationPreflightController` — `IntegrationPreflightController`

Probe GitHub, GitLab, and Gitee integration readiness without exposing tokens or credentials.

```ts cordis-catalog
/**
 * Check one integration provider's readiness independently from plugin activation.
 * @param request - Integration provider to check.
 * @param signal - Caller cancellation forwarded to the read-only probe.
 * @returns Readiness snapshot with redacted status and account hint.
 */
@Remote('check') async check(request: IntegrationPreflightRequest, signal: AbortSignal): Promise<IntegrationPreflightSnapshot>
```

Source: [`packages/api/integration-preflight-controller/src/index.ts`](../../packages/api/integration-preflight-controller/src/index.ts)

<a id="ctxmcpcontroller--mcpcontroller"></a>

### `ctx.mcpController` — `McpController`

Current-profile MCP management without composition rewrites or tool execution.

```ts cordis-catalog
/**
 * Read the complete profile view without starting network work.
 * @returns Current desired configuration and redacted live observations.
 */
@Remote snapshot(): McpManagementSnapshot

/**
 * Observe complete replacement snapshots, coalescing updates while the consumer is paused.
 * @param signal - Stream cancellation; controller disposal also closes the stream.
 * @returns Initial state followed by current complete snapshots; no unbounded event backlog.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<McpManagementSnapshot>

/**
 * Save desired configuration independently from connection readiness.
 * @param request - Full desired configuration and editor revision.
 * @returns Durable record identity and current status.
 */
@Remote async save(request: McpSaveRequest): Promise<McpSaveResult>

/**
 * Stop the owned connection before deleting its configuration.
 * @param request - Owned record and expected revision.
 * @returns Durable removal after its child stops.
 */
@Remote async removeServer(request: McpRemoveRequest): Promise<McpManagementSnapshot>

/**
 * Persist enablement and apply it to the owned connection.
 * @param request - Desired switch and expected revision.
 * @returns Committed desired state and current observed readiness.
 */
@Remote async setEnabled(request: McpSetEnabledRequest): Promise<McpManagementSnapshot>

/**
 * Replace an enabled connection after confirmed cleanup.
 * @param request - Enabled manager-owned record.
 * @returns New observed attempt after the previous child quiesces.
 */
@Remote async reconnect(request: McpServerRequest): Promise<McpManagementSnapshot>

/**
 * Refresh tools on an initialized owned connection; starts no server and invokes no tool.
 * @param request - Managed record address.
 * @param signal - Cancellation of the tools/list request.
 * @returns The complete profile view after discovery.
 */
@Remote async probe(request: McpServerRequest, signal: AbortSignal): Promise<McpManagementSnapshot>
```

Types: [McpManagementSnapshot](mcp.zh.md) · [McpRemoveRequest](mcp.zh.md) · [McpSaveRequest](mcp.zh.md) · [McpSaveResult](mcp.zh.md) · [McpServerRequest](mcp.zh.md) · [McpSetEnabledRequest](mcp.zh.md)

Source: [`packages/api/mcp-controller/src/index.ts`](../../packages/api/mcp-controller/src/index.ts)

<a id="ctxsecurityresearchcontroller--securityresearchcontroller"></a>

### `ctx.securityResearchController` — `SecurityResearchController`

Host Remote for resource management, assessment status, and authorized report downloads.

```ts cordis-catalog
/**
 * Describe the current Harness-native security composition without exposing
 * target values, credentials, authorization references, or provider paths.
 * @param signal - Caller cancellation.
 * @returns A redacted point-in-time status for the Settings page.
 */
@Remote('describe') async describe(signal: AbortSignal): Promise<SecurityResearchSnapshot>

/**
 * Export a complete same-Session report after every contained target passes report-download authorization.
 * @param request - Live Session and report format; free-text Finding metadata is exported verbatim.
 * @param signal - Caller cancellation, checked again after every asynchronous operation.
 * @returns Bounded deterministic bytes after the authorization decisions reach Session storage.
 */
@Remote('exportReport') async exportReport(request: SecurityResearchReportRequest, signal: AbortSignal): Promise<SecurityResearchReportValue>

/**
 * Read resource status without starting an installation or checking the network.
 * @param signal - Caller cancellation for this observation.
 * @returns The manager snapshot or explicit component absence.
 */
@Remote('describeResources') async describeResources(signal: AbortSignal): Promise<SecurityResourceAvailability>

/**
 * Observe replacement snapshots; slow consumers retain only a pending refresh.
 * @param signal - Observer lifetime; cancellation never stops a resource operation.
 * @returns Initial state and manager changes until cancellation or controller disposal.
 */
@Remote({ mode: 'stream' }) async *observeResources(signal: AbortSignal): AsyncIterable<SecurityResourceAvailability>

/**
 * Start a Host-owned release lookup.
 * @param signal - Caller cancellation before admission, independent of admitted work.
 * @returns The admitted operation and current installation.
 */
@Remote('checkResourceUpdate') checkResourceUpdate(signal: AbortSignal): Promise<SecuritySkillResourceStatus>

/**
 * Start a Host-owned download and installation.
 * @param signal - Caller cancellation before admission, independent of admitted work.
 * @returns The admitted operation and current installation.
 */
@Remote('installResource') installResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus>

/**
 * Replace installed resources using the configured release source.
 * @param signal - Caller cancellation before admission, independent of admitted work.
 * @returns The admitted operation while the committed installation remains available.
 */
@Remote('reinstallResource') reinstallResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus>

/**
 * Start installation of an available resource update.
 * @param signal - Caller cancellation before admission, independent of admitted work.
 * @returns The admitted operation and current installation.
 */
@Remote('updateResource') updateResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus>

/**
 * Explicitly install the package's bundled resources without a download source.
 * @param signal - Caller cancellation before admission, independent of admitted work.
 * @returns The admitted operation and bundled provenance after commit.
 */
@Remote('installBundledResource') installBundledResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus>

/**
 * Cancel only the exact operation the caller observed.
 * @param request - Manager-issued operation identity.
 * @param signal - Caller cancellation before admission.
 * @returns Manager state after the explicit cancellation request.
 */
@Remote('cancelResource') cancelResource(request: SecurityResearchResourceCancelRequest, signal: AbortSignal): Promise<SecuritySkillResourceStatus>

/**
 * Remove the managed installation through its generation owner.
 * @param signal - Caller cancellation before admission, independent of admitted work.
 * @returns The manager's removal state.
 */
@Remote('removeResource') removeResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus>
```

Types: [SecuritySkillResourceStatus](security-research.zh.md)

Source: [`packages/api/security-research-controller/src/index.ts`](../../packages/api/security-research-controller/src/index.ts)

<a id="ctxsidebargitcontroller--sidebargitcontroller"></a>

### `ctx.sidebarGitController` — `SidebarGitController`

Carry typed Git requests without adding authority or another process implementation.

```ts cordis-catalog
/**
 * Read the current Git panel state.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('status') async status(request: GitSessionRequest, signal: AbortSignal): Promise<GitStatusResult>

/**
 * Read a worktree or staged patch.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('diff') async diff(request: GitDiffRequest, signal: AbortSignal): Promise<GitDiffResult>

/**
 * Stage explicitly selected paths.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('stage') async stage(request: GitPathMutationRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Unstage explicitly selected paths.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('unstage') async unstage(request: GitPathMutationRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * List existing local branches.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('branches') async branches(request: GitSessionRequest, signal: AbortSignal): Promise<GitBranchesResult>

/**
 * Check out an existing local branch.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('checkout') async checkout(request: GitCheckoutRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Prepare an exact commit intent for user review.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('prepareCommit') async prepareCommit(request: GitPrepareCommitRequest, signal: AbortSignal): Promise<GitCommitPreview>

/**
 * Commit the unchanged intent confirmed by the user.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('commit') async commit(request: GitCommitRequest, signal: AbortSignal): Promise<GitCommitResult>

/**
 * Compare committed changes against locally available refs.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('compare') async compare(request: GitSessionRequest, signal: AbortSignal): Promise<GitCompareResult>

/**
 * Read a bounded page of commit history.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('log') async log(request: GitLogRequest, signal: AbortSignal): Promise<GitLogEntry[]>

/**
 * Read one file from a selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('show') async show(request: GitShowRequest, signal: AbortSignal): Promise<GitShowResult>

/**
 * Read the patch of a selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('commitDiff') async commitDiff(request: GitRevisionRequest, signal: AbortSignal): Promise<GitDiffResult>

/**
 * Discard one tracked path after explicit confirmation.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('discard') async discard(request: GitDiscardRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Revert an explicitly selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('revert') async revert(request: GitRevisionMutationRequest, signal: AbortSignal): Promise<GitMutationResult>

/**
 * Cherry-pick an explicitly selected commit.
 * @param request - Session identity and operation-specific user intent.
 * @param signal - caller cancellation forwarded to the concrete owner.
 * @returns the owner result; failures retain their stable sidebar-git code.
 */
@Remote('cherryPick') async cherryPick(request: GitRevisionMutationRequest, signal: AbortSignal): Promise<GitMutationResult>
```

Source: [`packages/api/sidebar-git-controller/src/index.ts`](../../packages/api/sidebar-git-controller/src/index.ts)

<a id="ctxsidebarterminalcontroller--sidebarterminalcontroller"></a>

### `ctx.sidebarTerminalController` — `SidebarTerminalController`

Validated Remote calls over the sole sidebar terminal provider; owns no PTYs.

```ts cordis-catalog
/** Query native terminal availability.
 * @returns Availability without opening a terminal.
 */
@Remote capability(): SidebarTerminalCapability

/** Discover installed local shells for a new UI tab.
 * @returns Verified executable paths and display names; does not create a process.
 */
@Remote shells(): readonly SidebarTerminalShell[]

/**
 * Attach to a terminal and forward acknowledged output without buffering it.
 * @param request - Immutable target and integer geometry from 1 through 1024.
 * @param signal - Attachment lifetime; disposal also cancels and closes the provider iterator.
 * @returns Provider frames; operational failures use sidebarTerminals error codes.
 */
@Remote({ mode: 'stream' }) open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame>

/** Forward input to the attached native process.
 * @param request - Live attachment and at most 64 KiB of UTF-8 input.
 */
@Remote input(request: SidebarTerminalInputRequest): void

/** Resize the attached native process.
 * @param request - Live attachment and integer geometry from 1 through 1024.
 */
@Remote resize(request: SidebarTerminalResizeRequest): void

/** Acknowledge output consumed by the renderer.
 * @param request - Live attachment and highest rendered nonnegative safe sequence.
 */
@Remote ack(request: SidebarTerminalAckRequest): void

/** Release the attachment with its requested disposition.
 * @param request - Attachment to disconnect, park, or close.
 */
@Remote release(request: SidebarTerminalReleaseRequest): void

/** Observe an existing UI process without spawning or extending lifetime.
 * @param request - Existing UI tab.
 * @returns Its native generation or null.
 */
@Remote inspectUi(request: SidebarTerminalUiTarget): SidebarTerminalProcessId | null

/** Close only the observed UI process generation.
 * @param request - Exact previously observed process; replacements cannot be closed by a stale request.
 */
@Remote closeUi(request: SidebarTerminalCloseUiRequest): void

/**
 * Observe the agent terminals owned by one Session.
 * @param sessionId - Nonempty opaque Session identity.
 * @param signal - Consumer lifetime; disposal also cancels and closes the provider iterator.
 * @returns Complete current lists and subsequent provider snapshots.
 */
@Remote({ mode: 'stream' }) watch(sessionId: SidebarTerminalSessionId, signal: AbortSignal): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]>

/** Close the identified agent terminal.
 * @param uuid - Lowercase UUID of an agent terminal explicitly closed by the user.
 */
@Remote closeAgent(uuid: SidebarAgentTerminalId): void
```

Types: [SidebarAgentTerminalId](terminal.zh.md) · [SidebarAgentTerminalSnapshot](terminal.zh.md) · [SidebarTerminalAckRequest](terminal.zh.md) · [SidebarTerminalCapability](terminal.zh.md) · [SidebarTerminalCloseUiRequest](terminal.zh.md) · [SidebarTerminalFrame](terminal.zh.md) · [SidebarTerminalInputRequest](terminal.zh.md) · [SidebarTerminalOpenRequest](terminal.zh.md) · [SidebarTerminalProcessId](terminal.zh.md) · [SidebarTerminalReleaseRequest](terminal.zh.md) · [SidebarTerminalResizeRequest](terminal.zh.md) · [SidebarTerminalSessionId](terminal.zh.md) · [SidebarTerminalShell](../../packages/terminal/sidebar-terminals/README.zh.md#ownership-and-lifetime) · [SidebarTerminalUiTarget](terminal.zh.md)

Source: [`packages/api/sidebar-terminal-controller/src/index.ts`](../../packages/api/sidebar-terminal-controller/src/index.ts)

<a id="ctxterminalcontroller--terminalcontroller"></a>

### `ctx.terminalController` — `TerminalController`

Host service backing the generated `ctx.remote.terminals` namespace.

```ts cordis-catalog
/**
 * List all terminals owned by one session's agent.
 * @param request - session identity.
 * @param signal - cancellation.
 * @returns terminal snapshots in publication order.
 */
@Remote async list(request: TerminalListRequest, signal: AbortSignal): Promise<TerminalListValue>

/**
 * Spawn a new terminal session owned by the agent.
 * @param request - session identity and terminal spawn parameters.
 * @param signal - cancellation of unpublished setup.
 * @returns published terminal identity and initial output.
 */
@Remote async spawn(request: TerminalSpawnRequest, signal: AbortSignal): Promise<TerminalSpawnValue>

/**
 * Send input to a terminal and await readiness.
 * @param request - terminal identity and input text.
 * @param signal - cancellation of the send operation.
 * @returns settled output and wait reason.
 */
@Remote async send(request: TerminalSendRequest, signal: AbortSignal): Promise<TerminalSendValue>

/**
 * Read terminal scrollback.
 * @param request - terminal identity and optional page parameters.
 * @param signal - cancellation.
 * @returns bounded scrollback page.
 */
@Remote async read(request: TerminalReadRequest, signal: AbortSignal): Promise<TerminalReadValue>

/**
 * Signal a terminal's foreground process group.
 * @param request - terminal identity and signal name.
 * @param signal - cancellation.
 * @returns delivered process group identity.
 */
@Remote async signal(request: TerminalSignalRequest, signal: AbortSignal): Promise<TerminalSignalValue>

/**
 * Close a terminal and await quiescent cleanup.
 * @param request - terminal identity.
 * @param signal - cancellation.
 * @returns whether the terminal was newly closed.
 */
@Remote async kill(request: TerminalKillRequest, signal: AbortSignal): Promise<TerminalKillValue>
```

Types: [TerminalReadRequest](terminal.zh.md) · [TerminalSendRequest](terminal.zh.md) · [TerminalSpawnRequest](terminal.zh.md)

Source: [`packages/api/terminal-controller/src/index.ts`](../../packages/api/terminal-controller/src/index.ts)

<a id="ctxtypert--typertregistry"></a>

### `ctx.typert` — `TypertRegistry`

Registry of generated schemas, package reflection, invocations, and Remote dependency providers.

```ts cordis-catalog
/**
 * Register one generated contribution atomically for the calling fiber.
 * Duplicate package-face identities, schemas, invocation ids, or endpoints
 * reject the whole batch.
 * @param contribution - generated schemas, reflection, and Host invocations.
 * @returns the exact effect disposer that removes this contribution.
 */
register(contribution: TypertContribution): TypertDisposer

/**
 * Look up one schema by `<package>#<name>`.
 * @param key - global schema key.
 * @returns the live schema record, or `undefined` when absent.
 */
get(key: string): TypertSchemaRecord | undefined

/**
 * Resolve one required schema.
 * @param key - global schema key.
 * @returns the live schema record.
 * @throws when the key is malformed, the package face is absent, or the schema is not contributed.
 */
resolve(key: string): TypertSchemaRecord

/**
 * Enumerate live schemas in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching schema records.
 */
list(filter: TypertSchemaFilter = {}): TypertSchemaRecord[]

/**
 * Look up generated reflection for one package face.
 * @param packageName - exact npm package name.
 * @param face - face to query; defaults to the host runtime.
 * @returns the live package record, or `undefined` when absent.
 */
getPackage(packageName: string, face: TypertFace = 'host'): TypertPackageRecord | undefined

/**
 * Enumerate generated package reflection in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching package records.
 */
listPackages(filter: TypertPackageFilter = {}): TypertPackageRecord[]

/**
 * Project a live Zod schema to JSON Schema without caching the result.
 * @param key - global schema key.
 * @param params - Zod projection parameters.
 * @returns a fresh JSON Schema document.
 */
toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema
```

Types: [TypertContribution](invariants.zh.md) · [TypertFace](invariants.zh.md) · [TypertPackageFilter](invariants.zh.md) · [TypertPackageRecord](invariants.zh.md) · [TypertSchemaFilter](invariants.zh.md) · [TypertSchemaRecord](invariants.zh.md)

Source: [`packages/typert/registry/src/service.ts`](../../packages/typert/registry/src/service.ts)

<a id="ctxtypertgateway--typertgatewayservice"></a>

### `ctx.typertGateway` — `TypertGatewayService`

Resolve strict generated definitions or conservative SRC markers against current Cordis Services and Typert providers.

```ts cordis-catalog
/**
 * Register the sole application-selected forwarded-event source.
 * @param source - stream factory installed by the Remote assembly.
 * @param host - stable Host facts included in each Client generation's opening frame.
 * @returns disposer removing this source and cancelling its active streams.
 */
registerRemoteEvents( source: TypertRemoteEventSource, host: RemoteEventHostInfo, ): () => Promise<void>

/**
 * Invoke one live Remote method through strict generated reflection or SRC markers.
 * @param request - decoded endpoint and exact named wire arguments.
 * @returns the business result without output decoding.
 * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
 */
async invoke(request: InvokeRemoteRequest): Promise<unknown>

/**
 * Open one live stream Remote method without assuming a physical carrier.
 * @param request - decoded endpoint and named wire arguments.
 * @returns a cancellation-aware iterable over the business results.
 */
async stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>
```

Source: [`packages/api/gateway/src/index.ts`](../../packages/api/gateway/src/index.ts)

<a id="ctxusagecontroller--usagecontroller"></a>

### `ctx.usageController` — `UsageController`

Read-only usage consumer with no Session activation or preference mutation.

```ts cordis-catalog
/**
 * Query known own-Turn accounting through the authenticated browser carrier.
 * @param request - interval and optional exact provider/model filters.
 * @param signal - transport cancellation propagated through all Host reads.
 * @returns the query service result unchanged, including unknown/partial accounting.
 * @throws a sanitized RemoteError on query failure, or the caller signal reason on cancellation.
 */
@Remote async query(request: UsageQueryRequest, signal: AbortSignal): Promise<UsageQueryResult>
```

Types: [UsageQueryRequest](session-query.zh.md) · [UsageQueryResult](session-query.zh.md)

Source: [`packages/api/usage-controller/src/index.ts`](../../packages/api/usage-controller/src/index.ts)

<a id="ctxvoicecontroller--voicecontroller"></a>

### `ctx.voiceController` — `VoiceController`

Transport adapter over the provider-neutral voice operations.

```ts cordis-catalog
/**
 * Read native engine availability without downloading models.
 * @param signal - Transport cancellation.
 * @returns Availability and provider repair guidance.
 */
@Remote engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus>

/**
 * Read the model roster and current cache state.
 * @param signal - Transport cancellation.
 * @returns Display metadata and installation status.
 */
@Remote modelsList(signal: AbortSignal): Promise<VoiceModelsListValue>

/**
 * Download or await a model installation.
 * @param request - Exact model selector from modelsList.
 * @param signal - Cancels the shared model installation and awaits its cleanup.
 * @returns Ready cache directory.
 */
@Remote modelsDownload(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelsDownloadValue>

/**
 * Cancel model work and remove the downloaded files.
 * @param request - Exact model selector from modelsList.
 * @param signal - Caller cancellation before deletion starts.
 * @returns Empty receipt after removal and resource cleanup.
 */
@Remote modelsRemove(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelsRemoveValue>

/**
 * Transcribe bounded canonical base64 PCM with an installed model.
 * @param request - Model selector and little-endian 16kHz mono float32 PCM.
 * @param signal - Transport cancellation; native work settles before resources release.
 * @returns Transcript after recognizer disposal.
 */
@Remote transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult>
```

Types: [VoiceEngineStatus](voice.zh.md) · [VoiceModelsDownloadValue](voice.zh.md) · [VoiceModelsListValue](voice.zh.md) · [VoiceTranscribeRequest](voice.zh.md) · [VoiceTranscribeResult](voice.zh.md)

Source: [`packages/api/voice-controller/src/index.ts`](../../packages/api/voice-controller/src/index.ts)

<a id="ctxworkspaceisolationcontroller--workspaceisolationcontroller"></a>

### `ctx.workspaceIsolationController` — `WorkspaceIsolationController`

Host API exposing lease ids and detached state, never deletion paths.

```ts cordis-catalog
/**
 * List every provider-owned lease without activating a checkout.
 * @param signal - Caller cancellation checked before reading provider state.
 * @returns detached active and hibernated lease projections.
 */
@Remote('list') list(signal: AbortSignal): WorkspaceIsolationListValue

/**
 * Materialize one hibernated lease.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached active lease state.
 */
@Remote('activate') async activate( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationLeaseValue>

/**
 * Checkpoint and reclaim one inactive checkout while retaining its branch.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation checked before provider admission.
 * @returns detached hibernated lease state.
 */
@Remote('hibernate') async hibernate( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationLeaseValue>

/**
 * Inspect checkout ownership and working-tree state without mutation.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached lightweight inspection.
 */
@Remote('inspect') async inspect( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationInspectionValue>

/**
 * Compare one lease with its current base branch.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached bounded comparison.
 */
@Remote('compare') async compare( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationComparisonValue>

/**
 * Merge a managed branch into its clean recorded base checkout.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached integration receipt.
 */
@Remote('merge') async merge( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationIntegrationValue>

/**
 * Cherry-pick a managed branch's linear commits into its clean recorded base checkout.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached integration receipt.
 */
@Remote('cherryPick') async cherryPick( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationIntegrationValue>

/**
 * Export a complete bounded patch without accepting a browser-supplied path.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns patch content and omission metadata.
 */
@Remote('exportPatch') async exportPatch( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationPatchValue>

/**
 * Reclaim one checkout and delete its branch only after safe integration.
 * @param request - Exact provider-issued lease identity.
 * @param signal - Caller cancellation checked before provider admission.
 * @returns removal acknowledgement or a retained branch requiring review.
 */
@Remote('teardown') async teardown( request: WorkspaceIsolationLeaseRequest, signal: AbortSignal, ): Promise<WorkspaceIsolationTeardownValue>

/**
 * Remove provider-detected orphaned worktrees in its bounded scan scope.
 * @param signal - Caller cancellation checked before provider admission.
 * @returns number of orphaned worktrees removed.
 */
@Remote('prune') async prune(signal: AbortSignal): Promise<WorkspaceIsolationPruneValue>
```

Source: [`packages/api/workspace-isolation-controller/src/index.ts`](../../packages/api/workspace-isolation-controller/src/index.ts)

<a id="ctxworktreetaskcontroller--worktreetaskcontroller"></a>

### `ctx.worktreeTaskController` — `WorktreeTaskController`

Host API exposing Worktree Task lifecycle operations.

```ts cordis-catalog
/**
 * Create a new Worktree Task with its own branch and worktree checkout.
 * @param request - Task name, workspace, source path, and optional base ref.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached created task projection.
 */
@Remote('create') async create(request: WorktreeTaskCreateRequest, signal: AbortSignal): Promise<WorktreeTaskCreateValue>

/**
 * List every task without activating a checkout.
 * @param signal - Caller cancellation checked before reading provider state.
 * @returns detached task projections.
 */
@Remote('list') list(signal: AbortSignal): WorktreeTaskListValue

/**
 * Get one task by id without filesystem work.
 * @param request - Task identity.
 * @param signal - Caller cancellation checked before reading provider state.
 * @returns detached task projection; an unknown id rejects with not-found.
 */
@Remote('get') get(request: WorktreeTaskRequest, signal: AbortSignal): WorktreeTaskValue

/**
 * Read provider defaults without running hooks or materializing tasks.
 * @param signal - Caller cancellation checked before the read.
 * @returns detached defaults, revision, and managed root.
 */
@Remote('settings') settings(signal: AbortSignal): WorktreeTaskSettings

/**
 * Save defaults for future tasks without changing existing tasks or running hooks.
 * @param request - Complete defaults and the revision observed by the caller.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns persisted defaults with their new revision; a stale revision rejects.
 */
@Remote('updateSettings') async updateSettings(request: UpdateWorktreeTaskSettingsRequest, signal: AbortSignal): Promise<WorktreeTaskSettings>

/**
 * Read tracked changes against the captured base without activating a dormant task.
 * @param request - Provider-issued task identity.
 * @param signal - Caller cancellation forwarded to queued and active provider reads.
 * @returns complete bounded review, captured hooks, and untracked names without contents.
 */
@Remote('review') async review(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskReview>

/**
 * Bind a session to an existing task.
 * @param request - Task id and session id.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns updated task and checkout path.
 */
@Remote('bindSession') async bindSession(request: WorktreeTaskBindSessionRequest, signal: AbortSignal): Promise<WorktreeTaskBindSessionValue>

/**
 * Reactivate a hibernated task's checkout.
 * @param request - Task identity.
 * @param signal - Caller cancellation forwarded to provider work.
 * @returns detached active task projection.
 */
@Remote('activate') async activate(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue>

/**
 * Checkpoint and reclaim one inactive task's checkout.
 * @param request - Task identity.
 * @param signal - Cancellation forwarded to queued work and provider subprocesses.
 * @returns detached hibernated task projection.
 */
@Remote('hibernate') async hibernate(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue>

/**
 * Run captured cleanup and archive a task, retaining its branch and records for review.
 * A succeeded receipt prevents repeat execution; an unsettled receipt rejects another attempt.
 * @param request - Task identity; repeating a settled failure explicitly retries cleanup.
 * @param signal - Cancellation forwarded to queued work and provider subprocesses.
 * @returns detached archived task projection, including any cleanup receipt.
 */
@Remote('archive') async archive(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskValue>

/**
 * Archive through captured cleanup, then remove an integrated task branch when safe.
 * An unmerged branch remains archived and reviewable; successful cleanup is not repeated.
 * @param request - Task identity; repeating a settled failure explicitly retries cleanup.
 * @param signal - Cancellation forwarded to queued work and provider subprocesses.
 * @returns deletion or retained-branch result, including any cleanup receipt.
 */
@Remote('delete') async delete(request: WorktreeTaskRequest, signal: AbortSignal): Promise<WorktreeTaskDeleteValue>
```

Types: [UpdateWorktreeTaskSettingsRequest](workspace.zh.md) · [WorktreeTaskReview](workspace.zh.md) · [WorktreeTaskSettings](workspace.zh.md)

Source: [`packages/api/worktree-task-controller/src/index.ts`](../../packages/api/worktree-task-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
