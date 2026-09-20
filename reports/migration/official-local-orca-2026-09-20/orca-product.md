# Orca 核心产品三方审查（中文证据稿）

本稿比较 Orca 当前工作树、本地集成树与官方 dsh-v0.1.6-alpha.2，作为 main 同步后的主报告附件。结论来自真实源码、注册入口和发布配置静态检查；没有运行产品、构建、测试、外部 CLI 或网络服务，没有访问 Orca 用户数据。以下“已挂载”仅指源码中的默认装配链，不代表本机部署已经安装、启动或验收。

## 基线与证据口径

| 树 | 精确基线 | 工作树说明 |
|---|---|---|
| O：D:/Company/cinlan/orca | HEAD 9c192525aaca8ab82ac751999b863ece07138676；分支 codex/orca-refactor-upstream-sync | 初次采样 porcelain 330 条；审查对象为当前 worktree，不是纯 HEAD，不代表发布版本。package.json:3 的 1.4.181 只是当前清单版本。 |
| L：D:/Company/cinlan/cinlan-harness-upstream-016 | 最终代码提交与 main 均为 1c88551e2d0c27bbc8a208b91ee82e064c27d3ea | 初始审查读取尚未提交的集成工作树；其后格式／声明修正及完整集成已提交并快进 main。此附件的产品源码判断适用于该代码提交，不把初始763766ee当作集成结果。 |
| F：D:/Company/cinlan/deepseek-harness-reference-016 | HEAD ddefc45fbc7f8e46dd73185e68295696d1297887；exact tag dsh-v0.1.6-alpha.2 | dirty 0；只读。 |

路径前缀 O/L/F 对应以上绝对根目录，后缀为文件与 1-based 行号。S=源码实现存在；M=当前源码有默认入口/挂载；T=本轮实测。所有条目 T=未执行；“未发现”限于本稿列出的包、入口和检索范围，不能解释为任何可选部署绝无此能力。P0 表示应先解决的真实性/组合阻断，P1 表示主要产品差距，P2 表示后续增强；优先级不是已证实安全漏洞评级。

本次精确对比 HEAD 的代表性 O 文件中，src/main/index.ts、src/main/ipc/ai-vault.ts、src/main/ipc/register-core-handlers.ts、src/main/ipc/skills.ts、src/main/ipc/worktrees.ts 为 Git 状态 Modified（此处不使用能力挂载标记 M）；product-agent-policy、CLI core/orchestration spec、账号 service、hosted-review、github IPC、automation service、orchestration-runs/federated-worker-start、plugin-manifest、mcp-config、mobile/app/pair.tsx 在该次比对中与 HEAD 相同。工作树中其他文件仍可能修改；未逐文件将所有引用与 HEAD 比对。

## 核心事实矩阵（26 条）

