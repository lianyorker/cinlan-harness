# 工作树会话归属迁移计划（项目 → 工作区 → 会话）

> 范围：只规划，不实现。参考 Orca / ThinkRail：一个项目下有 1 个 main 工作区和 N 个 worktree 工作区，每个工作区挂自己的会话。
> 依据规则：.devin/rules/Cinlan Harness Fork 边界与同步规则（窄 fork + 宽插件）.md。注意：这个文件在工作树和 HEAD 里都是 0 字节（git log 显示 0554f2f396 合并时被清空），正文只在历史提交 c8ee66dfa9 里还在（用 git show 读取）。本计划按那份正文执行，第 2 节"禁止在官方拥有的 packages/*/src 里散落写 Cinlan 逻辑"是主要约束。实施前请先把规则文件恢复（另开一个提交）。
> **决策记录（2026-10-31）**：方案已定为 **B'**（方案 B 的改良版）。父子关系放在 fork 自己的 domain 里；客户端父级提示通过官方已有的 uiWorkspace service 新增一个 registerParentHints 方法传递，不再新建 workspace-hierarchy 包。理由见 2.2 节。

## 0. 实施进度（2026-10-31，阶段 1 已收尾）

下表是阶段 1 收尾后的真实状态。接手阶段 2 前先 `git status` 核对。

| 项 | 状态 | 位置 / 证据 |
|---|---|---|
| 阶段 0 | ✅ | 方案 B' 已定；规则文件正文已恢复到工作树（未提交） |
| 1a. worktree-task 事件 | ✅ 已写 | packages/workspace/worktree-task/src/types.ts 新增 `WorktreeTaskTransition`、`WorktreeTaskChange`；src/index.ts 在 `Events` 上声明 `'worktree-task/changed'`（**@mode emit**，不是原稿的 parallel：provider 不等待 listener，listener 不得抛错） |
| 1b. worktree-task-git 发事件 | ✅ 已写 + 已测 | packages/workspace/worktree-task-git/src/index.ts 新增私有 `announce()`，在 create、bindSession、unbindSession、activateRecord（两处）、hibernateRecord、archiveRecord、delete 每次持久化之后调用；tests/git-worktree-task.spec.ts 新增 'transition events' 2 项：每个生命周期操作各发一次正确 transition（archive 会先经内部 hibernate 多发一次 'hibernated'，这是已提交行为），失败路径（非法 sparsePaths 的 create、bind 到 archived task）不发 |
| 1c. Host 桥接包 | ✅ 核心已写 | 新包 packages/workspace/worktree-task-workspace（package.json、tsconfig.json、src/{index,spec,types}.ts）。Service `ctx.worktreeTaskWorkspaces`，inject `['storageDomain','workspaceRegistry','sessionPersistence']`（worktreeTask 用 `ctx.get` 可选读取）；domain `worktree_task_workspaces` v1 表 `links`；公开 `links()`、`settled()`；链接变化发 `'worktree-task-workspaces/changed'`（@mode emit），供阶段 2 的 stream 订阅 |
| 1d. 桥接包测试 | ✅ 11 项通过 | tests/worktree-task-workspace.spec.ts：真实 WorkspaceRegistry + storage-domain，覆盖注册与改标题、按 id/按路径解析父级、无父级、保留已有标题、目录不存在跳过、一次性补账、bound 无会话头只记日志、休眠/归档/删除保留链接、用户删除工作区后投影过滤、启动时扫描 active task；另加 tests/worktree-task-workspace.composition.spec.ts REAL-composition（Loader 启动 cordis.yml：真实 worktree-task-git + workspace registry + session-persistence-jsonl + 桥接包，仅存储后端用测试内存池；create 后出现标题为 task.name 的 Workspace，bindSession 后 cwd=checkoutPath 的真实会话 attach 成功） |
| 1e. 注册 | ✅ 完成 | tsconfig.base.json 加了 3 条 paths；tsconfig.host.json 加了 reference；已 `pnpm install --offline` 链接；bundle/cinlan-web 的 cordis.patch.yml 在 worktree-task-git 行后加 worktree-task-workspace 行 + package.json 加 workspace:* 依赖；`tsc -b` 对 worktree-task-workspace、worktree-task-git、worktree-task、cinlan-web 通过；verify-cordis-config 对本包无违规（现存失败均为其他会话既有问题：inspector、tool-ralph、session-query-sqlite、session-title、security-research preset、apps/cli acp profile） |
| 1f. 文档 | ✅ 完成 | README.md / README.zh.md / README.i18n.yaml（`pnpm run verify-translation-pairing --write` 已记录，含 Model Experience 无直接影响和已知限制） |
| 阶段 3 | ✅ 已写（2026-10-31 第二会话） | 官方 ui-workspace 通用扩展点（方案 B'，见 2.4 节）：navigation.ts 新增 `UiWorkspace.registerParentHints` + UiWorkspaceService 合并 observable（后注册优先、快照身份稳定、注册/撤销都通知）；contract/slots.ts 新增 `sidebar.workspaces.group.trailing`（list/root/inline，owner `{ workspaceId, path }`）和 `parentHints` hooks 成员；index.ts 声明 children 并把合并 observable 注入 browser hooks（`useParentHints`）；tree.ts 新增纯函数 `resolveWorkspaceParents`；WorkspaceBrowser.tsx 的 parents 改用它（显式提示在 workspace 模式也生效，flat 不变，显式子分组按 createdAt 升序且不可拖拽）；Rows.tsx 的 ProjectRowItem 标题后渲染 trailing slot；ui-paired-shell 存根补空 disposer。测试：tree.client.spec（resolveWorkspaceParents 4 例）、workspace-browser.client.spec（嵌套/排序/禁拖/trailing slot 4 例）、workspaces-service.client.spec（合并/后注册优先/撤销恢复/快照身份/HMR 撤销 4 例）三文件 299 项全过；另补了该 spec 里另一会话遗漏的 `SessionDeleteTarget` 类型导入。**未跑**：`DSH_SNAPSHOT=replay pnpm run test:web` —— build gate 被既有失败阻塞（host bundle 在 automation-controller 的 tsdown 路径解析报错 + host aggregate check 的其他会话 WIP tsc 报错，均与本次改动无关）；`verify-client-ui-i18n` 报 ui-primitives/DisclosureRow.tsx:120 硬编码文案（其他会话在途文件，非 2.7 清单）。test:gui 全量有 91 个失败文件，均在未碰的包（ui-cinlan-design、ui-settings-*、ui-sidebar* 等，其他会话在途）；ui-workspace + ui-paired-shell 两包内除 ui-workspace-isolation（不在清单）和 ui-paired-shell composition（还原本改动后仍失败，既有）外全绿 |
| 阶段 2 | ✅ 完成（2026-10-31 第三会话） | packages/api/worktree-task-controller 新增 @Remote({ mode: 'stream' }) followWorkspaceLinks（baseline + changed 帧，每次都是完整 link 集合；link 含 task 的 name/status/linkedIssue，被删 task 的链接保留但无 task 信息）；build-remote-contracts 已跑（生成物在 gitignored 的 lib/）；liveshare endpoint-classification 归类 owner-only；tests/controller.spec.ts 新增 4 项（无桥接 unavailable、快照+变更+取消、被删 task 链接、预取消），9 项全过；tsc -b 通过；verify-cordis-config 对本包无违规 |
| 阶段 4 | ✅ 完成（2026-10-31 第四会话） | ui-worktree-task：inject 加 'uiWorkspace'；新 links.ts 订阅 followWorkspaceLinks，投影为身份稳定的 links/parents 两个 snapshot store（内容不变保持引用，stream 失败清空）；ctx.effect 里 registerParentHints + 'sidebar.workspaces.group.trailing' 注册 TaskGroupBadge（状态徽标/linkedIssue 外链/Review/hibernated 激活）+ 'shell.overlay' 注册 WorktreeTaskReviewOverlay（headless Modal 包 WorktreeReviewPanel），一个 effect 统一撤销；文案复用现有 locales key（未加新 key）；样式用 --dsw-* token。测试：links.client.spec 4 项、TaskGroupBadge.client.spec 3 项、apply.client.spec 增注册/撤销 1 项，4 文件 27 项全过；单包 tsc -p 通过。**阻塞项（均非本次改动）**：tsc -b 拉进 ui-chat 其他会话 WIP 报错；verify-client-ui-i18n 报 ui-primitives/DisclosureRow.tsx:120（其他会话在途）；test:gui 全量被其他包既有失败阻塞，本包 4 文件全绿；test:web 被既有 build gate 失败阻塞（同阶段 3 记录）；2.6 第 1–4 条的浏览器手动验证未跑（依赖 test:web build） |
| 阶段 5 | ✅ 完成（2026-10-31 第四会话；已收窄，见 2.7） | roster.ts：worktree 模式保存 createdTask.checkoutPath，startActivation request 条件加 cwd（inherit 不变）；subagent 包配套：childSessionMeta 新增 explicitCwd 参数；manager.ts **仅当 request 显式给 cwd 时**才传解析后的 cwd——显式指定则会话头持久化真实 cwd（可从 session log 重建），未指定则维持官方行为、继续继承父会话头 cwd。测试：team.spec.ts 'validates workspaceMode...' 断言 teammate 会话头 cwd === '/mock/worktrees/team-wt-worker'，通过；working-directory.spec.ts 新增/修正两例（不传 cwd 会话头继承父头、显式 cwd 进会话头且无多余目录转换事件），6 例全过；顺带修复 agent-loop-testkit 重复挂载 workingDirectory 的合并残留（此前因此无法执行的本包 9 个测试现全过）和 team.spec.ts 其他会话 WIP 的可执行性。快照：**无需更新**——snapshots/session/team-* 与 sdk/subagent-* 的会话头 cwd 均已规范化为 {{cwd}} token。subagent 包测试全绿（subagent-dsh-sdk 1 例失败为无 dsh 可执行文件的环境问题、tool-subagent 10 例为其他会话在途文件既有失败，均与本次无关） |

