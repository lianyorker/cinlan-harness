# 工作区

[English](workspace.md) | 中文

工作区（workspace）是用户工作目录的持久记录：一个建立在规范路径之上的稳定 id、一个显示标题，以及归属于它的会话的有序账本。注册表位于 [dsh-workspace](../../packages/workspace/workspace) 包（package）（`ctx.workspaceRegistry`）——一项宿主侧可选能力，不属于 agent loop（智能体循环）主干，并且对模型不可见（没有工具、没有提示词文本、没有会话事件）。它通过[存储领域数据形式](storage.zh.md)存储自己的记录，并对照 [`SessionHeader.cwd`](persistence.zh.md#sessionheader--metadata-beside-the-log) 校验会话成员资格，因此 `storageDomain` 与 `sessionPersistence` 是必需的启动依赖：持久化这一依赖不可用时，插件保持 pending，而不是把这种不可用误当作空历史。设计记录：[领域 KV 存储 Agent Note（agent 决策记录）](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)；引导与 GUI 顺序：[Workspace UI 产品流程 Agent Note](../../.agents/notes/archived/feature/2026-07-25-workspace-ui-product-flow.md)。

源码：[`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## 标识

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` 是[品牌化 id](core.zh.md#branded-ids)。路径标识与之分离：`realpathNormalize`（`fs.realpath`；尾部斜杠、`..` 与符号链接全部解析）是唯一的一套唯一性规范——工作区路径以规范化形式存储，唯一性即规范路径的字符串相等（指向已被拥有目录的符号链接会与之冲突），attach 时的会话 cwd 检查也走同一套规范。

## 工作区实体

消费方只看到 `Workspace` 接口；实现保持包内私有。

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to the final path segment, or a filesystem root's own spelling; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

所有权的真源是记录中有序的 `sessionIds`，绝不从会话 cwd 派生——但成员资格要求两者同时成立：账本上有其 id，且 header 的规范 cwd 等于工作区路径，因此一个会话在结构上至多属于一个工作区。失败的写入会拒绝（`insertSessionBefore` 的账本错误以 `WorkspaceMoveInvalidError` 拒绝，存储失败以普通错误拒绝）；每次被接受的变更都盖上 `updatedAt` 时间戳，并持久修剪不再通过成员资格检查的候选项。

## 注册表：`ctx.workspaceRegistry`

`WorkspaceRegistry`（[签名](#ctxworkspaceregistry--workspaceregistry)）拥有注册与解析。`create(path, title?)` 要求完全限定路径并将其规范化，拒绝不存在的路径（原样传出原始 `ENOENT`）或非目录；当规范路径已被拥有时原样返回既有实体；否则创建一条标题为 `title ?? defaultWorkspaceTitle(path)` 的记录并前插到持久的注册表顺序中（不同规范路径可以共享同一显示标题，没有最终路径段时使用根路径拼写）。`get(id)` 与有序的 `list()` 是同步缓存读取；`resolveByPath(path)` 应用同一套完全限定 realpath 规范但不创建。`delete(id)` 只移除注册记录、顺序条目和会话账本——目录、用户文件、实时会话和已持久化日志一概不动，因此这些会话变为 Ungrouped（[决策](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.zh.md)）；未知 id 返回 `false`。create 与 delete 会在其两次写入（记录 + 顺序）可能分叉之前先持久写入一个待定变更标记；启动时恰好解决被标记的那次变更——通过删除被标记的表行：这会补完被中断的 delete，并回滚被中断的 create（注册可以重建，因此回滚是安全方向）——而没有标记的顺序/表不一致则作为损坏大声失败。

会话的 cwd 在创建时由创建者赋予，而不是由本注册表赋予——API 网关从所选工作区的 `path` 解析新会话的 cwd（回退到显式或默认 cwd），先创建会话使 cwd 落入其不可变的 [`SessionHeader`](persistence.zh.md#sessionheader--metadata-beside-the-log)，再调用 `attachSession`，后者会把已存储的 header cwd 与工作区路径重新校验一遍。首次成功启动时，注册表仅凭已持久化的 header（`id`、`cwd`、`createdAt`——绝不读事件正文）引导历史：把规范 cwd 有效的会话按目录分组为工作区，最新的排在最前；「已初始化」标记最后写入，因此被中断的引导可以安全续跑。引导只发生这一次：没有 cwd 的历史遗留会话保持 Ungrouped，此后创建的会话只能通过 `attachSession` 加入工作区。

## 消费方

[`dsh-workspace-controller`](../../packages/api/workspace-controller) 经 `ctx.workspaceRegistry` 向 GUI 客户端提供工作区 CRUD，[`dsh-session-controller`](../../packages/api/session-controller) 执行上文「先建会话再 attach」的流程。[dsh-agent-instructions](../../packages/context/agent-instructions) 尽管名字如此，却**不是**消费方：它在 agent 自己的 cwd 下发现 AGENTS.md 风格的指令文件，从不触碰 `ctx.workspaceRegistry`——两者共用的这个词指的是用户的工作目录，而非本注册表的实体。

## 隔离租约

`ctx.workspaceIsolation` 上的 `WorkspaceIsolation` 为每个 Session 管理一个隔离租约。提供方选择检出路径，并按租约 id 接受清理请求。品牌化的 `WorkspaceIsolationLeaseId` 与 `WorkspaceIsolationLease` 快照声明在 [`workspace-isolation/src/types.ts`](../../packages/workspace/workspace-isolation/src/types.ts) 中。API 消费方复用这些领域值；[服务操作](../../packages/workspace/workspace-isolation/src/index.ts) 使用相同标识。

| `WorkspaceIsolationLease` 字段 | 含义 |
|---|---|
| `id`、`sessionId` | 提供方签发的租约标识及独占该租约的 Session。 |
| `sourcePath`、`checkoutPath` | 规范化的已注册工作区目录，以及托管 worktree 内的 Session cwd。 |
| `branch` | 提供方拥有的分支，在回收检出目录后保留。 |
| `phase` | `WorkspaceIsolationPhase`：`active` 或 `hibernated`；休眠保留分支但不保留目录。 |
| `reviewState` | `WorkspaceIsolationReviewState`：`none` 或 `branch-retained`，后者持久标记清理时保留的未合并工作。 |
| `baseBranch`、`baseHead` | 来源分支名称及创建时的提交。 |
| `head` | 提供方已知的最新检查点提交。 |
| `createdAt`、`updatedAt` | ISO-8601 创建时间及最近一次成功生命周期转换时间。 |

`EnsureWorkspaceIsolationRequest` 携带 `sessionId`、已注册的 `sourcePath`，以及用于提供方工作的可选 `signal`。`ensure` 返回活跃租约；`acquire` 还返回带有 `lease` 和幂等 `release()` 回调的 `WorkspaceIsolationReservation`。预留保护该租约免于休眠、清理和容量回收，直到消费方停止工作并释放保护。

对于托管 Session，注册表会在规范成员资格检查前通过 `workspaceIsolation.sourceFor` 解析 header 中的确切 `(sessionId, cwd)`。属于该租约的检出路径映射到已注册的来源目录；无关路径返回 `undefined`。不可变的 Session cwd 仍是检出路径。

### 检查与比较

检查结果将实时检出状态与持久化租约阶段分开。评审结果区分相对当前基准分支的分歧，以及租约创建以来的变更。

| 类型 | 字段与语义 |
|---|---|
| `WorkspaceIsolationCheckoutState` | `absent`、`clean` 或 `dirty`，描述当前检出的可用性与干净程度。 |
| `WorkspaceIsolationFileChange` | `kind`、相对仓库的 `path`，以及重命名或复制时可选的 `previousPath`。 |
| `WorkspaceIsolationFileChangeKind` | `added`、`modified`、`deleted`、`renamed`、`copied`、`type-changed`、`unmerged`、`untracked` 或 `other`。 |
| `WorkspaceIsolationInspection` | 分离的 `lease` 快照、`checkoutState`、当前 `branchHead`、活跃的 `workingTreeChanges` 和 `hasUntrackedFiles`。检查不会变更租约。 |
| `WorkspaceIsolationCommit` | 提交 `id` 和提交消息首行 `summary`。 |

`WorkspaceIsolationComparison` 包含分离的 `lease` 快照及以下评审字段：

| 字段 | 比较含义 |
|---|---|
| `targetHead`、`branchHead` | 当前基准分支与托管分支的提交。 |
| `ahead`、`behind` | 当前基准分支缺少的托管分支提交数，以及托管分支缺少的基准分支提交数。 |
| `commits` | `baseHead` 之后的 `WorkspaceIsolationCommit` 值，最早的在前。 |
| `changedFiles` | 比较产生的 `WorkspaceIsolationFileChange` 值，以及活跃的未跟踪路径。 |
| `patch`、`patchTruncated` | 相对创建提交 `baseHead` 的补丁，以及是否超出提供方输出限制。 |
| `includesWorkingTree`、`hasUntrackedFiles` | 是否包含活跃检出中已跟踪的内容，以及是否存在内容未纳入补丁的未跟踪文件。 |

`WorkspaceIsolationPatch` 包含 `leaseId`、安全的建议下载名 `fileName`、有界且完整的补丁 `content`、`includesWorkingTree` 和 `hasUntrackedFiles`。比较补丁被截断时，Git 提供方会拒绝导出；未跟踪文件标志仍会报告省略的内容。`WorkspaceIsolationIntegrationResult` 包含休眠后的 `lease`、接收变更的 `targetBranch`，以及合并或 cherry-pick 到干净来源检出后得到的 `targetHead`。

### 安全清理与失败

`WorkspaceIsolationTeardownResult` 区分已确认删除与保留工作。清理仅接受提供方签发的租约标识。

| `status` | 字段与结果 |
|---|---|
| `removed` | `leaseId`；检出、分支和持久租约均已删除。 |
| `review` | 休眠的 `lease` 与 `reason: 'unmerged-branch'`；检出已回收，分支与持久租约仍保留以供评审。 |

`WorkspaceIsolationError` 携带 `WorkspaceIsolationErrorCode`：`UNAVAILABLE`、`NOT_REPOSITORY`、`SOURCE_DIRTY`、`LEASE_CONFLICT`、`LEASE_BUSY`、`CAPACITY` 或 `COMMAND_FAILED`。在 [Git 提供方](../../packages/workspace/workspace-isolation-git/README.zh.md) 中，存活的所属 Agent 或预留会让租约保持忙碌；清理会保留未合并分支并设定 `reviewState: 'branch-retained'`。

`GitWorkspaceIsolationRecord` 声明在[提供方记录 schema](../../packages/workspace/workspace-isolation-git/src/spec.ts) 中，存储租约字段，以及 `repositoryPath` 和整个 worktree 的 `checkoutRoot`。持久 `leases` 表以 Session id 为键，公共清理操作仍使用品牌化租约 id。

## Worktree Tasks

`ctx.worktreeTask` 上的 `WorktreeTaskService` 管理具名任务及其专用分支、检出和绑定 Session。[`worktree-task/src/types.ts`](../../packages/workspace/worktree-task/src/types.ts) 声明 `WorktreeTaskId`、`WorktreeTaskStatus`、`WorktreeTask` 以及下列请求和结果类型；[服务定义](../../packages/workspace/worktree-task/src/index.ts) 声明操作与失败。

| `WorktreeTask` 字段 | 含义 |
|---|---|
| `id`、`name` | 品牌化的 `WorktreeTaskId` 与任务显示名称。 |
| `workspaceId`、`sourcePath` | 关联的工作区标识与来源目录。 |
| `baseRef`、`branch`、`checkoutPath` | 创建引用、托管任务分支，以及供绑定 Session 使用的检出目录。 |
| `status` | `WorktreeTaskStatus`：`active` 有检出；`hibernated` 保留分支但不保留检出；`archived` 已回收检出，允许审查和安全删除。 |
| `cleanupReceipt` | 可选的持久清理 claim 或结算；未结算 claim 阻止修改，成功 cleanup 阻止重新开展 Session 工作。 |
| `linkedIssue` | 可选的关联 issue URL。 |
| `sessionIds` | 绑定到该任务的 Session。 |
| `createdAt`、`updatedAt` | 创建与最近一次变更的时间戳。 |

| 类型 | 字段与语义 |
|---|---|
| `CreateTaskRequest` | `name`、`workspaceId`、`sourcePath`、可选的 `baseRef` 和可选的 `linkedIssue`；创建活跃任务。 |
| `ActivateTaskRequest` | `taskId`；恢复任务检出。 |
| `HibernateTaskRequest` | `taskId`；回收检出并保留分支，不执行 cleanup。 |
| `ArchiveTaskRequest` | `taskId`；执行捕获的 cleanup、建立检查点并回收检出。 |
| `DeleteTaskRequest` | `taskId`；通过 cleanup 归档，再请求安全删除分支。 |
| `BindSessionRequest` | `taskId` 和 `sessionId`；将 Session 绑定到任务检出。 |
| `BindSessionResult` | 更新后的 `task` 及授予 Session 的 `checkoutPath`。 |
| `DeleteTaskResult` | `deleted`、可选的 `retainedBranch` 和可选的 `cleanupReceipt`；未合并分支返回 `deleted: false`，保持已归档且可审查。 |
| `WorktreeTaskHook` | 可执行文件与分离的字面 `args`；shell 解释要求显式选择 shell。 |
| `WorktreeTaskDefaults` | 供未来任务使用的相对 `defaultDirectory`、`baseRef` 以及可为 null 的 `setup`/`cleanup` 程序。 |
| `WorktreeTaskSettings` | 默认值 `value`、当前 `revision` 和部署拥有的 `managedRoot`。 |
| `UpdateWorktreeTaskSettingsRequest` | 完整默认值 `value` 与 `expectedRevision`；过期写入被拒绝，不执行程序。 |
| `WorktreeTaskReview` | `taskId`、`baseHead`、`head`、`checkoutRoot`、`dirty`、已跟踪 `patch`、未跟踪文件名、捕获的程序和可选的 `cleanupReceipt`；有界读取，不激活任务。 |
| `WorktreeTaskCleanupReceipt` | 捕获的 `hook`、请求的 `operation`（`archive` 或 `delete`）、`startedAt` 和 `status`；只有已结算的 `succeeded`/`failed` 收据包含 `finishedAt`，`running` 也代表未知结果。 |

存在绑定 Session 时不能休眠、归档或删除任务。`WorktreeTaskError` 携带 `code`、`message` 和可选的 `context`；其 `WorktreeTaskErrorCode` 为 `unavailable`、`not-found`、`busy`、`conflict`、`invalid-workspace`、`invalid-path`、`git-failed` 或 `operation-failed`。查询未知任务会拒绝，而非返回空任务。

`GitWorktreeTaskRecord` 声明在 [Git 任务记录 schema](../../packages/workspace/worktree-task-git/src/spec.ts) 中，存储任务字段，以及 `repositoryPath`、`checkoutRoot`、`baseBranch`、`baseHead`、检查点 `head` 和可选的已捕获 `launch` 默认值。持久 `tasks` 表与独立的 `cleanup_receipts` 表都以任务 id 为键；收据在任务记录删除后保留。[Git 任务 Provider](../../packages/workspace/worktree-task-git/README.zh.md) 负责执行、结算、检出与分支生命周期细节。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxdirectorypickercontroller--directorypickercontroller"></a>

### `ctx.directoryPickerController` — `DirectoryPickerController`

Host service backing the generated `ctx.remote.directoryPicker` namespace. The seam it exports is abstract and therefore never a Loader entry of its own, so this controller carries the wire verbs: one composed backend serves either the native chooser or the browse primitives, and a verb the composition cannot serve is refused rather than approximated.

```ts cordis-catalog
/**
 * Open the host's OS chooser for a Remote caller.
 * @param signal - caller lifetime; abort terminates the chooser.
 * @returns the chosen absolute path, or null when the operator cancels.
 */
@Remote('pick') async pick(signal: AbortSignal): Promise<string | null>

/**
 * List one directory level for a Remote caller's in-app browser.
 * @param path - absolute directory to list; absent lists the home directory.
 * @param signal - caller lifetime; abort stops the backend's scan instead of
 *   letting it outlive a disconnected caller.
 * @returns the level's listing with its ancestry.
 */
@Remote('list') async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing>

/**
 * Create one child directory for a Remote caller's in-app browser.
 * @param path - absolute existing parent directory.
 * @param name - single non-blank path segment.
 * @returns the created directory's absolute path.
 */
@Remote('createDirectory') async createDirectory(path: string, name: string): Promise<string>
```

Source: [`packages/api/workspace-controller/src/directory-picker.ts`](../../packages/api/workspace-controller/src/directory-picker.ts)

<a id="ctxworkspacecontroller--workspacecontroller"></a>

### `ctx.workspaceController` — `WorkspaceController`

Host service backing the generated `ctx.remote.workspace` namespace.

```ts cordis-catalog
/**
 * Create or idempotently resolve one Workspace over an existing directory.
 * @param request - directory path to register.
 * @returns the Workspace and whether this call created it.
 */
@Remote('create') create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue>

/**
 * Rename one Workspace to a unique non-blank title.
 * @param request - Workspace identity and proposed title.
 * @returns the updated Workspace projection.
 */
@Remote('rename') rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue>

/**
 * Remove one Workspace registration while retaining files and Sessions.
 * @param request - Workspace identity to remove.
 * @returns deletion confirmation.
 */
@Remote('delete') delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue>

/**
 * Move one Workspace within the registry display order.
 * @param request - moved Workspace and optional anchor.
 * @returns the complete resulting Workspace order.
 */
@Remote('insertBefore') insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue>

/**
 * Move one accounted Session within a Workspace.
 * @param request - Workspace, Session, and optional anchor identities.
 * @returns the updated Workspace projection.
 */
@Remote('insertSessionBefore') insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue>

/**
 * Hide one known Session from Workspace grouping surfaces.
 * @param request - Session identity to archive.
 * @returns the complete resulting archive set.
 */
@Remote('archiveSession') archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue>

/**
 * Stream a complete Workspace baseline followed by ordered increments.
 * @param signal - generation cancellation.
 * @returns baseline followed by ordered Workspace increments.
 */
@Remote({ mode: 'stream' }) follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame>
```

Source: [`packages/api/workspace-controller/src/index.ts`](../../packages/api/workspace-controller/src/index.ts)

<a id="ctxworkspacefiles--workspacefiles"></a>

### `ctx.workspaceFiles` — `WorkspaceFiles`

Host Remote service over the composed filesystem, confined to one workspace.

```ts cordis-catalog
/**
 * Read one page of lines from a UTF-8 text file inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the line window; omitted fields take the page defaults.
 * @param signal - caller cancellation.
 * @returns the page, the file's version at the stat before it, and whether it reaches the last line.
 */
@Remote async read(agent: Agent, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>

/**
 * Read one byte window of a regular file inside the Agent's workspace: raw
 * bytes, no text decoding and no binary rejection.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param range - the byte window; omitted fields take the window defaults.
 * @param signal - caller cancellation.
 * @returns the window in base64, the file's version and size at the stat before it, and whether it reaches the last byte.
 */
@Remote async readBytes(agent: Agent, path: string, range: WorkspaceByteRange, signal: AbortSignal): Promise<WorkspaceFileBytes>

/**
 * Report one regular file's identity, version, and size without its content.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the file's absolute path, current version, and byte size.
 */
@Remote async stat(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFileStat>

/**
 * List the direct children of one directory inside the Agent's workspace.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param path - workspace path, absolute or relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the directory's children in the backend's stable name order, bounded by the entry cap.
 */
@Remote async list(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>

/**
 * Stream every `fs/observed` observation of a file inside the Agent's
 * workspace. Only Agent filesystem operations report here; the OS is not
 * watched.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @param signal - generation cancellation.
 * @returns `ready` once the Host observation queue is active and the workspace
 *   root is resolved, then queued and live observations in emission order.
 */
@Remote({ mode: 'stream' }) changes(agent: Agent, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
```

Types: [Agent](core.zh.md)

Source: [`packages/api/workspace-files/src/index.ts`](../../packages/api/workspace-files/src/index.ts)

<a id="ctxworkspaceisolation--workspaceisolation-abstract-seam"></a>

### `ctx.workspaceIsolation` — `WorkspaceIsolation` (abstract seam)

Provider-neutral lease service. Providers alone choose checkout paths and accept cleanup by lease id; Consumers cannot submit a deletion path.

```ts cordis-catalog
/**
 * Create or reactivate the Session's lease.
 * @param request - Session identity, registered source directory, and cancellation.
 * @returns the active lease whose checkoutPath is ready for Session use.
 */
abstract ensure(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationLease>

/**
 * Create or reactivate a lease and protect it atomically for an asynchronous consumer.
 * @param request - Lease owner, source directory, and cancellation during acquisition.
 * @returns the active lease and an idempotent release callback; release only after work stops.
 */
abstract acquire(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationReservation>

/**
 * Reactivate an existing lease by provider-issued identity.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns the active lease whose checkoutPath is ready for Session use.
 */
abstract activate( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationLease>

/**
 * Checkpoint one inactive checkout and reclaim its directory while retaining its branch.
 * @param leaseId - Provider-issued lease identity.
 * @returns the hibernated lease after the directory is removed.
 */
abstract hibernate(leaseId: WorkspaceIsolationLeaseId): Promise<WorkspaceIsolationLease>

/**
 * Inspect checkout ownership and working-tree state without changing the lease.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns current checkout and managed-branch state.
 */
abstract inspect( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationInspection>

/**
 * Compare one managed branch and active checkout with its base branch.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns bounded commits, changed paths, and patch text.
 */
abstract compare( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationComparison>

/**
 * Merge one managed branch into its clean source checkout and hibernate the lease.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns resulting base-branch commit and retained lease.
 */
abstract merge( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationIntegrationResult>

/**
 * Cherry-pick the managed branch's linear commits into its clean source checkout.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns resulting base-branch commit and retained lease.
 */
abstract cherryPick( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationIntegrationResult>

/**
 * Export one complete bounded patch without accepting a browser-supplied path.
 * @param leaseId - Provider-issued lease identity.
 * @param signal - Optional cancellation for provider work.
 * @returns patch content and omission metadata.
 */
abstract exportPatch( leaseId: WorkspaceIsolationLeaseId, signal?: AbortSignal, ): Promise<WorkspaceIsolationPatch>

/**
 * Reclaim one managed checkout and delete its branch only after safe integration.
 * @param leaseId - Provider-issued lease identity.
 * @returns removal acknowledgement or a retained branch requiring review.
 */
abstract teardown(leaseId: WorkspaceIsolationLeaseId): Promise<WorkspaceIsolationTeardownResult>

/**
 * Clean up provider-detected orphaned worktrees within the repositories in scope.
 * Providers may limit discovery to repositories represented by durable lease records.
 * @returns the count of orphaned worktrees removed.
 */
abstract pruneOrphans(): Promise<number>

/**
 * Find the lease owned by a Session without filesystem work.
 * @param sessionId - Session identity.
 * @returns the current lease snapshot, or undefined when the Session is shared.
 */
abstract find(sessionId: SessionId): WorkspaceIsolationLease | undefined

/**
 * Verify that an exact Session cwd belongs to its managed lease and return
 * the registered source directory used for Workspace membership.
 * @param sessionId - Session identity from the immutable header.
 * @param cwd - Exact cwd from the same header.
 * @returns the source directory, or undefined for an unrelated path.
 */
abstract sourceFor(sessionId: SessionId, cwd: string): string | undefined

/**
 * List detached snapshots of every provider-owned lease.
 * @returns all current lease snapshots.
 */
abstract list(): readonly WorkspaceIsolationLease[]
```

Types: [SessionId](core.zh.md)

Source: [`packages/workspace/workspace-isolation/src/index.ts`](../../packages/workspace/workspace-isolation/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The fully qualified
 * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
 * non-directory path rejects. Repeated calls for the same canonical path
 * return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in a fully qualified path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in a fully qualified spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

Types: [SessionId](core.zh.md)

Source: [`packages/workspace/workspace/src/index.ts`](../../packages/workspace/workspace/src/index.ts)

<a id="ctxworktreetask--worktreetaskservice-abstract-seam"></a>

### `ctx.worktreeTask` — `WorktreeTaskService` (abstract seam)

Abstract Worktree Task service. Providers create Git worktrees, manage branch lifecycle, bind sessions, and persist task state.

```ts cordis-catalog
/**
 * Create a new task with a dedicated branch and worktree checkout.
 * @param request - Task name, workspace, source path, and optional base ref.
 * @param requestSignal - Cancels queued work and setup; process settlement precedes checkout rollback.
 * @returns The created task in active status.
 * @throws WorktreeTaskError when workspace is invalid or Git operation fails.
 */
abstract create(request: CreateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * List all tasks managed by this provider.
 * @returns All task records.
 */
abstract list(): WorktreeTask[]

/**
 * Get one task by id.
 * @param taskId - Task identifier.
 * @returns The task record.
 * @throws WorktreeTaskError with code 'not-found' when unknown.
 */
abstract get(taskId: WorktreeTaskId): WorktreeTask

/**
 * Read the defaults captured by future task creation.
 * @returns The durable defaults and their revision.
 */
abstract settings(): WorktreeTaskSettings

/**
 * Replace defaults without running hooks or modifying existing task launch facts.
 * @param request - Complete defaults and the revision observed by the editor.
 * @param requestSignal - Cancels queued work before the settings write.
 * @returns the persisted defaults and their new revision.
 */
abstract updateSettings(request: UpdateWorktreeTaskSettingsRequest, requestSignal?: AbortSignal): Promise<WorktreeTaskSettings>

/**
 * Read tracked changes against the captured base and list untracked paths without mutating Git.
 * @param taskId - Provider-issued task identity.
 * @param requestSignal - Cancellation of queued and active read work.
 * @returns the complete review; exceeding the provider's byte bound rejects.
 */
abstract review(taskId: WorktreeTaskId, requestSignal?: AbortSignal): Promise<WorktreeTaskReview>

/**
 * Bind a session to an active task, granting it the checkout path.
 * @param request - Task and session identifiers.
 * @param requestSignal - Cancels queued work before binding the Session.
 * @returns The updated task and checkout path.
 * @throws WorktreeTaskError when task is not active or binding fails.
 */
abstract bindSession(request: BindSessionRequest, requestSignal?: AbortSignal): Promise<BindSessionResult>

/**
 * Unbind a session from a task.
 * @param taskId - Task identifier.
 * @param sessionId - Session identifier.
 * @param requestSignal - Cancels queued work before removing the binding.
 * @returns The updated task.
 * @throws WorktreeTaskError with code 'not-found' when unknown.
 */
abstract unbindSession(taskId: WorktreeTaskId, sessionId: SessionId, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Find the task bound to a session, if any.
 * @param sessionId - Session identifier.
 * @returns The bound task, or undefined.
 */
abstract findForSession(sessionId: SessionId): WorktreeTask | undefined

/**
 * Activate a hibernated task by restoring its worktree.
 * @param request - Task identifier.
 * @param requestSignal - Cancels queued work and checkout restoration.
 * @returns The task in active status.
 * @throws WorktreeTaskError when task is not hibernated or checkout fails.
 */
abstract activate(request: ActivateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Hibernate an active task by removing its worktree while retaining the branch.
 * @param request - Task identifier.
 * @param requestSignal - Cancels queued work and checkpoint commands.
 * @returns The task in hibernated status.
 * @throws WorktreeTaskError with code 'busy' when sessions are bound.
 */
abstract hibernate(request: HibernateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Run captured cleanup, then checkpoint and archive the task. Successful cleanup is never rerun.
 * Failed cleanup retains the checkout; an unsettled durable claim requires manual review before further mutation.
 * @param request - Task identifier; repeating after a settled failure explicitly retries cleanup.
 * @param requestSignal - Cancellation forwarded to queued work and subprocesses; settlement is awaited.
 * @returns The archived task and any cleanup receipt.
 * @throws WorktreeTaskError when sessions are bound, cleanup fails, or its previous outcome is unknown.
 */
abstract archive(request: ArchiveTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

/**
 * Archive through the cleanup lifecycle, then delete only an integrated task branch.
 * Cleanup receipts survive task deletion. An unmerged branch and its archived record remain reviewable.
 * @param request - Task identifier; repeating after a settled failure explicitly retries cleanup.
 * @param requestSignal - Cancellation forwarded to queued work and subprocesses; settlement is awaited.
 * @returns Deletion or retained-branch result and any cleanup receipt.
 * @throws WorktreeTaskError when sessions are bound, cleanup fails, or its previous outcome is unknown.
 */
abstract delete(request: DeleteTaskRequest, requestSignal?: AbortSignal): Promise<DeleteTaskResult>
```

Types: [SessionId](core.zh.md)

Source: [`packages/workspace/worktree-task/src/index.ts`](../../packages/workspace/worktree-task/src/index.ts)
<!-- END GENERATED cordis-surface -->