### 多 Agent 与 CLI 管理

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 1 | O:src/shared/product-agent-policy.ts:3 把产品 TUI Agent 限定为 claude/codex/grok；O:src/shared/agent-kind.ts:7 映射这三种。不能把所有历史 TuiAgent 枚举都算为当前产品支持。S。 | L:packages/subagent/subagent-codex/src/index.ts:1 是 fresh app-server one-shot provider；:64 标记 NO_START_CAPABILITIES、不继承父上下文。S；本稿未证明其默认进入每个 preset。 | F:packages/subagent/subagent-codex/src/index.ts:1 已有同类外部 Codex provider，官方并非只能运行 DeepSeek。外部子任务 provider 与多品牌长期交互式 CLI 管理仍不同。 | P1：明确支持矩阵，分别验收外部一次性委派、长期 CLI 会话和原生 Harness Agent；不要从“支持 Codex”推出账号/终端/历史全覆盖。 |
| 2 | O:src/cli/specs/core.ts:87 的 worktree create 支持 agent/prompt/host/setup；:111 明确在现有 worktree 用 terminal create。O:src/main/runtime/rpc/methods/index.ts:55 默认汇入 TERMINAL_METHODS。S/M。 | L:packages/client/ui-better-sidebar/src/pty-manager.ts:1 实现按 sessionId:tabId 复用 node-pty、断线重连和有界输出环；不是空终端页面。S；装配需要侧栏插件。 | 官方有 subagent 与 terminal 基础，但本稿未验证官方具有 Orca 同等 public CLI terminal handle/项目管理协议。缺口是统一 Agent 进程身份、状态与项目归属，不能简单写“缺终端”。 | P1：围绕终端句柄、退出/取消、状态源与工作目录做一条公开 CLI 管理链；复用现有 PTY。 |
| 3 | O:src/cli/specs/core.ts:23 的 claude-teams 把 Claude Agent Teams 放入当前 Orca 终端，并以原生 splits 展示 teammates。S；实际外部 Claude 行为未测。 | L:packages/coordination/coordination/src/index.ts:50 是任务 DAG；L:packages/subagent/subagent-codex/src/index.ts:64 是子任务能力声明，不是 Claude 原生分屏管理。 | F:packages/bundle/base/cordis.patch.yml:335 有 spawn/fork/control 等子代理组合；不据此认定原生 Claude Teams pane 适配存在。 | P2：若用户明确需要外部 CLI Teams，再补 pane 适配；保留 Harness 自身委派语义。 |

### Worktree 与项目

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 4 | O:src/cli/specs/core.ts:87 创建 checkout、base、setup、父子 lineage、issue/comment、agent 启动；O:src/main/ipc/worktrees.ts:1809 注册业务 handlers。S/M。 | L:packages/workspace/worktree-task/src/index.ts:75 有创建；:120 有 Session 绑定；:145/154/164 有激活、休眠、cleanup 归档；:173 明确未合并分支保留。S。 | F:packages/workspace/workspace/src/index.ts:1 是持久 workspace/session membership；本稿在官方 workspace 组未发现 worktree-task 等价 provider。L 已有实质生命周期，不能写成完全没有 worktree。 | P1：补已存在服务到真实用户路径的接入与回归，不重造 Git 生命周期。 |
| 5 | O:src/cli/specs/core.ts:90/114 支持 project+host、project-host-setup；O:src/main/ipc/worktrees.ts:2048 对 folder workspace 作单独处理，:2144 路由 SSH Git provider。S/M。 | L:packages/execution-host/execution-host-targets/src/index.ts:100 保存 SSH alias；:155 connect，:231 inspectDirectory；L worktree-task 请求以本地 source/workspace 为核心。 | F workspace registry 与 SSH 传输均存在，但未见 Orca project↔多个 host setup↔folder/worktree 的同等产品模型。L 保存目标/探测目录不等于远端 Agent、FS、Git 全部绑定。 | P1：先定义统一项目/执行目标身份，校验所有动作在同一 host，不把连接成功当作远程开发完成。 |
| 6 | O CLI 和 IPC 具有实际入口，见 #4；不是仅声明数据类型。 | L:packages/client/ui-worktree-task/src/client/index.ts:27 注册 Settings；:28 只允许 loopback；:42 调真实 Remote。检索 packages/**/*.yml 与 apps/cli/**/*.ts 未找到非测试 worktree-task-git/ui-worktree-task 默认挂载。S；默认 M 未发现。 | 官方没有本地这组扩展的同等已查证默认链；本地 UI/service 存在不能据此报“默认可用”。用户自定义 profile 未查。 | P0：在发布对账先明确 profile/bundle owner、服务/controller/UI 闭包；有实际装配证据后才能标为 M。 |