2026-11-05 定向复核：ui-workspace 与 ui-worktree-task 的 6 个 focused 测试文件共 313 项通过；worktree-task-workspace 与 worktree-task-controller 的 3 个测试文件共 20 项通过；对应 Client、Host 包级 TypeScript 检查通过。已按 Playwright 1.61.1 安装 Chromium revision 1228，并在最新 `build:artifacts` 产物上复测：`settings-worktree-tasks.e2e.ts` 的 9 项通过；`workspace-management.e2e.ts` 通过 8/18，剩余 10 项集中在旧 locator（`WorkSpace` 与 `Workspace Tree` 的非 exact 匹配）、hover 测试找不到 `Account menu`、父级 Workspace 状态前置条件和 fixture inventory 漂移。它们已记录为测试基线/场景验收待收口，不据此修改工作区产品逻辑。扩大到 `agent-team` 的整组测试时出现多项当前在途用例失败与长时间等待，已停止该运行，不作为本功能的通过证据。

2026-11-07 定向复验：在当前构建产物上运行 `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/workspace-management.e2e.ts`，17 项通过；运行同一命令并指定 `apps/web/tests/settings-worktree-tasks.e2e.ts`，1 项通过。前一轮 workspace-management 旧 locator、父级 Workspace 前置条件和 fixture inventory 问题不再复现；本次未重跑完整 `test:web` 构建门禁或 `agent-team` 全组测试。

实现与原稿的差异（已在下文 2.3 节同步）：事件用 emit 而非 parallel；桥接包不把 worktreeTask 列为必需 inject；`bound` 时会话头还不存在（agent-team 先 bind 后建会话）只记 debug 日志，不报错；补账候选 = task.sessionIds ∪ 会话头 cwd 规范化后等于 checkout 的会话，跳过已被其他工作区入账的会话。

## 1. 当前状态

### 1.1 归属判定（决定哪些文件能动）

用 git log upstream/master -- <dir> 核对过：

