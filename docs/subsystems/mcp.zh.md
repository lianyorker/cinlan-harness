# MCP 连接与管理

[English](mcp.md) | 中文

MCP 将外部工具服务器接入 Harness，并提供可检查的连接状态。[客户端桥接](../../packages/mcp/mcp-client/README.zh.md) 拥有活动连接与已发现工具；[管理服务](../../packages/mcp/mcp-management/README.zh.md) 为单个启动 profile 保存服务器定义。[资源服务](../../packages/mcp/mcp-resources/README.zh.md)提供调用方作用域内的发现与读取。本参考说明这些包声明的类型。

## 连接身份与观测

来源：[`mcp-client/src/types.ts`](../../packages/mcp/mcp-client/src/types.ts)。持久管理记录与活动启动器实例具有独立身份。[根级注册表](../../packages/mcp/mcp-client/src/registry.ts) 提供不可变快照，在变化之间保持对象身份稳定；Agent 作用域的启动器不贡献条目。

| 类型 | 字段与含义 |
|---|---|
| `McpServerId` | profile 记录拥有者分配的品牌化持久地址；更改 `serverName` 时保留。 |
| `McpConnectionId` | 单个活动启动器实例的品牌化身份，不是已保存的服务器地址。 |
| `McpOwner` | `kind: managed` 携带 `recordId`；`kind: composition` 携带实际组合拥有者的 `label`。观测本身不授予修改权限。 |
| `McpToolDescriptor` | 最近一次已提交发现结果中的公开 `name`、`description` 与 `inputSchema`。 |
| `McpConnectionState` | `phase`、重连 `attempt`、可选 `retryAt` 与 `errorCode`，以及已提交的 `tools`。启动时 attempt 为 0；`retryAt` 是 Unix 毫秒，仅在退避期间出现。 |
| `McpConnectionSnapshot` | 连接状态加上活动 `id`、`serverName`、`transport`（`stdio` 或 `streamable-http`）与 `owner`。不含可执行配置、端点、环境变量和授权标头。 |

`McpConnectionState.phase` 为 `connecting`、`ready`、`backoff`、`error` 或 `stopped`。`ready` 表示发现结果已提交，且之后未观测到错误。中断期间保留的工具列表不表示调用能够成功；停止或重试耗尽会移除它。

`McpConnectionError` 在不包含上游文本或凭据的情况下分类失败：`missing-credential`、`authentication-failed`、`connection-failed`、`tool-sync-failed`、`namespace-conflict` 或 `close-timeout`。带有 `close-timeout` 的已停止连接保留命名空间占用，因为传输关闭尚未得到确认。

## 保存的服务器定义

来源：[`mcp-management/src/types.ts`](../../packages/mcp/mcp-management/src/types.ts)。期望配置记录包含凭据引用；每次连接尝试的解析结果保持私有。参数和端点路径是公开配置，不能包含秘密值。

| 类型 | 字段与含义 |
|---|---|
| `McpServerCommon` | `serverName`、`enabled`、可选 `toolCallTimeoutMs` 与可选 `reconnect`。名称是匹配 `[A-Za-z0-9_-]{1,32}` 的本地工具命名空间。 |
| `ReconnectConfig` | 可选 `enabled`、`initialDelayMs`、`maxDelayMs` 与 `maxAttempts`。延迟以毫秒计；`maxDelayMs` 还指定重置尝试预算所需的稳定运行窗口。省略的值使用客户端桥接解析后的默认值。 |
| `McpStdioServer` | 公共字段加上 `transport: stdio`、`command`、字面量 `args`、`cwd` 与 `env`（将变量名映射到 `CredentialRef` 值）。 |
| `McpHeaderReference` | 凭据 `ref` 与非秘密 `prefix`，解析标头时在私有范围内拼接。 |
| `McpHttpServer` | 公共字段加上 `transport: streamable-http`、`url` 与 `headers`（将名称映射到 `McpHeaderReference`）。URL 不含用户信息、查询字符串或片段。 |
| `McpServerInput` | 以 `transport` 区分的 stdio 与 HTTP 定义联合，不含持久 id。 |
| `McpServerRecord` | 输入加上持久 `id: McpServerId`；服务器名称在 profile 的期望配置集合内保持唯一。 |

## 管理快照与修改

[管理服务](../../packages/mcp/mcp-management/src/index.ts) 将持久化意图与观测到的连接就绪状态分开。保存或启用记录可以成功，同时其连接报告激活错误。重连或连接失败不会改变已保存集合的 revision。

