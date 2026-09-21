# 自动化

[English](automation.md) | 中文

持久本地自动化根据显式保存的输入创建新的 Agent Session。[运行时](../../packages/automation/automation/README.zh.md) 拥有调度与持久化，[Controller](../../packages/api/automation-controller/README.zh.md) 拥有 Remote 命令与浏览器状态，[设置页](../../packages/client/ui-settings-automation/README.zh.md) 拥有人机交互。

## 标识与定义

AutomationId 归一个规范化 Harness home 与启动 profile 所有。AutomationRunId 标识一次调用；产生的 Session 拥有自己的 SessionId。手动请求令牌使重复准入保持幂等。保存定义捕获 Workspace id 与规范路径、Agent 预设 id、模型选择、解析后的权限值、提示词和计划。默认值变化不改写定义。预设 id 指向其当前组合。

## 调度语义

计划采用分钟精度的 UTC 每小时、每天或每周规则。创建时禁用。启用后只在配置的迟到窗口内准入未来时刻；错过的时刻跳过。时钟回退不能倒退已提交游标。每个时刻在创建 Agent 前认领，并同时提交冻结的调用输入和下一个游标。存在活动调用时，计划重叠记为跳过，手动重叠被拒绝。手动运行可以执行禁用定义，并且不移动计划游标。

## 状态与恢复

一个进程持有该 profile 的 SQLite 所有权事务。日志与定义使用另一个数据库，因此持有所有权期间仍可写入。竞争进程显示不可用状态，不执行恢复或调度。失败或结果不确定的提交不能创建 Agent，也不能发布操作成功。

关闭时停止准入并等待活动操作结束，随后释放所有权。恢复将未确定的 starting 工作记为 ambiguous，将中断的活动工作记为 interrupted，暂停受影响的定义供检查，并且从不重放。完成状态记录观测到的 Agent 结果，不是对任务成功的独立检查。运行时 README 定义锁定、取消、保留和文件系统限制。

## 浏览器命令

automation Remote 命名空间提供快照、选择器元数据、创建/更新/删除、手动运行/取消、分页历史和计划预览。其流通过现有经过认证的 Connection 发布完整已提交状态。需要时，命令携带显式 revision 或幂等令牌；Client 服务保留错误，不以空历史替代失败读取。浏览器组件接收普通回调和框架拥有的可观察 hooks。

## 类型参考

来源：[`packages/automation/automation/src/types.ts`](../../packages/automation/automation/src/types.ts)。保存的时间戳均为 Unix 毫秒；可空的证据字段在尚无对应证据时保持 `null`。

### 保存的输入

草稿包含编辑器中的显式选择。Host 在持久化 spec 前解析工作区身份与权限值。

| 类型 | 字段与含义 |
|---|---|
| `AutomationId` | 单个启动 profile 内定义的品牌化持久 id。 |
| `AutomationRunId` | 调用日志的品牌化 id，独立于 `SessionId`。 |
| `AutomationRequestId` | 手动准入使用的品牌化客户端重试令牌。同一自动化重复使用时返回已有回执；用于另一自动化时产生冲突。 |
| `AutomationModelSelection` | `provider`、`model` 与可选 `reasoningEffort`；独立于当前交互式选择保存。 |
| `AutomationPermission` | 解析后的 `sandbox`（`read-only`、`workspace-write` 或 `danger-full-access`）与 `approval`（`ask` 或 `never`）。更改这些值需要重新显式保存。 |
| `AutomationDraft` | 包含 `title`、`prompt`、`workspaceId`、`agentPresetId`、`model`、`permissionPresetId` 与 `schedule`。创建时不接受 `enabled` 字段。 |
| `AutomationSpec` | 完整草稿加上 Host 解析的 `workspacePath` 与 `permission`；每次准入的运行保留自己的副本。 |

`AutomationSchedule` 是由 `kind` 区分的封闭联合；[输入 schema](../../packages/automation/automation/src/schema.ts) 拒绝额外字段。

| `kind` | 必需字段 |
|---|---|
| `hourly` | `minute`，范围为 0 至 59 的整数。 |
| `daily` | 范围为 0 至 23 的 `hour`，以及 `minute`。 |
| `weekly` | `hour`、`minute` 与 `weekdays`：一至七个互不重复的 0 至 6 整数，星期日为 0。 |

### 定义与调用证据

`AutomationDefinition` 将保存的计划与其 revision、调度状态组合在一起。编辑定义不会替换活动运行已准入的输入。

| 字段 | 含义 |
|---|---|
| `id`、`revision`、`scheduleRevision` | 定义身份、乐观编辑版本与计划代次。计划变化时递增 `scheduleRevision`。 |
| `spec`、`enabled`、`needsReview` | 解析后的输入、调度开关与恢复检查标记。 |
| `nextPlannedAt` | 只向前推进的计划时刻游标，或 `null`。 |
| `createdAt`、`updatedAt`、`deletedAt` | 创建、最近更新与可空的删除时间戳。删除后仍保留调用日志。 |