| 包 | 归属 | 证据 |
|---|---|---|
| packages/workspace/workspace | 官方 | upstream 最近提交 00d541438b release(dsh): 0.2.2-alpha.2 |
| packages/client/ui-workspace | 官方 | upstream 最近提交 9dce789696 |
| packages/api/workspace-controller、session-controller | 官方 | 同上（WorkspaceView、session.create 属于上游） |
| packages/workspace/worktree-task、worktree-task-git | Fork 自有 | upstream/master 下没有这些目录，提交只有 b0bfd28b27、d53da71b93、6f22033ea7（LiamYorker） |
| packages/api/worktree-task-controller、packages/client/ui-worktree-task | Fork 自有 | 同上 |
| packages/experimental/agent-team | Fork 自有 | 官方功能差距对比.md 第三节，列为"我们独有" |

### 1.2 DSH 已有基件

- Workspace 实体：attachSession 会把会话头里的 cwd 做 realpath，再和 workspace.path 严格比较，不相等就拒绝（packages/workspace/workspace/src/entity.ts:110-150，比较逻辑在 :139-144）。这是隔离保证，**本计划不改这段代码**。
- Registry.create 按规范路径去重，重复调用会返回已有实体（packages/workspace/workspace/src/index.ts:580-583）；目录必须已经存在（index.ts:258-262）；新记录插到注册顺序最前面（index.ts:630）；默认标题取路径最后一段（index.ts:585）。
- 会话创建：如果 session.create 带了 workspaceId，cwd 就用 workspace.path，并自动 attachSession（packages/api/session-controller/src/commands.ts:108-140，其中 :116 和 :130-140）。
- 按目录加入工作区的先例：schedule 用 resolveByPath(cwd)?.attachSession(...)，失败只记日志（packages/schedule/schedule/src/runtime.ts:481-490）。
- WorktreeTask：create 会建 branch 和 checkout（packages/workspace/worktree-task-git/src/index.ts:252-389），有 active/hibernated/archived 三态，review 和 merge 接口都齐（packages/workspace/worktree-task/src/index.ts:73-196）。
- 客户端树：deriveGroups 输出平铺的 workspace 分组，末尾有 UNGROUPED 兜底（packages/client/ui-workspace/src/client/tree.ts:325-367、:427-460）。**嵌套不在 deriveGroups 里**，而在 WorkspaceBrowser 里：先按路径包含关系算出 parents（WorkspaceBrowser.tsx:347-355），再用 childrenByParent 递归渲染（WorkspaceBrowser.tsx:448-477）。这个嵌套只在 groupBy === 'workspace-tree' 时开启（WorkspaceBrowser.tsx:1410；默认 groupBy 是 'workspace'，见 stores.ts:18、:93）。
- 可以挂载的 UI：WorktreeReviewPanel 和 WorktreeTaskSection 已经存在，但 ui-worktree-task 目前只注册了设置页的 section（packages/client/ui-worktree-task/src/client/index.ts:55-91），而且只在 loopback 下启用（:29）。右侧栏另有一个 Tasks 标签页（packages/client/ui-right-sidebar/src/client/index.tsx:44-46）。

### 1.3 已知差距逐条核验

**差距 1：bindSession 只在 task 记录上记 sessionIds，attachSession 会拒绝，于是会话掉进 UNGROUPED。结论：部分成立，需要修正前提。**

- 成立的部分：bindSession 只写 task.sessionIds（worktree-task-git/src/index.ts:726-751），provider 没有注入 workspaceRegistry（:177 static inject = ['storageDomain', 'subprocess']）。
- 前提不准的部分：唯一调用 bindSession 的生产代码是 agent-team。它在会话**还没创建**时就先 bind（packages/experimental/agent-team/src/roster.ts:424-428），随后调用 startActivation 时**没有传 cwd**（roster.ts:429-438）。因此子会话的 cwd 继承父会话：subagent manager 回退到父会话的有效目录（packages/subagent/subagent/src/manager.ts:525-528），会话头的 cwd 也拷自父会话（child-agent.ts:144）。另外这些会话的 origin 是 'subagent'（child-agent.ts:150），树本来就不显示它们（tree.ts:235）。所以 teammate 并没有掉进 UNGROUPED，而是作为父会话的子代理出现。真正的问题更大：worktree 模式下的 teammate **实际上并没有在 worktree 里工作**。
- 真正会掉进 UNGROUPED 的路径：普通会话用 cwd: checkoutPath 创建、但不带 workspaceId（commands.ts:116，此时没有 attach），然后在 tree.ts:352-365 被归入 stray，落到 UNGROUPED。
- 方案影响："bindSession 顺带 attachSession"行不通，因为 bind 时会话头还不存在，readSessionHeader 会抛错（workspace/src/index.ts:931-946）。attach 只能放在会话已经创建、cwd 已经确定之后。

**差距 2：模型里没有"项目"这一层，workspace 是平铺的，main 和 worktree 也没有 kind 区分。结论：成立。**

- WorkspaceRecord 只有 path、title、sessionIds、createdAt、updatedAt 五个字段（workspace/src/spec.ts:24-30）；WorkspaceView 同样只有这几个（packages/api/workspace-controller/src/types.ts:18-30）；注册顺序是单一的平铺数组（spec.ts:57-65）。
- 补充一点：UI 已经有"按工作区树"模式，但只按路径包含关系嵌套（tree.ts:628-640 owningParentFolder），没有显式的父子关系。

**差距 3：task checkout 没有对应的 Workspace 记录，父子关系连不上。结论：成立。**

- create 只把 task 记录写进自己的 domain（worktree-task-git/src/index.ts:336-371），不会碰 workspace registry。
- checkoutRoot = managedRoot/<taskId>（index.ts:318-319），managedRoot 默认是 ~/.clh/worktree-tasks/v1（index.ts:202）。这个路径不在源仓库路径下面，所以 owningParentFolder 的路径包含判断永远匹配不上。

### 1.4 核验中新发现、会影响设计的事实