| 类型 | 字段与含义 |
|---|---|
| `McpManagedServerView` | 期望 `record`、实际 `observed` 连接状态，以及表示期望配置是否仍需应用到所拥有子实例的 `applying`。 |
| `McpExternalServerView` | `owner.kind` 为 `composition` 的连接快照；管理服务仅为观测而公开它。 |
| `McpManagementSnapshot` | `profile`、期望集合的 `revision`、表示待处理管理操作的 `reconciling`、受管理的 `servers` 与组合拥有的 `external` 连接。 |
| `McpSaveRequest` | 可选 `id`、完整 `record: McpServerInput` 与 `expectedRevision`。省略 id 时创建；提供 id 时替换对应记录。 |
| `McpSaveResult` | 持久 `id` 与当前 `snapshot`，调用方无需通过匹配用户提供的文本恢复新建身份。 |
| `McpRemoveRequest` | `id` 与 `expectedRevision`；删除在提交前停止所拥有的连接。 |
| `McpSetEnabledRequest` | 删除请求的字段加上 `enabled`；先持久化期望开关，再协调子实例生命周期。 |
| `McpServerRequest` | 当前 profile 中用于重连或探测的管理记录 `id`；不能指向外部组合。 |

`expectedRevision` 比较完整 profile 集合，而非单个服务器。过期值会导致修改被拒绝。`probe` 在已初始化连接上刷新 `tools/list`，不调用工具，也不启动已禁用服务器；取消会保留上一代工具。

`McpManagementErrorCode` 为 `conflict`、`invalid-config`、`not-found`、`disabled`、`not-ready`、`storage-failed`、`stopped`、`probe-failed` 或 `close-failed`。这些固定分类可安全用于 Remote 错误与本地化 UI 文本。关闭未得到确认时保留记录，并阻止替换该子实例。

## 启动器句柄

客户端的编程启动器与组合插件共用连接监督器。启动时的所有权和凭据解析与插件配置分离。

| 类型 | 字段与含义 |
|---|---|
| `ConnectionOutcome` | 首次尝试产生的可选 `error`。单凭 `ready` promise 成功兑现不能确定连接已就绪。 |
| `ConnectionHandle` | `ready` 报告首次结算；`getSnapshot()` 与 `subscribe()` 公开已提交状态；`probe(signal)` 刷新描述符；`resources` 将请求路由至已初始化的当前世代；`dispose()` 等待清理完成。并发释放共享同一次完成。 |
| `McpLaunchOptions` | 可选 `owner`、在保持服务器身份不变的前提下为每次尝试解析新凭据的 `resolveConfig(signal)`，以及从公开元数据中移除已知秘密值的 `redact(text)`。 |

## 作用域资源

来源：[资源运行时](../../packages/mcp/mcp-resources/src/index.ts)。提供方以配置的服务器名称在 effect 所有者的作用域中注册。后代继承最近的提供方；无关作用域不能通过该提供方派发。首个本地提供方公开三个共享工具，最后一个移除时撤销这些工具。

| 类型 | 字段与含义 |
|---|---|
| `McpResourceRequest` | `resources/list` 或 `resources/templates/list` 带可选不透明 `cursor`；`resources/read` 带显式 `uri`。 |
| `McpResourceProvider` | `request(request, execution)` 接收调用方身份与取消信号，并返回无损 JSON。 |

资源列表返回一页并保留 `nextCursor`。读取结果保留规范文本或二进制内容，模型文本则将 base64 `blob` 值替换为长度说明。配置的提供方名称在连接失败期间保持可见；协商、断开或释放期间调用会失败。托管请求使用与工具调用相同的安全错误分类。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

<a id="ctxmcpresources--mcpresourceruntime"></a>

### `ctx.mcpResources` — `McpResourceRuntime`

Scoped resource access plus three tools shared by configured MCP servers.

```ts cordis-catalog
/**
 * Register one server and expose resource tools while that scope has providers.
 * @param server - configured server name, unique in this scope.
 * @param provider - connection-owned resource operations.
 * @returns the effect disposer for this exact registration.
 */
register(server: string, provider: McpResourceProvider): () => void
```

Source: [`packages/mcp/mcp-resources/src/index.ts`](../../packages/mcp/mcp-resources/src/index.ts)
<!-- END GENERATED cordis-surface -->