### Git、PR、CI 与任务来源

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 7 | O:src/main/runtime/rpc/methods/index.ts:70 汇入 GIT_METHODS；hosted-review 先验证注册 repo/工作树，O:src/main/ipc/hosted-review.ts:124。S/M。 | L:packages/git/sidebar-git/src/index.ts:151 stage、:164 unstage、:202 checkout、:218 commit preview、:260 commit，:363 discard、:378 revert、:388 cherryPick；L:packages/bundle/web-app/cordis.patch.yml:165 默认挂载 sidebar-git/controller。S/M。 | L:packages/git/git/src/index.ts:13 的只读限制仅属于 model-facing Git seam，不能概括 sidebar-git。官方对应 GUI 操作本稿未独立逐项核实，本轮未独立核验。 | P0：纠正“本地只有只读 Git”的总括结论；P1：再核对 push/pull、冲突恢复、PR 接入，本稿未发现 sidebar-git 对应 push/pull 方法。 |
| 8 | O:src/main/ipc/hosted-review.ts:83 同时接受 GitHub/GitLab/Bitbucket/Azure DevOps/Gitea/Gitee 的 linked review；:124/151 有创建流程；O:src/main/ipc/register-core-handlers.ts:152 默认注册。S/M。 | L:packages/work-items/work-items-github/src/index.ts:183/185 显式过滤 pull_request；L:packages/git/sidebar-git/src/index.ts:281 是本地缓存 base 的 diff 对比。 | 官方 webhook/通用 shell 是否能被用户自行组合不构成同等 PR 产品 UI。L 尚未查到与 O 同级的 provider-neutral PR 创建/审阅链。 | P1：独立建立 hosted review service/controller/UI，先收敛一个 provider；不要把 issue 列表或 git diff 作为 PR 完成证明。 |
| 9 | O:src/main/ipc/github.ts:589 查询 checks，:925 mergePR，:1027 rerunPRChecks；:1045 传 headSha/failedOnly/prRepo 与 host 参数。S/M，经核心注册接入。 | L 的 sidebar-git 本地写操作、work-items issue provider 无上述 PR check/run 模型，分别见 #7/#8。 | 官方产品等价能力未查证；本稿不能把 Agent 可运行 gh 算为 UI 的 CI 归属、刷新、重跑、结果呈现。 | P1：绑定仓库、PR、head SHA 的 checks/重跑/merge 状态机与受控动作；先读后写逐阶段验收。 |
| 10 | O:src/main/ipc/register-core-handlers.ts:155/156 注册 Linear/Jira；O:src/main/runtime/rpc/methods/index.ts:74 至 :76 进入 RPC 聚合。S/M。 | L:packages/work-items/work-items-github/src/index.ts:191 归一化 issue 标识、标题、状态、仓库、labels/assignees；Work Items 是真实领域实现，但本稿未逐 provider 验收。S；bundle 可选性由总报告核对。 | 官方没有在本稿检查范围发现同等 work-items 包；外部 webhook 不等于交互任务管理。L 的任务能力应与 PR/CI 分开计分。 | P2：按真实使用 provider 做认证、分页、状态写入、worktree 链接验收，保留错误与来源身份。 |

### 账号池与用量

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 11 | O:src/main/codex-accounts/service.ts:285 至 :323 有 list/add/import/reauth/remove/select/按 target 选择；O:src/main/claude-accounts/service.ts:112 至 :150 同类生命周期。O:src/main/ipc/register-core-handlers.ts:145/149/150 注册 Codex/Claude/Grok。S/M，未读用户凭据。 | L:packages/credentials/credentials/src/index.ts:1 是 secret reference 与 provider storage；:63 为 scope/id key。本稿在 packages TS 未搜到 codexAccounts/claudeAccounts 同等 owner。 | F:packages/credentials/credentials/src/index.ts:1 已有凭据能力，但不能推出外部 CLI 多账号池、OAuth 登录流和 target 隔离。 | P1：显式设计外部 CLI 账号与 runtime home 生命周期；先明确是否需要等价产品，禁止自动导入 Orca 私有账号数据。 |
| 12 | O:src/main/codex-accounts/service.ts:326 有幂等 key、expected scope 的额度 reset；O:src/main/automations/service.ts:148 收集运行用量。S；Provider 服务未实测。 | L:packages/session-query/usage-query/src/index.ts:41 明确以 Session JSONL 为唯一统计来源；L:packages/bundle/web-app/cordis.patch.yml:171/443 挂 usage query/settings。S/M。 | 官方有 Session/凭据基础，当前本地汇总与 Orca 外部账号配额、账期、runtime target 的计量不同。不能写“本地没有使用统计”，也不能写“已迁账号统计”。 | P1：分开模型调用 token、外部 CLI 用量、账号限额三类来源，未知值保留为未知。 |