1. **重启时所有 active task 都会被 hibernate**（worktree-task-git/src/index.ts:238-249），checkout 目录被删掉（hibernate 走 git worktree remove，见 :954、:982）。而 registry.create 要求目录存在（workspace/src/index.ts:258-262）。所以"在 list 时惰性补建"对重启后的 task 一律失败。补建只能挂在 activate 或 bind 上，因为只有那时目录会被重建（activateRecord 在 :934 重新 worktree add 同一个 checkoutRoot，见 :962）。
2. **candidateMatches 只负责过滤已经入账的会话，不会发现新会话**：getter 和 mutate 都只对 record.sessionIds 做 filter（entity.ts:102-104、:207-210；index.ts:205）。从历史会话自动建账的 bootstrap 只在 registry 首次初始化时跑一次（index.ts:228-231）。所以推荐设计里"补建后已掉 UNGROUPED 的会话会自动归位"不会发生，补建时必须显式 attach。
3. **task.workspaceId 不一定是真的 Workspace**：agent-team 传的是伪造的 ws-${root.id}（roster.ts:382），provider 原样存储，不做校验（worktree-task-git/src/index.ts:339）。父工作区必须先按 id 查 registry，查不到再按 sourcePath 用 resolveByPath 查（workspace/src/index.ts:572-578）。
4. **默认标题会是 uuid**：checkoutPath 的最后一段是 taskId 或 sourceRelative（index.ts:319、:325），标题必须显式改成 task.name。
5. **新注册的工作区会被插到最前面**（workspace/src/index.ts:630）。如果不嵌套，task 工作区会挤到列表顶部。
6. **checkout 被删掉后，会话的账仍然保留**：会话 cwd 遇到 ENOENT 时，已入账的成员不会被剔除（workspace/src/types.ts:89-100、index.ts:894-897）。所以 hibernate 不会把已归位的会话踢回 UNGROUPED。
7. **持久化路径会剥掉未知字段**：feed.ts:37-38 用 workspaceRecord.parse 投影，zod 的 object 默认 strip。给官方 WorkspaceRecord 加字段，至少要同时改 spec.ts、feed.ts:26-35、types.ts:18-30，还要做 persistence 类型确认（docs/cookbook/reviewing-persistence-type-changes.md）。
8. **客户端跨插件边界**：feature plugin 之间不能 runtime 互相 import，跨包 UI 必须走 slot（packages/client/AGENTS.md "Export discipline" 第 3 条）。ui-workspace 目前没有 workspace 分组行的 slot（ui-workspace/src/client/index.ts:338-347 只声明了 directoryFlow 和会话行相关的 slot），所以 ui-workspace 不能直接引用 WorktreeReviewPanel。

## 2. 迁移目标

### 2.1 目标

1. 侧边栏会话树显示三层：**项目（main 工作区）→ 工作区（main 本身 + 它派生的 worktree task 工作区）→ 会话**。main 排在前面，task 按 createdAt 升序排列。
2. task 工作区的分组行显示状态徽标（active / hibernated / archived）、linkedIssue 链接和 Review 入口（WorktreeReviewPanel）。
3. 在 task 工作区里新建的会话，cwd = checkoutPath，经由已有的 attachSession 校验正常入账，不再掉进 UNGROUPED。
4. 官方包只做与 Cinlan 无关的通用扩展点改动，所有 Cinlan 业务语义都放在 fork 自有包里。

### 2.2 推荐设计逐条核对

| # | 推荐项 | 结论 | 理由 / 调整 |
|---|---|---|---|
| 1 | WorkspaceRecord 加 parentWorkspaceId + taskId | **调整** | 这样会改官方 spec.ts、feed.ts、types.ts 和持久化类型（见 1.4 第 7 条）；taskId 是 Cinlan 语义，违反规则第 2 节。改为由 fork 新包自己维护一张 domain 表 links（WorkspaceId → { parentWorkspaceId?, taskId, createdAt }），同样是零迁移，也不碰官方 schema。 |
| 2 | task create 时为 checkoutPath 注册 Workspace | **采纳并扩展** | 放在 fork 桥接插件里做，task 提交成功后（create 和 activate 两个时点都做）调用 registry.create(checkoutPath) 再 setTitle(task.name)。attachSession 的 cwd 校验因此自然通过，实体层零改动。 |
| 3 | bindSession 顺带 attachSession | **调整** | bind 时会话可能还没创建（见 1.3 差距 1）。改为三条路径：(a) 普通会话走 session.create({ workspaceId: taskWorkspaceId })，官方逻辑会自动 attach（commands.ts:130-140）；(b) 收到 bound 事件且会话头已存在时，桥接插件尝试 attach，失败只 warn（按 schedule 先例）；(c) 修复 agent-team，给 startActivation 传 cwd: checkoutPath。 |
| 4 | deriveGroups 升级为 project 桶 | **调整** | 嵌套本来就在 WorkspaceBrowser 的 parents/childrenByParent 里，deriveGroups 不需要改。官方侧只加两个通用点：①parents 合并"显式父级提示"；②分组行加 trailing slot。徽标、linkedIssue、Review 入口由 ui-worktree-task 通过 slot 渲染。 |
| 5 | 存量 task 在 list/bind 时惰性补建；靠 candidateMatches 归位 | **调整** | 重启后 task 都处于 hibernated、目录不存在，所以补建改挂在 activate、bind 和 active 状态的 list 上；归位要显式 attach（见 1.4 第 1、2 条）。 |
| 6 | deriveSearchResults / deriveFlat 不动 | **采纳** | 搜索结果显示的工作区标签来自 workspace.title（tree.ts:548-555），桥接插件已把标题改成 task.name，所以搜索结果会显示任务名。 |

**已选方案 B'，以及与其他方案的比较：**