`AutomationRun` 保留准入时的 spec，且仅记录已观测的执行证据。

| 字段 | 含义 |
|---|---|
| `id`、`automationId`、`definitionRevision`、`scheduleRevision`、`spec` | 调用身份，以及准入时准确的定义代次和输入。 |
| `trigger`、`requestId`、`plannedAt` | `scheduled` 或 `manual`、可空的手动重试令牌，以及准入的计划时刻。 |
| `sessionId`、`messageId`、`turn` | 指向已创建 Session、输入消息与已观测轮次的可空关联。 |
| `status`、`reason` | `AutomationRunStatus` 与可空的说明。 |
| `createdAt`、`updatedAt`、`finishedAt` | 日志时间戳；终止之前 `finishedAt` 可为空。 |

`AutomationRunStatus` 为 `starting`、`running`、`stopping`、`completed`、`failed`、`cancelled`、`skipped-overlap`、`interrupted` 或 `ambiguous`。前三项描述活动工作。`skipped-overlap` 记录因重叠被拒绝的计划时刻；`interrupted` 与 `ambiguous` 需要检查，不会自动重试。

### 读取与命令

[运行时](../../packages/automation/automation/src/index.ts) 发布已提交的快照，并要求编辑与手动准入携带调用方观测到的 revision。

| 类型 | 字段与含义 |
|---|---|
| `AutomationSnapshot` | `status: ready` 携带 `profile`、集合 `revision`、`definitions` 与 `activeRuns`。`status: unavailable` 携带 `profile` 与 `reason`：`owned`、`storage` 或 `closing`。不可用状态与空的就绪集合不同。 |
| `AutomationUpdate` | `id`、`expectedRevision`、完整替换用的 `draft` 与显式 `enabled`；不是稀疏补丁。 |
| `AutomationDelete` | `id` 与 `expectedRevision`；存在活动调用时拒绝删除。 |
| `AutomationRunRequest` | `id`、`expectedRevision` 与稳定的 `requestId`；手动准入返回持久回执。 |
| `AutomationRunPage` | 按最新优先排序的 `runs` 与可空的 `nextCursor`；日志读取接受 1 至 100 的条数限制。 |
| `AutomationErrorCode` | `unavailable`、`not-found`、`conflict`、`invalid`、`busy`、`resource` 或 `storage`；稳定分类不含凭据或提供方响应内容。 |
| `AutomationConfig` | 实际启动的 `profile`、正安全整数 `clockCheckIntervalMs` 与 `maxStartLatenessMs`；时间策略和存储身份不依赖进程 cwd。 |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomationruntime--automationruntime"></a>

### `ctx.automationRuntime` — `AutomationRuntime`

Concrete same-Host automation owner, with no remote routing or replay queue.

```ts cordis-catalog
/** Current committed state; object identity changes only with publication.
 * @returns the most recently committed view or explicit availability state.
 */
snapshot(): AutomationSnapshot

/** Subscribe to committed snapshots.
 * @param listener - observer whose failure does not undo a durable operation.
 * @returns the subscription disposer.
 */
subscribe(listener: (snapshot: AutomationSnapshot) => void): () => void

/** Resolve and save a disabled automation for a local Workspace; remote bindings reject before path access.
 * @param draft - explicit user choices; defaults are resolved by the editor.
 * @returns the committed definition.
 */
async create(draft: AutomationDraft): Promise<AutomationDefinition>

/** Save a complete revision-fenced draft with explicit enable/pause behavior.
 * @param request - edited revision, explicit values, and intended enable state.
 * @returns the committed replacement; active runs keep their immutable inputs.
 */
async update(request: AutomationUpdate): Promise<AutomationDefinition>

/** Remove an inactive plan while retaining its journal.
 * @param request - exact identity and edited revision.
 */
delete(request: AutomationDelete): Promise<void>

/** Admit an explicit manual run without enabling or moving recurrence.
 * @param request - exact definition revision and stable retry token.
 * @returns an already durable invocation receipt.
 */
async run(request: AutomationRunRequest): Promise<AutomationRun>

/** Request real cancellation of this runtime's invocation.
 * @param id - durable run identity.
 */
async cancel(id: AutomationRunId): Promise<void>

/** Read a bounded newest-first journal page.
 * @param id - task identity.
 * @param cursor - previous page cursor, or null.
 * @param limit - record count, 1 through 100.
 * @returns recorded invocations, never synthetic history.
 */
runs(id: AutomationId, cursor: AutomationRunId | null, limit: number): AutomationRunPage

/** Preview five future UTC occurrences without saving or dispatching.
 * @param schedule - proposed minute schedule.
 * @param afterUtc - absolute epoch milliseconds.
 * @returns five strictly future UTC instants.
 */
previewSchedule(schedule: AutomationSchedule, afterUtc: number): number[]
```

Source: [`packages/automation/automation/src/index.ts`](../../packages/automation/automation/src/index.ts)
<!-- END GENERATED cordis-surface -->