### AI Vault 与跨 Agent 历史

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 13 | O:src/main/ipc/ai-vault.ts:92 以 host scope/path/depth 建扫描键；:143 本地、:146 all-host；:16/:40 至 :45 接 SSH/runtime 扫描。O:src/main/ipc/register-core-handlers.ts:215 默认注册。S/M；该文件 worktree 已修改。 | L:packages/session-query/session-query/src/index.ts:1/90 为 Harness 会话历史、检索、trace；没有从名称相近的 session-query 推断外部 Claude/Codex/Grok 日志扫描。 | F:packages/session-query/session-query/src/index.ts:1 有同类 Harness history；未发现等价外部 Agent、多 Host AI Vault 的已查证 owner。 | P1：若保留此产品需求，增加独立只读 import/index provider 与来源身份，先做用户显式选择的目录。 |
| 14 | O:src/main/ipc/ai-vault.ts:309 注册 resume，:311 子代理历史，:318 delete 且接 session liveness；核心入口 :226 传本地 PTY 活跃性检查。S/M，不代表恢复/删除本轮通过。 | L:packages/session-query/session-query/src/index.ts:70 导出 cold log reader；L:packages/workspace/worktree-task/src/index.ts:120 绑定 Harness Session，不能恢复外部 CLI 原生 transcript。 | 官方 Session 恢复不等于外部 CLI resume；本稿未发现相等的外部历史恢复/删除闭环。 | P1：resume 先确认 provider、host、账号、workspace 和活动会话身份；删除单独验收，不能复用纯 UI 缓存清理。 |

### 移动与远程

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 15 | O:mobile/app/pair.tsx:7/22/32 是 Expo/React Native pairing route；O:src/main/runtime/rpc/methods/pairing.ts:7 暴露 getEndpoints/provisionRelay，聚合入口 index.ts:87 接入。S/M。 | L:packages/execution-host/execution-host-targets/src/index.ts:46 是 SSH 目标管理；不是手机配对、设备撤销或移动 app。 | 官方 Web/SDK/SSH 底层不等于手机 native app、配对、relay 生命周期；本稿未发现两者对等移动产品。 | P1：若移动是核心路线，先定义独立设备身份/配对/撤销与版本协商；Mobile Emulator 另计，不能拿 ADB 覆盖本项。 |
| 16 | O:src/main/ipc/worktrees.ts:2078/2144 按 SSH host 路由查询；O:src/main/runtime/rpc/methods/index.ts:77 默认汇入 SSH_METHODS。S/M。 | L:packages/execution-host/execution-host-targets/src/index.ts:65 开持久 domain，:100/118/137 增改删，:155 连接，:188 实际 inspect 后才 ready；web-app:150/153/156 与 :440 默认挂载 backend/controller/UI。S/M。 | 旧“SSH 只有暂存身份信息、未接入”已过时。但该管理服务已查到的是保存、连接、目录检查，不是所有 Agent/PTY/Git 远程路由。 | P0：更新旧报告；P1：以一个选中的 target 驱动统一 Session 执行链，再验收断连/切换。 |
| 17 | O 当前 worktree 对多 Host 有显式路径；兼容性证据见 #5/#16，平台运行未测。 | L 另有 packages/ssh/ssh 与 fs-ssh/subprocess-ssh/sandbox-ssh 组；不能只审本地新增 execution-host-targets。 | F:packages/ssh/ssh/src/index.ts:17 指定 host/node/helper/hash/workspace，:46 是不自动重连的 SSH session，:75 限 linux/darwin 客户端。官方确有远程执行底层，但不能推论 Windows SSH 路径已等价。 | P1：整合官方 provider 和本地目标管理，标明 POSIX 限制；Windows、远端 helper 版本与中断恢复单独验证。 |