| 方案 | Host 侧父子关系 | 客户端父级通道 | 官方改动 | 新增包 | 结论 |
|---|---|---|---|---|---|
| A'（官方加字段） | 官方 WorkspaceRecord/WorkspaceView 加可选 parentWorkspaceId | 跟随 WorkspaceView | spec.ts、feed.ts、controller types.ts 加持久化类型确认，再加 ui-workspace | 1（Host 桥接） | 否：官方持久化 schema 分叉，每次同步上游都有冲突风险 |
| B（原稿） | fork domain links | 新建客户端 service 包 workspace-hierarchy | ui-workspace 5 个文件 | 2（Host 桥接 + 客户端静态包） | 否：新扩展机制需要仲裁，ui-workspace 还要 type-import fork 包 |
| **B'（采用）** | fork domain links | 官方已有的 uiWorkspace service 新增 registerParentHints(source) | ui-workspace 6 个文件 + ui-paired-shell 存根 1 个 | 1（Host 桥接） | **是**：复用已有 service；官方改动都是通用能力，可以提给上游；不碰任何持久化 schema |

B' 用到的事实：uiWorkspace 是官方客户端 Cordis service（packages/client/ui-workspace/src/client/navigation.ts:40-161，声明在 :163-168），已经被 ui-sidebar、ui-schedule、ui-subagent、ui-conversation 等十多个插件 inject，所以加一个方法只是扩展已有的 service。被否决的通道是 ctx.slots.provideRoot 加 GlobalStandardProps：hook 名必须全局唯一（ui-renderer/src/client/registry.ts:306-329），而且没有"可选标准 prop"的先例。如果提供方在 HMR 时卸载，组件里条件调用 hook 会违反 React 的 hook 调用顺序。ui-paired-shell 实现了 UiWorkspace 的只读存根（ui-paired-shell/src/client/workspaces.ts:12），需要补一个返回空 disposer 的 registerParentHints。

**被否决的方案**：把 checkout 放到源仓库目录下（例如 <repo>/.worktrees/<id>），让路径嵌套自动生效。否决原因：managedRoot 是全局单根（index.ts:202、:603-618）；checkout 会出现在主仓库的 git status 和全文搜索结果里。

### 2.3 数据层改动（全部在 fork 自有包）

1. **worktree-task Service Definition 增加提交后事件**（packages/workspace/worktree-task/src/index.ts）：'worktree-task/changed'，@mode emit，payload 为 WorktreeTaskChange = { transition: 'created' | 'activated' | 'bound' | 'unbound' | 'hibernated' | 'archived' | 'deleted'; task: WorktreeTask; sessionId?: SessionId }。worktree-task-git 在每次 table.put 或 delete **成功之后**同步发出（packages/AGENTS.md：状态只在提交点发布）；provider 不等待 listener，listener 不得抛错，异步工作由 listener 自己排队并记录失败。✅ 已实现
2. **新建 Host 包 packages/workspace/worktree-task-workspace**（@deepseek-ai/dsh-worktree-task-workspace），自带完整的 capability seam：
   - Service ctx.worktreeTaskWorkspaces，inject 为 ['storageDomain', 'workspaceRegistry', 'sessionPersistence']；worktreeTask 通过 ctx.get 可选读取（启动时扫描 active task）。✅ 已实现
   - Domain worktree_task_workspaces v1，表 links：WorkspaceId → { taskId, parentWorkspaceId?, createdAt, backfilledAt? }，用 zod 在持久化边界校验。
   - ensure(task)：在单一的操作队列里串行执行。先确认 checkout 目录存在（不存在直接返回，不报错）→ registry.create(task.checkoutPath) → 如果是新建记录，setTitle(task.name) → 解析父级：registry.get(task.workspaceId) 存在且路径等于 realpath(sourcePath) 就用它，否则用 resolveByPath(task.sourcePath)，再找不到就不写 parentWorkspaceId → 写 links → 如果 backfilledAt 为空，执行一次补账（见 2.5）并写入 backfilledAt。
   - 事件处理：created / activated 调 ensure；bound 先 ensure，再在会话头存在时 attachSession(sessionId)，失败只 warn；hibernated / archived / deleted **保留** Workspace 注册和 link，这样会话仍有归属，目录状态显示为 missing-dir。删除注册统一交给用户，通过官方"删除工作区"操作完成，日志会保留。
   - 只读接口：links()（过滤掉已被用户删除的工作区；父工作区被删时不带 parentWorkspaceId）、settled()（等待队列清空，测试和 controller 用）；链接变化发 'worktree-task-workspaces/changed'（@mode emit）。✅ 已实现
3. **Remote 投影**：在 worktree-task-controller（fork）上新增 @Remote({ mode: 'stream' }) followWorkspaceLinks，帧里包含 links 和对应 task 的 { status, linkedIssue, name }（写法参考官方 workspace-controller/src/index.ts:211-218 的 stream）。改完运行 pnpm tsx scripts/build-remote-contracts.ts；同时在 packages/experimental/liveshare/src/endpoint-classification.ts:396 附近给新端点归类为 owner-only。
4. **agent-team cwd 修复**（packages/experimental/agent-team/src/roster.ts:429-438）：worktree 模式下给 startActivation 的 request 传 cwd: createdTask.checkoutPath。teammate 的工作目录会因此变化，这是 model-visible 的行为变化（cwd 会进入环境上下文），必须同步更新 agent-team 相关的录制快照，并确认 cwd 可以从 session log 重建（子会话头的 cwd 和 working-directory 事件，见 manager.ts:892-894）。
5. **不改动**：workspace 实体、spec、registry；session-controller；attachSession 校验。本计划不新增 model-visible 输入（第 4 条只是改变已有 cwd 的取值）。

### 2.4 UI 层改动

**官方 ui-workspace（只做通用扩展点，不含任何 task 语义）：**

1. contract/slots.ts 新增 slot 'sidebar.workspaces.group.trailing'：{ kind: 'list'; scope: 'root'; inline: true; owner: { workspaceId: WorkspaceId; path: string } }，并在 index.ts:341-347 的 children 里声明；在 Rows.tsx 的 ProjectRowItem 标题之后渲染（WorkspaceBrowser.tsx:550-558 是它的调用点）。
2. 显式父级提示：在 UiWorkspace 接口（navigation.ts:40）上新增 registerParentHints(source: HostObservable<ReadonlyMap<WorkspaceId, WorkspaceId>>): () => void。UiWorkspaceService 合并所有已注册的 source（后注册的优先），对外是一个身份稳定的合并 observable。ui-workspace 在注册 sidebar.workspaces 时，通过 inject 的 hooks compartment 把它暴露为 parentHints，组件里一律调用 useParentHints，不存在条件调用 hook 的问题；没人注册时它就是一个空 Map。WorkspaceBrowser.tsx:347-355 的 parents 改成：先取显式提示，再在 'workspace-tree' 模式下补上路径包含关系。显式提示在 'workspace' 模式下同样生效，因为提示表达的是归属关系，不是显示偏好；'flat' 模式不变。
3. 有显式提示的子分组按 createdAt 升序排列（父分组本来就先于子分组渲染，所以 main 自然排在前面），而且不可拖拽重排，因为 commitWorkspaceDrag（WorkspaceBrowser.tsx:426-447）改的是全局顺序，对它们没有意义。
4. 把纯函数 resolveWorkspaceParents(workspaces, hints, nestByPath) 抽到 tree.ts，供单元测试使用。deriveGroups、deriveFlat、deriveSearchResults 的签名和行为都不变。
5. 这一步只是给已有的 uiWorkspace service 加方法，属于已有 Cordis service 的扩展，不是新的框架扩展点（packages/client/AGENTS.md "Data-access ladder"）。ui-paired-shell 的只读存根同步补上 registerParentHints（返回空 disposer）。

**Fork 自有：**

1. 不新建客户端包。ui-worktree-task 的 inject 加上 'uiWorkspace'。
2. ui-worktree-task 增加以下注册（放在 ctx.effect / slots.inject 里，HMR 可撤销）：
   - 订阅 followWorkspaceLinks，把 links 转成 ReadonlyMap<WorkspaceId, WorkspaceId> 的 observable（快照身份稳定），在 ctx.effect 里调用 ctx.uiWorkspace.registerParentHints(source)。
   - 向 'sidebar.workspaces.group.trailing' 注册 TaskGroupBadge：状态徽标、linkedIssue 外链、Review 按钮（打开 WorktreeReviewPanel，用 shell.overlay 弹出，或跳转到设置页锚点 worktree-task-records）；hibernated 状态额外显示"激活"按钮，因为在目录不存在的工作区里新建会话会失败。
   - 所有文案进 locales.ts（zh 和 en），样式只用 --dsw-* token。
3. 官方分组行自带的"新建会话"按钮在 task 工作区里可以直接使用（会走 session.create({ workspaceId })）。这样建出来的会话属于 Workspace 账，但不写入 task.sessionIds，也就不会阻止 hibernate。这个语义差异要写进 README 的已知限制。
4. WorkspacePicker 会把 task 工作区也列出来，第一期接受这个现状。

### 2.5 存量迁移

- 启动时**不做**全量回填（用户要求如此；而且重启后 checkout 目录都不存在，回填也做不了）。
- 触发时点：升级后某个 task 第一次 create、activate 或 bind，以及 controller 在 list 时遇到 active 状态的 task → 调用 ensure。
- 每个 link 只补账一次（以 backfilledAt 标记）：先对 task.sessionIds 中会话头已存在的逐个 attach；再扫描 sessionPersistence.list() 的会话头，找出 realpath(cwd) === checkoutPath 且尚未被任何 Workspace 入账的会话，逐个 attach（registry 的 validateStoredState 要求一个会话只有一个归属，见 index.ts:833-854）。attach 失败只 warn，继续处理下一个。
- 已经 archived 或 deleted 的 task：checkout 已不存在，补建不了，原有会话继续留在 UNGROUPED，写入已知限制。
- agent-team 修复之前创建的 teammate：cwd 等于父会话的 cwd，继续按 subagent 挂在父会话下，不迁移。
- 回滚：卸载桥接插件后，task Workspace 退化为普通顶层工作区，links 表成为无害的孤立数据；官方 schema 没有被改过。

### 2.6 验收标准

1. 新建 task 后，侧边栏出现以下结构，且 task 工作区标题是 task.name：

~~~text
my-repo（main）
├─ 会话 A
└─ task: fix-login  [active] #123  [Review]
   └─ 会话 B（cwd = checkoutPath）
~~~

2. 在 task 分组行上点"新建会话"：会话成功创建，attachSession 不报错，会话出现在 task 分组下，不在 UNGROUPED。
3. 重启 Host 后 task 变成 hibernated：已归位的会话仍在原分组，徽标显示 hibernated；点"激活"后目录恢复，可以继续新建会话。
4. 存量 task 第一次 activate 后：之前在 UNGROUPED、cwd 等于 checkoutPath 的会话移到 task 分组下。
5. 搜索和单列表模式的输出和改动前一致（tree.client.spec.ts 中 deriveFlat 和 deriveSearchResults 的用例不需要修改）。
6. git diff 里 workspace/src/entity.ts 没有任何改动；官方文件的改动只在 2.7 清单之内。
7. agent-team worktree 模式下，teammate 的 cwd 等于 checkoutPath，快照已更新。
8. 检查项：focused 单元测试、pnpm run test:gui、DSH_SNAPSHOT=replay pnpm run test:web、pnpm run typecheck、pnpm run verify-client-ui-i18n、pnpm tsx scripts/build-remote-contracts.ts 之后无 diff 残留，以及桥接插件的 REAL-composition 测试（按 packages/AGENTS.md 要求，用 Loader 启动测试用 cordis.yml）。

#### 2.6 验收结果回填（2026-10-31）