### 自动化

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 18 | O:src/main/automations/service.ts:65 周期检查、:87 runNow；O:src/main/index.ts:2507 实例化，:1429/:3059 启动，桌面与 serve 路径均有代码。S/M。 | L:packages/automation/automation/src/index.ts:45 是同 Host profile 作业 owner；:79 持久存储/互斥 ownership，:124 创建，:136 revision 编辑，:167 幂等 requestId run。web-app:140/147/437 默认挂载。S/M。 | F:packages/bundle/web-app/cordis.patch.yml:329 至 :334 的 schedule UI 默认 disabled，不能与 L 持久 automation 混同。旧“本地只是 Session schedule”已过时。 | P0：纠正状态；P1：验收禁用创建、重启漏执行策略、幂等触发、取消和结果归属，而不是重新设计已有系统。 |
| 19 | O:src/main/automations/service.ts:96 scheduled precheck，:128 支持 SSH target；O:src/main/index.ts:2510 将远程计划归 serve，:2522 new_per_run 创建工作树。S/M。 | L:packages/automation/automation/src/index.ts:45 明确 no remote routing/replay queue，:95 对过期计划推进；不是远端调度系统，也不能假设执行所有错过的任务。 | 官方 schedule 是另一领域。真实差距在远端 ownership、任务工作树策略、precheck 与用量归属，不是简单定时器数量。 | P1：先完善本地明示语义；P2：按需求补远端调度与每次运行独立 worktree，保持明确 ownership。 |

### 编排

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 20 | O:src/cli/specs/orchestration.ts:7/12 明确 Run 是 namespace/inbox，不自动调度 worker；:80/110 是 FIFO delivery+ack/replay；O:src/main/runtime/rpc/methods/orchestration-runs.ts:50/55 实际写 DB。S/M。 | L:packages/coordination/coordination/src/index.ts:50 start DAG、:95 sendMessage、:107 approval；L:packages/coordination/coordination-local/src/index.ts:86 明确 in-memory，:101/102 为 maps。S。 | F base:335 已有子代理控制，不能说官方无多 Agent。L 内存 DAG 与 O 持久 Run/Dispatch/mailbox 语义不同；单次工作流成功不证明重启恢复。 | P1：明确要对齐哪些通信/恢复语义，优先 durable run/task/message/dispatch 身份与取消，而非复制命令名。 |
| 21 | O:src/main/runtime/rpc/methods/orchestration-federated-worker-start.ts:59 查询远端 status；:66/73 拒绝缺少 contract/federation capability；:92 创建 starting dispatch。主 RPC index.ts:60 接 orchestration。S/M。 | L:packages/coordination/coordination-local/src/index.ts:86 是本进程 scheduler；packages YAML 非测试未查到 coordination-local 默认挂载。execution-host-targets 的 inspect 不等于跨主机 worker dispatch。 | 官方底层 SSH/subagent 不能直接视为 O federation 协议。两套 runtime 的连通性也不证明任务所有权一致。 | P1：补 host/dispatch/attempt 归属和恢复；P2：跨 Host federation 在本地持久调度与默认挂载明确后再做。 |
| 22 | O:src/renderer/src/components/settings/Settings.tsx:56 导入 OrchestrationPane；对应 CLI/RPC 见 #20/#21。 | L:packages/client/ui-orchestration/src/client/index.ts:31 注册页，:34/40 持久设置 maxParallelToolCalls，:35 读 pluginInventory，:55 注册 metadata；web-app:458 默认挂载。S/M。 | 旧“没有等价 Settings 面板”应改成“已有覆盖率/并行度面板，尚非 O Run/Dispatch 运行控制台”。官方是否有同等 Settings 页本轮未独立核验。 | P0：更正有无；P1：运行管理页接真实任务/取消/恢复，不把插件覆盖率展示当调度器。 |