| 条 | 结果 | 证据 / 原因 |
|---|---|---|
| 1. 侧边栏结构 + 标题 = task.name | 部分验证 | 标题：阶段 1 REAL-composition 测试验证（create 后出现标题为 task.name 的 Workspace）；完整侧边栏结构需浏览器手动验证，未跑（test:web build gate 被既有失败阻塞，见下） |
| 2. task 分组行新建会话 | 未跑 | 依赖浏览器手动验证；同上阻塞。attachSession 路径已由阶段 1 composition 测试覆盖（cwd=checkoutPath 的会话 attach 成功） |
| 3. 重启后 hibernated 徽标 + 激活 | 部分验证 | 单元层：桥接包测试覆盖休眠/归档/删除保留链接；badge 组件测试覆盖 hibernated 状态与激活按钮；端到端未跑（同上阻塞） |
| 4. 存量 task activate 后补账 | 部分验证 | 桥接包测试覆盖一次性补账；端到端未跑（同上阻塞） |
| 5. 搜索/单列表不变 | ✅ | 阶段 3 的 tree.client.spec 等 299 项全过，deriveFlat/deriveSearchResults 用例未改 |
| 6. entity.ts 无改动 | ✅ | git status 无 packages/workspace/workspace 改动；官方文件改动均在 2.7 清单内 |
| 7. teammate cwd = checkoutPath | ✅ | team.spec.ts 断言会话头 cwd === checkoutPath 通过；快照无需更新（所有相关快照 cwd 已 token 化为 {{cwd}}） |
| 8. 检查项 | 部分完成 | focused 单测全过（各包见第 0 节）；REAL-composition 过；build-remote-contracts 已跑（阶段 2）；**test:gui** 全量被其他包既有失败阻塞（91 个失败文件均在未碰的包），ui-worktree-task 4 文件 27 项全绿；**test:web** 被既有 build gate 失败阻塞（host bundle automation-controller tsdown 路径解析 + 其他会话 WIP tsc，均非本次改动）；**typecheck** 单包通过，tsc -b 全局被 ui-chat 其他会话 WIP 阻塞；**verify-client-ui-i18n** 报 ui-primitives/DisclosureRow.tsx:120 硬编码文案（其他会话在途文件，非 2.7 清单） |

### 2.7 官方文件改动清单（PR 说明必须原样列出）

| 文件 | 改动 | 能否提给上游 |
|---|---|---|
| packages/client/ui-workspace/src/client/contract/slots.ts | 新增 'sidebar.workspaces.group.trailing'、parentHints 类型 | 可以，通用扩展点 |
| packages/client/ui-workspace/src/client/index.ts | 声明 slot children；把合并后的 parentHints 放进 sidebar.workspaces 注册的 inject hooks | 可以 |
| packages/client/ui-workspace/src/client/navigation.ts | UiWorkspace 新增 registerParentHints，UiWorkspaceService 负责合并 | 可以，通用能力 |
| packages/client/ui-paired-shell/src/client/workspaces.ts | 只读存根补上 registerParentHints（返回空 disposer） | 可以 |
| packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx | parents 合并显式提示；显式子分组排序且不可拖拽 | 可以 |
| packages/client/ui-workspace/src/client/rows/Rows.tsx | ProjectRowItem 渲染 trailing slot | 可以 |
| packages/client/ui-workspace/src/client/tree.ts | 新增纯函数 resolveWorkspaceParents | 可以 |
| packages/client/ui-workspace/tests/*.client.spec.ts | 对应的测试 | 可以 |
| packages/subagent/subagent/src/child-agent.ts | childSessionMeta 新增 explicitCwd 参数 | 可以，作为 bug 修复：显式指定的子代理 cwd 应持久化到会话头，否则无法从 session log 重建 |
| packages/subagent/subagent/src/manager.ts | 仅当 request 显式给 cwd 时把解析后的 cwd 传给 childSessionMeta | 可以，作为 bug 修复：显式指定的子代理 cwd 应持久化到会话头，否则无法从 session log 重建 |

## 3. 实施阶段

### 阶段 0：仲裁与前置 ✅
- ✅ 方案已定为 B'（2026-10-31，见 2.2 节）。
- ✅ .devin/rules 规则文件的正文已从 c8ee66dfa9 恢复到工作树（还没提交，需要单独提交）。
- 跑 git status 盘点在途文件，只记录，不处理不认识的在途文件。

### 阶段 1：task 事件 + Host 桥接包 ✅ 完成（见第 0 节）
- worktree-task 加 'worktree-task/changed' 事件，worktree-task-git 在提交后发出，配套单元测试。
- 新建 worktree-task-workspace 包：domain、ensure、事件处理、补账，以及 README 和 README.zh.md；加入 bundle/cinlan-web 的 cordis.patch.yml（参照 :11 的 worktree-task-git 条目）和 package.json。
- 写 REAL-composition 测试：create → 生成 Workspace 记录；用 workspaceId 创建会话 → attach 成功。

### 阶段 2：Remote 投影
- worktree-task-controller 加 followWorkspaceLinks stream，运行 build-remote-contracts，完成 liveshare 端点归类。

### 阶段 3：官方 ui-workspace 通用扩展点 ✅（2026-10-31 完成；test:web 被既有 build gate 失败阻塞，见第 0 节）
- 按 2.4 的官方部分实现（依赖阶段 0 的仲裁结果），测试覆盖 parents 合并、排序、禁止拖拽、slot 渲染。

### 阶段 4：Fork 客户端
- ui-worktree-task 通过 ctx.uiWorkspace.registerParentHints 注册父级提示，并注册 TaskGroupBadge，接入 Review 和激活入口，补上 locales。

### 阶段 5：agent-team cwd 修复 + 收口
- 修 roster 的 cwd，更新快照；在 docs/dev/里程碑.md 更新状态；写一份 Agent Note 记录"关系放在 fork domain、不改官方 WorkspaceRecord"的决策。

## 4. 可直接粘贴的执行提示词

### 阶段 0（已完成，留作记录）

~~~text
阶段 0 已完成：方案定为 B'（见 plan.md 2.2 节），规则文件正文已恢复到工作树。剩下的事：
1. 核对 .devin/rules/Cinlan Harness Fork 边界与同步规则（窄 fork + 宽插件）.md 和 git show c8ee66dfa9 的版本一致，单独提交（提交信息：docs(rules): restore fork boundary rules emptied by upstream merge）。
2. 跑 git status，列出在途文件，不碰任何不认识的文件。不写业务代码。
~~~

### 阶段 1（续做）

~~~text
按 docs/dev/工作树会话归属/plan.md 收尾阶段 1。先读第 0 节"实施进度"，用 git status 核对其中列出的文件都在；不碰其他在途改动，遵守 .devin/rules 窄 fork 规则，禁止改 packages/workspace/workspace（尤其 src/entity.ts 的 attachSession 校验）。
已完成、不要重写：worktree-task 的 'worktree-task/changed' 事件（@mode emit）、worktree-task-git 的 announce() 发事件、新包 packages/workspace/worktree-task-workspace（源码 + 10 项测试）、tsconfig.base.json paths 和 tsconfig.host.json reference。
剩余：
1. packages/bundle/cinlan-web/cordis.patch.yml 在 worktree-task-git 行之后加 { id: worktree-task-workspace, name: '@deepseek-ai/dsh-worktree-task-workspace' }，package.json 加 workspace:* 依赖；跑 pnpm run verify-cordis-config。
2. 给新包写 README.md、README.zh.md，生成 README.i18n.yaml（pnpm run verify-translation-pairing --write packages/workspace/worktree-task-workspace/README.md），参照 worktree-task-git 的三件套结构，含 Model Experience（无直接模型影响）和 Known Limitations（archived/deleted task 的会话无法补建；bound 时会话头不存在不会入账；task 工作区会出现在 WorkspacePicker 里）。
3. worktree-task-git 补测试：create/bind/unbind/activate/hibernate/archive/delete 各发一次正确 transition 的事件，失败路径不发。
4. 写一个用 Loader 启动测试 cordis.yml 的 REAL-composition 测试：真实 worktree-task-git + workspace registry + 桥接包，create 后出现标题为 task.name 的 Workspace，用 session.create({workspaceId}) 或直接建 cwd=checkoutPath 的会话后 attach 成功。
5. 环境注意：本机 typecheck 要用 Node 24（D:\CodeTools\nvm\v24.9.0），tsx/esbuild 在 DSH 沙箱内会 spawn EPERM，需在沙箱外跑。
跑 focused 测试和 tsc -b 相关包，然后更新 plan.md 第 0 节和里程碑.md 第 13 行。
~~~

### 阶段 2

~~~text
按 docs/dev/工作树会话归属/plan.md 2.3 节第 3 条实施阶段 2。
- 在 packages/api/worktree-task-controller 新增 @Remote({ mode: 'stream' }) followWorkspaceLinks：首帧是快照，之后是变更帧，内容为 links 加对应 task 的 status、linkedIssue、name。写法参照 packages/api/workspace-controller/src/index.ts 的 stream。
- 运行 pnpm tsx scripts/build-remote-contracts.ts，并提交生成物。
- 在 packages/experimental/liveshare/src/endpoint-classification.ts 给新端点归类为 owner-only。
- 补 controller 测试（取消、无 provider、快照和变更顺序）。跑 focused 测试和 typecheck。
~~~

### 阶段 3

~~~text
按 docs/dev/工作树会话归属/plan.md 2.4 节"官方 ui-workspace"部分实施阶段 3。这些是官方文件，只允许改 2.7 节清单里的文件，而且不能写任何 worktree 或 task 语义。
- contract/slots.ts 新增 'sidebar.workspaces.group.trailing'（list、root、inline，owner 为 { workspaceId, path }），在 index.ts 的 sidebar.workspaces children 里声明，在 Rows.tsx 的 ProjectRowItem 里渲染。
- 在 navigation.ts 的 UiWorkspace 上新增 registerParentHints(source) 并返回 disposer，UiWorkspaceService 把各 source 合并成一个身份稳定的 observable；ui-paired-shell/src/client/workspaces.ts 的只读存根同步补上；把合并结果放进 sidebar.workspaces 注册的 inject hooks，名为 parentHints；tree.ts 新增纯函数 resolveWorkspaceParents(workspaces, hints, nestByPath)；WorkspaceBrowser.tsx 的 parents 改成"显式提示优先，路径包含只在 workspace-tree 模式补充"，显式提示在 workspace 模式下也生效；有显式提示的子分组按 createdAt 升序且不可拖拽。
- deriveGroups、deriveFlat、deriveSearchResults 保持不变，已有用例不改。
- 新增 client spec，然后跑 pnpm run test:gui、DSH_SNAPSHOT=replay pnpm run test:web。
~~~

### 阶段 4

~~~text
按 docs/dev/工作树会话归属/plan.md 2.4 节"Fork 自有"部分实施阶段 4，遵守 packages/client/AGENTS.md：不跨插件 runtime import，UI 只走 slot，组件里不碰 ctx。
- 不新建客户端包。ui-worktree-task 的 inject 加上 'uiWorkspace'，订阅 followWorkspaceLinks，生成一个快照身份稳定的 ReadonlyMap observable，在 ctx.effect 里调用 ctx.uiWorkspace.registerParentHints(source)；向 'sidebar.workspaces.group.trailing' 注册 TaskGroupBadge（状态徽标、linkedIssue 外链、Review 按钮打开 WorktreeReviewPanel，hibernated 状态显示激活按钮），全部放在 ctx.slots.inject 里。
- 所有文案进 locales.ts（zh 和 en），样式只用 --dsw-* token；补 HMR 撤销测试和组件测试。
- 跑 pnpm run test:gui、pnpm run verify-client-ui-i18n、DSH_SNAPSHOT=replay pnpm run test:web，然后用 pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml 手动验证 plan 2.6 第 1 到 4 条。
~~~

### 阶段 5

~~~text
按 docs/dev/工作树会话归属/plan.md 2.3 节第 4 条实施阶段 5 并收口。
- packages/experimental/agent-team/src/roster.ts：worktree 模式下给 startActivation 的 request 传 cwd: createdTask.checkoutPath；补测试，断言 teammate 会话头的 cwd 等于 checkoutPath；按 snapshots/AGENTS.md 更新受影响的录制快照，并确认 cwd 可以从 session log 重建。
- 写一份 Agent Note，记录"父子关系放在 fork domain、不改官方 WorkspaceRecord"的决策和被否决的方案。
- 把 docs/dev/里程碑.md 第 13 行的状态改为完成，把 2.6 节验收结果回填到 plan.md。
- 用 dsh-pre-push-checks 选出检查项，只跑这些并汇报。
~~~