### Skills、MCP 与扩展

| # | Orca 当前源码与入口 | 本地集成源码与入口 | 官方能力与真实差距 | 建议 |
|---|---|---|---|---|
| 23 | O:src/main/ipc/skills.ts:23/:60 发现；:68 freshness inventory；:73/:79 更新/取消；:25 明确该更新库存限本机 global homes，WSL/SSH 未纳入同等更新轨道。核心入口:178 注册。S/M，该文件已修改。 | L:packages/bundle/base/cordis.patch.yml:273 至 :284 有 registry/filesystem/catalog tool；web-app:512 至 :524 说明 host 与 preset 分层，host filesystem/tool row 被禁用后由 preset 挂载。 | F:packages/bundle/base/cordis.patch.yml:280 至 :291 同样已有 Skill 基础；不能将其描述成 L 独有，也不等于 O 哈希 freshness/批量更新。 | P1：补来源/版本/依赖/freshness 与取消的明确产品动作；P2：按 Host 分开安装与升级，不宣称 Orca 本身已统一所有 Host 更新。 |
| 24 | O:src/shared/mcp-config.ts:45 列 .mcp.json/.cursor/mcp.json/.claude.json/.claude/mcp.json；O:src/renderer/src/components/settings/McpConfigSection.tsx:34/53 以 repo/host 检查并打开配置。S。该证据是配置 inspection，不是独立 MCP tool runtime。 | L:packages/mcp/mcp-management/src/index.ts:44 持久 desired state 与连接 owner，:103 save/:131 remove；web-app:129/132/137/434 默认挂 backend/controller/UI。S/M。 | F:packages/mcp/mcp-client/src/index.ts:1 已有注册 mcp__server__tool 的真实 bridge。此项 L 可在自身 runtime 深度上领先 O 的已查配置面板，不能强行记作缺口。 | P1：验收 desired/connected/failed 状态区分、凭据引用、重启/更新/取消；P2：可选导入外部格式，保持显式授权。 |
| 25 | O:src/shared/plugins/plugin-manifest.ts:23/30 明确 experimental manifest/API；:97 out-of-process worker，:99 至 :131 支持 panels/commands/events/languagePacks/keybindings/vmRecipes/agents/capabilities；不包含 Skills contribution。O 主入口:2658 实例化 PluginService，core-handlers:187 条件注册。S/M。 | L:packages/extensions/cordis-host-runner/src/index.ts:1 有 immutable definition、active run 与 Client activation；L:packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.tsx:33 展示 feature-owned tabs；web-app:425 默认注册 Settings。S/M，分发闭环另验。 | 官方本身是 Cordis 插件体系；是否具备相同 marketplace/update/rollback 产品链，本稿未逐项验证。两者插件格式/授权/进程模型不同。 | P1：按安装来源、能力预览、更新失败恢复与卸载资源回收逐项验收；不将任一扩展协议原样当兼容格式。 |
| 26 | O:src/main/ipc/register-core-handlers.ts:143 至 :232 证明账号、Git、Skills、自动化、浏览器、runtime、AI Vault 等跨域主入口；自动化/插件有依赖对象条件，不能笼统说一切无条件启用。 | L:packages/bundle/web-app/cordis.patch.yml:140/165/225/293/434/437/440/458 已分别挂自动化、Git、语音、通知、MCP、Host 与编排 UI；这些源代码事实优先于旧报告。 | F 0.1.6 的基础能力与 L 产品扩展需逐域分开；包数量、源文件行数和 Settings 导航数量均不能代表等价完成。 | P0：总报告统一使用 S/M/T，按完整产品闭环交付；任何“已发布”“实测通过”都要额外发布/运行证据。 |

## 旧报告时效判定

旧报告位于 L:reports/migration/orca-settings-audit.md，日期 2026-09-13；它是当时的 Settings 审查与局部验收记录，不是当前全产品基线。以下判定仅针对本轮读到的源码事实，旧测试结果不重用为本轮测试通过。

| 旧位置与结论 | 当前判定 | 当前证据 |
|---|---|---|
| :30 自动化只有 schedule/goal/ui-schedule，非全局作业系统 | 过时；当前有同 profile 持久 automation 与默认 UI。其作用域仍是同 Host，不等于 O 远端计划。 | #18/#19 |
| :21 无等价编排 Settings 管理面板 | 表述过时；已有默认挂载的并行度/覆盖率面板，尚缺 O 运行管理语义。 | #22 |
| :44 SSH 仅暂存、只有身份信息 | 过时；已存在持久 alias/连接/目录探测和默认 Host Settings；官方亦有 POSIX SSH 执行底层。 | #16/#17 |
| :24 Voice 未接入、:41 Notifications 无 owner | 包有无和默认挂载结论过时；当前 web-app:225/228/231 挂 voice/controller/sherpa，:69/293 挂 notifications/UI。语音模型下载、麦克风与通知系统运行验收本轮未执行。 | L:packages/bundle/web-app/cordis.patch.yml:69、:225、:293 |
| :32 Git 只有部分原生、设置与托管动作不等价 | “托管动作不等价”仍成立；但应明确已挂载 sidebar-git 的真实写操作，不能收缩成只读 Git。 | #7/#8/#9 |
| :29 手机配对未实现，不能与模拟器混同 | 当前检查仍支持“本地未见等价配对产品”的判断；没有运行移动客户端。 | #15 |
| :20 账号/模型凭证不等价账号池 | 当前仍成立；同时补充本地 usage-query 已有真实统计。 | #11/#12 |
| :33 Work Items 已有可选原生能力 | 不据此证明 PR；GitHub provider 明确过滤 PR。 | #8/#10 |
| :50 插件分发未闭环 | 本稿只确认当前 extension/UI 与 Orca manifest；没有重新验证 marketplace/update/rollback，不沿用旧“已验证”或“仍未实现”的完整断言。 | #25 |
| 原报告范围 :7 为32固定导航与项目动态设置 | 范围不足以覆盖 CLI/AI Vault/Teams/federation；本稿补的是宏观产品事实，不取代设置导航专项对账。 | #1 至 #26 |

## 建议合并到总报告的顺序

1. P0：先固定 main 最终 SHA 与 S/M/T 口径，修正自动化、Voice、通知、SSH、编排面板和 Git 的陈旧“有无”结论；明确 worktree-task/coordination 默认装配未找到，不能把源码和 UI 存在写成默认产品可用。
2. P1：优先打通已存在的本地 Git/worktree/automation/MCP/Host 能力与真实 UI，再补主要差距：账号池、跨 Agent AI Vault、PR/CI、同一 host 的项目/终端/Agent 归属及持久编排恢复。
3. P2：跨 Host worker federation、外部 CLI 原生 Teams pane、更多 provider 和外部配置导入在产品身份与生命周期确定后推进。手机配对若属首发需求应保持 P1，否则单独立项。

## 本轮验证与限制

执行了只读 git rev-parse、branch/status、官方 exact-tag、代表文件 git diff --name-status HEAD，以及 glob/grep/read 源码和 YAML。未执行 git fetch/switch/add/commit/merge、构建、测试、安装、Orca CLI 调用或任何用户数据操作。整体 main 同步结果与运行验证见主报告。写入后检查确认26条事实行、83处完整 O/L/F 行号引用；逐个读取51个引用文件的最大引用行，全部文件与行号存在。这是文档引用检查，不是产品运行测试。
