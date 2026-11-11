# 超级 Agent 工厂（SuperAgent + Bot）方案

> **状态：后续拓展方向（暂存方案，不启动实现）。** 旧版已于 2026-11-08 删除，目录只保留本文一份 plan。
> **证据纪律**：对每个"底座已有"的断言逐包回到源码核实（见 §2），并吸收 2026-11 会议纪要与 Dify 现状；早期版本凭 README 与印象估算的三处判断被推翻（§2.3）。2026-11-08 并入阿里云 Agent 开源开发者沙龙六项目的只读调研（§4.1）及其未吸收项的跟进计划（§4.2），落点见 §5、§8、§10，均标注“未验证”。
> **前置依赖**：底架欠账清单以 `docs/dev/官方功能差距对比.md` 第四节为准；底架未达标前本文只作架构储备，不动代码。
> **本文不含实现代码。** 凡标"未验证"的条目，是没有读到源码或运行结果，不是已确认的缺口。

## 0. 一句话结论

**以 cinlan-harness 为唯一地基，做"超级 Agent 工厂"：底层是可恢复的超级 Agent 运行时（受理 → 总管 → 执行 Bot → 审核 → 回执），上层是让各部门自助定义 Bot 的配置面；终态逐步取代 Dify，路线分三波（共存 → 补缺 → 切换）。**

三条支撑判断，都有源码依据：

1. **执行端已经收敛进同一会话内核。** `subagent` 有 6 个派发后端（codex、claude-code、acp、dsh-sdk、两种进程内），外加实验的 `subagent-oar`（每次调用选 runtime）。外部 CLI 不是缺口，是现成件。
2. **三套编排面都不抗进程中断**（§3.2）。所以稳定性不能靠"换个更聪明的总管"，要靠编排层之下的持久骨架（Ticket 状态 + session 日志 + jobs/schedule）。
3. **"取代 Dify"有两个真缺口**：文档知识库、非技术配置面（§7）。这两块 harness 树里没有对标件。

## 1. 战略背景与首期边界

来自 2026-11 会议纪要（甘志杰、陈世云）与现状截图：

| 输入 | 内容 | 对方案的影响 |
|---|---|---|
| 长远目标 | 各部门（软件、PLC、销售等）按现有流程自主搭建 AI 工具，打破部门壁垒 | 终态是"工厂"（可自助配置），不是"一套总管 + Bot" |
| 首期试点 | 软件和算法板块，团队最熟悉，降低试错成本 | 阶段 1 只做软件研发任务一个垂直场景 |
| 核心矛盾 | 陈世云：引入编排工具会让业务编排与软件实施自由度冲突；软件攻坚需要极高系统自由度 | §4 按自由度分层回应 |
| 现状 | 公司已自托管 Dify（`localhost:18088`），搭有"ZK租赁·项目与业务助手"：挂知识库，只答不做（回答里明确声明不会自行执行启动命令） | Dify 的缺口正是"真执行"；终态取代路线见 §7 |
| 会议判断 | 甘志杰认为编码难度不高 | 部分成立，见 §9 风险 R1：持久化编排是例外 |

**未验证**：Dify 里实际使用了 Skills / Agents / 工作室 / 集成中的哪几块，截图只显示菜单名；ZK租赁代码是否已接入 Dify 知识库，截图显示回答引用了"02-开源操作手册"和"模块-rental-auth"两篇文档，但文档来源（代码仓库 / 手写文档）未确认。

## 2. 能力地图：早期假设 vs 源码核实

核实方法：逐包读 `package.json` / README / 关键源码，行号可回查。包路径均在 `packages/` 下。

### 2.1 已有且成熟（直接用）

| 能力 | 承载包 | 核实到的事实 |
|---|---|---|
| 外部执行端 | `subagent/subagent-codex`、`subagent-claude-code`、`subagent-acp`、`subagent-dsh-sdk`；实验 `experimental/subagent-oar` | codex 走官方 app-server 协议，依赖 `@openai/codex@0.153.4`，其 optionalDependencies 含 `win32-x64`/`win32-arm64`；claude-code 依赖 `@anthropic-ai/claude-agent-sdk@0.3.263`，同样含 win32 平台包。端到端在 Windows 跑通**未验收** |
| 每次调用选执行端 | `experimental/tool-subagent-oar` | `runtime` 参数是必选枚举（`src/index.ts:43-48`）；拒绝 continuable 或继承父上下文的 provider（`:85-87`），即强制独立上下文 |
| 多机执行 | `execution-host/execution-binding`(621 行)、`execution-host-targets`(1272)、`execution-runtime`(1118)、`execution-host-worker`(663) | 绑定 Workspace + Session 到带租约的本地/SSH 环境；"远程连接不会成为第二个 Session 写入者"；`execution-runtime` 管 SSH 安装/升级远程运行时与按需临时 VM（配额、生命周期、孤儿回收）。**限制**：不支持 Windows 远程端点，远程需预装 Linux/macOS 部署 |
| PR 全链路 | `experimental/forge`、`forge-github`、`forge-session` | `ForgeProvider` 契约（`forge/src/types.ts:191-223`）含 `diff()`（统一补丁）、`submitReview()`（行级评论 + approve/request-changes）、`merge()`（带 `headSha` 守卫）、`markReady()`、`fetchChecks()`。`forge` 家族名是开放字符串，可扩展 Gitee/GitLab |
| 声明式编排 + 审批 | `coordination/coordination`(347 行)、`coordination-local`(787)、`coordination-subagent-executor`(206)、`tool-coordination`(447) | DAG 校验、任务生命周期、审批闸门（`task/approval-requested`/`approval-decided` + `registerApprovalAdapter`）、审计事件、子树级联取消；executor 可注册任意 subagent provider；依赖结果注入带抗注入提示 |
| 受理入口（推送） | `experimental/webhook`、`webhook-github` | 签名 GitHub 适配器，规则创建 Workspace 会话；`webhook-github/examples/github-review/` 是 PR ready_for_review → 只读评审会话的完整示例 |
| 定时/常驻 | `schedule/schedule`(3565 行)、`jobs/*`、`automation/automation` | cron + interval，投递到新/既有 Session |
| 持久化与回放 | `session/session-persistence-jsonl`、`session-projection`、`session-query/session-query-sqlite` | append-only JSONL 事件日志，可确定性回放；SQLite FTS5 全文检索（会话历史） |
| 记忆（索引读路线） | `compaction/compact-recallable`、`tool-recall` | 压缩只在 surface 上替换，被遮蔽事件仍在日志；细粒度 index stubs + working-memory checkpoint；`history_read` 取回逐字原文、`history_search` 字面检索 |
| 交付证据 | `artifact/artifact`、`deliverables/workspace-changes` | Artifact 元数据含 provenance / 保留期 / redaction；`workspace/changes` 事件按轮记录改动文件 |
| Windows 本机执行 | `subprocess/win32-process`、`shell/pwsh-local`、`pwsh-sandbox`、`sandbox/sandbox-windows-acl` | 本机侧原生支持 |

### 2.2 部分具备（需要增强）

| 能力 | 现状 | 缺口 |
|---|---|---|
| 会话内多 Bot 协作 | `experimental/agent-team`：Lead + ≤8 teammate，DAG 任务板（CAS 乐观并发、owner 分配、环检测），`workspace_mode:'worktree'` 本机 git worktree 隔离 | 全部状态绑定单进程：成员解析用进程内 `ctx.agents`（`roster.ts:97`），事务串行用内存 Map（`journal.ts:14`），投递去重用内存 Set（`mailbox.ts:28-30`）；不自动释放 task owner；扁平两层、名字不可复用。`DEFAULT_MAX_MEMBERS = 8`（`index.ts:45`）。README 表格写 16，与代码不符 |
| 脚本式并发编排 | `workflow/workflow-ptc`：`parallel()`/`pipeline()`/`phase()`；`maxConcurrentAgents`、`maxTotalAgents`（默认 1000） | **无日志化或恢复**：README 已知限制明文"进程重启后无法继续运行"；无嵌套、无 token 预算词汇 |
| 任务来源 | `work-items`：5 个 Provider，`registerProvider()` 运行时可注册 | `WorkItemSource` 是封闭联合 `'github'\|'linear'\|'gitlab'\|'jira'\|'gitee'`（`types.ts:8`），新增 Provider 族要改核心类型；接口纯拉取，无订阅钩子 |
| Webhook 受理 | `experimental/webhook` | README 已知限制：仅进程内 fire-and-forget，**无队列、回放、重试、内置去重**，崩溃丢失尚未接纳的规则调用 |
| 外部执行端的轨迹 | OAR 事件流是结构化的（`tool_call_started/_input/_ended`、`text`、`reasoning`、`usage`、`turn_*`、`compaction_*`，`records.d.ts`） | `subagent-oar` 只订阅 `text_delta`（`run.ts:177-183`），回传最终文本 + 失败分类（`FailureClass` 13 值）。**事件同构目前只到"最终结果"一级**，完整轨迹需扩展订阅 |
| 外部执行端的结构化输出 | `subagent-spawn-in-process`：`outputSchema`/`agentPreset`/`depthLimit` 全支持 | 其余所有后端（codex、claude-code、acp、dsh-sdk、oar）用 `NO_START_CAPABILITIES`，全部为 false（`subagent/src/out-of-process.ts:56-61`） |

### 2.3 早期版本判断被推翻或修正

| # | 早期判断 | 核实结果 |
|---|---|---|
| 1 | "接 codex/claude 是缺口，靠 `acp`/`mcp` 外挂" | 已是 `subagent` 一等后端。早期版本把 Phase 8/9 当外部执行端入场券也不成立：Phase 8（Codex App Server + TUI）方向是让 codex 作壳驱动 DSH，而本方案是 DSH 驱动 codex，走 `subagent-codex`/`subagent-oar`，不被 Phase 8/9 阻塞 |
| 2 | `inspector` 与 `auto-review` 是审核 AI 骨架 | `inspector` 是 CDP 调试工具，与审核无关。`auto-review` 是 per-tool 执行前授权门禁，用主会话同一模型与上下文（`index.ts:415-418`），输出仅 allow/deny（`:54-83`）；粒度、输入、输出、隔离四项都与"per-task 语义评审"不符。只借其管线范式 |
| 3 | "多机节点注册/健康/负载是底座最弱项" | SSH 目标、运行时安装、临时 VM、执行绑定已有 3600+ 行。真缺口收窄为"按任务关联性与负载把 Assignment 路由到节点"的放置策略。`coordination-subagent-executor` README 明确不拥有 scheduler、worktree、进程放置策略，这就是要自建的那层 |
| 4 | 编排只有 `workflow-worker-thread` | 无此包（grep 零命中）。真实有两套正交编排面：`workflow`（脚本式）与 `coordination`（声明式 DAG）。早期版本把 `coordination-subagent-executor` 误归入 workflow |
| 5 | 定时轮询/follow-up 是缺口 | `schedule`（cron + interval）与 `jobs` 已成熟 |
| 6 | "回环守卫"是硬阻断 | 阻断靠子 Agent 深度上限（`SubagentDepthError`）、`maxTotalAgents`、`guard/timeout-policy`；`repeat-tool-reminder` 只是劝告，不拦截 |

## 3. 总体架构：持久骨架 + 易失大脑

### 3.1 三层结构

```
持久骨架（真相源，抗中断）
  Ticket 状态机（storage-sqlite）+ Outbox + session 日志 + jobs/schedule 常驻
        │ 崩溃后由此层幂等重发
        ▼
编排层（易失大脑，崩了重来）
  coordination（默认主轴：DAG + 审批闸门）
  workflow（单轮并发扇出）  agent-team（会话内临时协作）
        │ 按 Ticket Policy 选编排面
        ▼
执行端池（subagent seam，统一 startActivation）
  codex │ claude-code │ oar │ dsh-sdk │ acp │ spawn-in-process（本机模型）
        │
        ▼
审核层（独立上下文）
  spawn-in-process（outputSchema 结构化裁决）→ forge（diff / submitReview / merge）
```

### 3.2 三套编排面的稳定性对照

| 编排面 | 并发/规模 | 跨进程中断恢复 | 内建审批 | 适用 |
|---|---|---|---|---|
| `agent-team` | 单进程、≤8、共享或 worktree 目录 | roster 与任务板可从 Lead session log 恢复；投递队列与 owner 是内存态，不恢复 | 无 | 会话内几个 Bot 临时协作，短命 |
| `workflow` | `maxConcurrentAgents` + `maxTotalAgents` | **无**（README 明文） | 无 | 一轮内能跑完的确定性扇出，如对 N 个文件并行同一检查 |
| `coordination` | provider 决定；local 有 `maxConcurrency`/`maxActiveRuns`/`maxTasksPerRun`/保留字节上限 | seam 明文"暂无持久化 Provider"；`coordination-local` 是内存实现 | **有** | 长任务主干：依赖、审批、多执行端、审计 |

**推论**：任何单个编排面都不能独自保证稳定。长任务状态只放 coordination + 持久层；workflow 只接"单轮内结算"的子步骤；agent-team 只接"会话内临时协作"。

### 3.3 按自由度分层

回应陈世云提出的"业务编排标准化 ⇄ 研发自由度"矛盾：

| 部门类型 | 走哪层 | 自由度 | 配置方式 |
|---|---|---|---|
| 标准化部门（销售、PLC 等） | coordination 声明式 DAG | 固定受理 → 派发 → 审核 → 回执，不碰代码 | 填配置（见 §7 配置面） |
| 软件攻坚 | 原生形态 / workflow 脚本 | 完整 harness 能力，编排是可选工具 | 写脚本或直接对话 |
| 中间地带 | agent-team | 会话内协作 | 对话 |

**设计铁律：编排层对执行端是邀请制，不是管制。** 编排只负责派活、收活、审核；Bot 落到某台机、某个目录后，内部用什么工具、怎么攻坚，harness 不限。标准化只作用在任务流转层，不作用在技术实现层。

## 4. 与市面方案的差异（有来源，含反例）

2026-11-05 对 DeerFlow、Omnigent、CAO、Claude Code、Codex CLI、OpenHands 做了只读调研（README、GitHub API、官方文档；经小模型摘要转述，关键格子写进决策前应复核）。

**调研否掉了三条常见的"独家"论断，本方案不再使用：**

- "市面没有独立评审"：Omnigent 的 Polly 把每个 diff 路由给与编写者不同厂商的评审者；DeerFlow 有父侧确定性验收（文件存在、测试退出码，不可判定项标 UNVERIFIED）。
- "市面没有自动立案与失败续跑"：DeerFlow 有 8+ IM 通道、durable 可续跑批处理；OpenHands 有 Slack/GitHub/Linear/webhook/定时。
- "多机 + Windows 是独家"：Omnigent 有 host 注册与 Windows degraded mode；DeerFlow 有多实例 leader lease 与 fencing。

**站得住的差异只有一条，且限定表述**：执行端（自带模型、codex、claude）的结果、证据、审核结论归入同一条可确定性回放的 `session` 事件流与同一套 `artifact` 契约，记忆建在 `compaction` 之上。Omnigent/CAO 的原生 CLI 走 tmux/PTY 文本流（来自其 README）；DeerFlow 的验收与记忆是独立子系统。**限定**：外部 CLI 端目前只到"最终文本 + 失败分类"一级同构（§2.2），完整轨迹同构是后续工作。

**未验证**：Codex CLI 的 exec/JSONL/SDK 输出格式；Claude Code 的 headless 输出格式；DeepSeek SuperAgent 原型的执行轨迹与评审（只读了 README）；Devin、Cursor background agents、Copilot coding agent 未调研；DeerFlow、Omnigent、CAO 对外部 CLI 是否提供结构化轨迹，README 均未明说，不能断言"只有文本"。

**许可**：Codex CLI Apache-2.0；OpenHands MIT；DeerFlow MIT；Omnigent、CAO Apache-2.0；Claude Code 为专有许可（Anthropic Commercial Terms）；OAR（`@botiverse/oar` 0.67.0）Apache-2.0。本方案"只用开源版"的约束下，Claude Code 作为执行端属于"调用用户自己安装并认证的外部工具"，不是依赖其源码，合规边界需法务确认（**未验证**）。

## 4.1 2026-11-08 补充：阿里云 Agent 开源开发者沙龙六项目（只读调研）

来源：cnblogs 10ng 的沙龙回顾（2026-08-28 发布，2026-11-08 读取），单一来源、会议纪要级。**五项目已于 2026-11-08 完成开仓核实（存在性/许可/活跃度）**：AgentScope OverlayFilesystem（Java 仓源码级）与 OBI GenAI/MCP 覆盖（文档级）已深入核实；**运行级实测仍未做**（§4.2 的 OBI 沙箱实测、ARD 端点实测两项仍开放），写进决策前按 §4 同一纪律复核。原文中的安装脚本（curl 管道执行）不引用、不采纳。完整核实报告：会话笔记 salon-repos-verification.md。

| 项目 | 定位 | 对本方案的借鉴点 |
|---|---|---|
| AgentTeams（agentscope-ai，Apache-2.0） | 多 Agent 协作与治理底座：Team/Room/Task 统一语义，Matrix 房间承载，Human/Manager/Team Leader/Worker 同一身份体系，Human-in-the-loop 一等公民 | 与 §3.3 分层自由度、coordination 审批闸门同向；其统一身份/事件/状态语义可作 B1、B2 契约设计的对照；声明式生命周期 + K8s CR 部署超出本方案单机/SSH 范围，不跟进 |
| AgentScope 2.0 Harness | 企业级智能体框架（Python/Java/TS；Go 版存疑——agentscope-ai 组织检索未见 Go 仓），Workspace 为 Source of Truth，文件系统四档（Local/Sandbox/Remote/Overlay）——已核实：四档实现在 agentscope-java 的 agentscope-harness 模块（Python 主仓无 OverlayFilesystem） | OverlayFilesystem（per-用户可写上层 + shared 只读下层 + copy-on-write；草稿落 lower 层供外部审批系统读，合入决策在系统外）是 §6.2 规则下发与回写的现成分层参照（源码级核实，实现在 agentscope-harness 模块）；其四个示例（个人助手/多租户/Overlay/全沙箱）可当 §6.1 隔离分档的验收标尺（示例未逐一核对） |
| Nacos ARD | Skill/MCP/Agent/Prompt 跨型资源搜索引擎：发现先于调用、治理过滤、“score ≠ 信任背书”、不替代 MCP/A2A | B8 配置面与 plugin-market 启用决策（§7.1）的能力发现层参照；“事实源落库、派生数据幂等重放重建”与 §6.3 路线 B 的确定性索引同构（已核实：ard-spec 规范仓 + Nacos 33.5k★，3.3.0 ARD 2026-10-29 发版；引设计不引重型服务端） |
| OBI（OpenTelemetry eBPF） | 无侵入 Agent 可观测：协议感知覆盖模型/MCP 调用、网络、日志 | 阶段 5 可观测的对标件；其案例（向量库 namespace 配错、PDF 整篇进 system message 致 Token +320%、Sandbox cgroup OOM）是 execution-host 资源上限与评审证据面的验收素材（已核实：opentelemetry-ebpf-instrumentation 624★ CNCF，GenAI/MCP 覆盖为现成能力但 payload 提取默认关闭，需开 ebpf.payload_extraction.http.genai.*；沙龙三案例属讲稿素材未核实） |
| UnifiedModel | 数据语义层（Set/Link/Field + 统一 SPL） | B7 文档知识库层的候选参照：本体式索引与已定的路线 B 同构，只作设计参照，不引依赖（已核实：alibaba/UnifiedModel 454★，标准 Apache-2.0，2026-11-04 推送；项目仅半年，生产级图存储 provider 待社区共建） |
| Blade AI | 混沌工程 Agent（ChaosBlade 编排器） | 四条安全机制可借：安全检查为不可跳过的代码节点（同 AGENTS.md “在执行操作的同一处强制决策”）；冻结合同（身份不可变）；独立恢复状态机 + 自毁超时（恢复是状态机不是撤销，与 Session 世代不可改写同源）；三层验证结论只可降级（已核实：chaosblade 主仓子项目 blade-ai/，6.5k★；口径校准——仓库现状为两层验证，「冻结合同」「自毁超时」无字面对应，引用机制时以仓库文档为准） |

## 4.2 §4.1 未吸收项的跟进计划

六项目中三条只吸收了一部分或未吸收。跟进原则：先核实、再对照、后采纳；触发时机绑定既有阶段，不新增独立排期。

| 项 | 现状 | 跟进动作 | 触发时机 | 验收信号 |
|---|---|---|---|---|
| AgentTeams 身份/事件/状态语义 | §4.1 已列借鉴点，未读源码 | 读 TeamHarness 协议与 Matrix 身份模型源码，对照 B1（持久 coordination）与 B2（受理器）的契约草案，产出可借字段/事件清单 | B1 立项设计前 | 一页对照结论：哪些语义直接可用、哪些与 remote-access/审批闸门冲突 |
| AgentTeams 声明式生命周期 + K8s CR 部署 | 明确不跟进（超出单机/SSH 范围） | 挂起；仅当部署形态升级为 K8s 集群时重开评估 | 部署形态变更时 | 维持挂起，无验收 |
| Blade AI 四安全机制中未进契约的两条（冻结合同、独立恢复状态机 + 自毁超时） | 两条已进 B5 契约（§5），两条未采纳；沙龙口径与仓库 v0.4.0 有漂移（三层验证/冻结合同/自毁超时无字面对应） | B5 评审预设设计时评审：评审会话身份是否需要不可变冻结、裁决是否需要独立恢复状态机；倾向不引入（coordination 审批闸门已覆盖裁决落地） | B5 设计评审 | 书面取舍结论 |
| UnifiedModel 语义层 | B7 候选参照；仓库已核实（2026-11-08，454★ Apache-2.0） | 开仓核实（已完成），读 Set/Link/Field 模型，对照 §6.3 路线 B 的索引 schema | B7 立项前 | 一页对照结论：只参照还是局部借用 |
| Nacos ARD / OBI | 仓库已核实（2026-11-08）；ARD 六端点细节与 OBI 沙箱实测仍开放 | ARD：核实 Nacos 3.3 的 ARD 六端点与治理过滤规则，喂 B8 能力发现的过滤设计；OBI：在 execution-host 沙箱实测无侵入观测能否覆盖 MCP/模型调用（记得开 GenAI payload 提取配置） | B8 设计 / 阶段 5 | 各一份核实或实测记录 |

其中开仓核实类动作（AgentScope 2.0、Nacos ARD、OBI、UnifiedModel、Blade AI 的仓库、许可、活跃度）已并入 §10 阶段 0 清单，并于 2026-11-08 完成（见 §10 阶段 0 核实结果引注与 salon-repos-verification.md）。

## 5. 审核层

审核必须分层，且评审与执行不同预设、不同上下文。

1. **机器门禁（硬）**：编译、类型、测试、lint、安全扫描。来源：`forge` 的 `fetchChecks()` 读 CI 状态，加本机 `workspace/changes` 事件。
2. **语义评审（自建）**：独立预设，输入 = 需求 + `forge.diff()` + 运行证据 + 验收标准，输出 = 结构化裁决（通过 / 打回 / 需澄清 + 逐条理由）。
3. **人工入口**：高风险或低置信度走 `coordination` 审批闸门（`requestApproval`）与 `feedback`。

**关键技术约束（已核实）**：外部执行端全部无 `outputSchema`，只有 `subagent-spawn-in-process` 支持。所以**语义评审必须跑在 spawn-in-process（本机模型）上**，用 `outputSchema` 约束结构化裁决（`SubagentResult.structured`）；执行 Bot 才用 codex/claude/oar。这个分工同时满足"评审与执行不同上下文"，因为 spawn 子会话"never sees the parent conversation"（`subagent-spawn-in-process/src/index.ts:45`）。

裁决写回：`forge.submitReview()`（行级评论、approve、request-changes）与 `merge()`（带 `headSha` 守卫，head 移动则拒绝）。`auto-review` 只借其"hook → 冻结快照 → 固定 policy 一次性调用 → 严格解析 → 决策落地"管线范式。

**未验证**：语义评审对"验收标准"的喂入格式；评审模型选型与成本。

两条风险表述（§4.1 Blade AI，未验证）收进 B5 的评审输入契约：**工具成功 ≠ 故障生效**——评审证据必须是“验收标准被实际验证”的证据（测试退出码、断言输出），不是“工具跑完了”；**目标漂移**——裁决只允许通过/打回/需澄清三级且只可降级，评审不得自行扩大或缩小验收范围。其三层守卫（流程/调用/命令级）由现有 sandbox、guard 与审批闸门分层承担，不新增层。

## 6. 多机、资源隔离与记忆

### 6.1 多机（缺口收窄）

已有：SSH 目标管理、运行时安装、临时 VM、执行绑定（§2.1）。缺：

- **放置策略**：Assignment → 节点。规则 = 同仓库 / 同需求族 / 同 Workspace → 共享节点或 worktree；不关联 → 分散。需自建，落在 coordination provider 的 executor 选择处。
- **节点健康与心跳**：`execution-host-targets` 有真实根目录检查，持续健康检查与摘除/恢复未见（**未验证**，需读 `execution-host-targets` 与 `execution-runtime` 源码确认）。
- **owner 回收**：agent-team 不自动释放 owner。用 `guard/timeout-policy` 的硬超时 + 心跳做回收，属自建。

**Windows 约束（已核实）**：控制端可用 Windows，远程端点不支持 Windows，且远程需预装 Linux/macOS 部署。对方若有 Windows 工控机作为执行端，需单独验证（**未验证**）。

### 6.2 项目规则管理

规则作为版本化制品，随 Assignment 记入 Ticket，可回放"当时按哪版规则执行"；远程下发需 hash 校验。远程访问通道属于 `api/remote-access` 与自研中继的战略裁决（见 `官方功能差距对比.md` 撞车区第 4 条），不在本方案内另起第二套传输。规则同时是审核 AI 验收标准的素材来源，平台化目标下优先级前移到阶段 2。

### 6.3 长期记忆：定案

基座已有：`compact-recallable`（零丢失、可确定性回放）+ `tool-recall`（`history_read`/`history_search`）+ FTS5。

- **主干 = 路线 B（索引读）**：确定性、可审计，自建量小。
- **路线 A（向量召回）**：树内**零个** embedding/向量包（grep `embedding|vector|faiss|cosine|hnsw` 无相关命中），完全从零自建，作为可选增强挂在同一索引上；客户环境不允许 embedding 模型时 B 单独成立。
- **注意区分**：现有检索是**会话历史**的检索，不是**外部文档知识库**。后者是取代 Dify 的缺口，见 §7。

## 7. 取代 Dify：三波路线

### 7.1 Dify 能力与 harness 对标

| Dify 能力 | harness 对标件 | 现状 |
|---|---|---|
| 问答对话 | 会话 / Agent 内核 | 成熟 |
| Skills / Agents | `skill/*`、`preset/agent-preset`、`agent-preset-registry`、`persona` | 在树；缺面向非技术人员的配置面 |
| 集成 | `mcp-client`、`mcp-management`、`work-items` | 在树，够用 |
| Marketplace | `experimental/plugin-market-bundle`（Discover tab）、`util/official-bundles` | 实验态，发行 profile 默认禁用，是否在 Cinlan profile 启用待产品拍板（`官方功能差距对比.md` §1.1） |
| **知识库** | **无** | **缺口**：树内无外部文档 RAG/知识库包；`session-query-sqlite` 的 FTS5 只索引会话历史 |
| **工作室（可视化搭应用）** | **无** | **缺口**：没有面向非程序员的可视化搭建面；现有配置面是 `cordis.yml` + preset YAML |

### 7.2 三波路线

| 波次 | 范围 | Dify 状态 | 出口条件 |
|---|---|---|---|
| 波 1 | 软件/算法板块（ZK租赁真实项目）；harness 补"真执行"：受理 → Bot → 审核 → 回执 | **共存**。Dify 当上游入口（经 webhook 投递"需要真执行"的任务） | §10 阶段 1 验收通过 |
| 波 2 | 补两个缺口：文档知识库层（优先确定性索引，向量可选）；Bot 定义配置面（表单化，基于 `agent-preset-registry`） | 共存，部门可选择试用 harness | 缺口补齐，且有部门自愿迁移 |
| 波 3 | 部门逐个迁移；沉淀的知识库内容与提示词迁移而非丢弃 | 最后一个部门迁完后下线 | 各部门迁移验收 |

**为什么不一步取代**：知识库与工作室两块是 Dify 的核心价值，harness 现在都没有；首期若同时补这两块，会拖垮"半小时开工"的 SLO 与软件板块试点。路线靠"先在 Dify 做不到的地方（真执行、审核、稳定）建立不可替代性，再回头吞并 Dify 已有的能力"。

### 7.3 自助搭建的治理边界

各部门自助搭 Bot 意味着任意部门能定义可落机执行的 Bot。必须有：权限分级（谁能建、谁能让 Bot 落哪些节点/目录）、执行端凭据走 `credentials` 统一管理而非各部门自带、Bot 定义变更留审计。**未验证**：现有 `credentials` 与 `permission-presets` 能否支撑多部门隔离，需单独评审。

## 8. 自建点清单

| # | 自建点 | 落点 | 说明 |
|---|---|---|---|
| B1 | **持久化 coordination provider**（头号）✅ 2026-11-08 交付 `@cinlan/coordination-sqlite` | 新包，自带 capability seam | `coordination-local` 是内存实现；用 `storage-sqlite` 落盘，使总管任务图可续跑。已交付：WAL 顺序契约（校验→日志提交→内存→emit）、崩溃恢复（在途任务落 failed、未派发任务续跑、恢复泵容忍 effect 注册窗口）、篡改日志启动大声失败、驱逐只删内存不删日志；契约包为此异步化了 `sendMessage`/`start`/`addTask`（cancel/decideApproval 保持同步）并上移共享校验器到 `internal-validate.ts`；28 项测试（含 journal discipline 与崩溃恢复专项）+ local 21 项回归全绿 |
| B2 | 受理器 | 新包 | 事件 → 去重 → 立案 Ticket；补 `webhook` 缺的队列/重试/去重；Dify 作为一个来源 |
| B3 | 放置策略 | coordination provider 的 executor 选择 | §6.1 |
| B4 | owner 回收 | agent-team 外围 | 心跳 + 超时释放 |
| B5 | 语义评审预设 + 验收标准喂入 | 新预设 | §5 |
| B6 | 外部执行端完整轨迹上浮 | 扩展 `subagent-oar` 订阅 | 当前只收 `text_delta` |
| B7 | 文档知识库层 | 新包 | §7，取代 Dify 前置（**2026-11-08 已落：`@cinlan/knowledge-base`（KvUnit `knowledge` + FTS5，CJK 逐字索引）+ `@cinlan/tool-knowledge-search`，均挂 cinlan-web；向量召回仍是可选增强**） |
| B8 | Bot 定义配置面 | 基于 `agent-preset-registry` | §7，非技术人员可用（**2026-11-08 已落：`@cinlan/bot-registry`（settings `bot-registry` 命名空间 + 角色门 + 审计 + reload 收敛）+ `@cinlan/client-ui-bot-studio`（设置 section 表单面），均挂 bundle；凭据只存 scope 名**） |
| B9 | forge 扩展 Gitee 等 | 新增 `forge-*` provider | 若代码托管在 Gitee（**未验证**对方托管平台） |

B7/B8 的外部设计参照见 §4.1（UnifiedModel、Nacos ARD，未验证）。

**放置纪律**（`.devin/rules` Fork 边界规则 §2）：新功能只进自有包目录或 `bundle/cinlan-*`；接官方扩展面只用组合点（`cordis.patch.yml`、profile overlay、registry 注册）；官方包不散落 Cinlan 逻辑；新包自带 service definition + provider。`experimental/*` 是官方包，不直接改，扩展走新包。

## 9. 风险

| # | 风险 | 说明与应对 |
|---|---|---|
| R1 | **"编码难度不高"的例外** | 会议判断对软件板块首期成立（60%+ 能力在树）。例外是 B1：编排层全部内存态，持久化是稳定性的锚，不是低难度项。排期要单列 |
| R2 | 链路过长 | 硬指标"半小时内开工"。默认自动路由，仅高风险落人工；做成 SLO 监控 |
| R3 | 审核流于形式 | 必须喂验收标准 + 评审与执行分离 |
| R4 | 外部执行端 Windows | 载荷覆盖 win32，端到端未验收；claude-code 为专有许可（§4） |
| R5 | 多机状态一致 | 单一真相源在中枢（`execution-binding` 已保证远程不成第二写入者），放置策略与回收属自建 |
| R6 | 远程管理面 | 节点被接管等于被远程执行，鉴权、审计、最小权限先行；规则下发防供应链污染 |
| R7 | 实验包无稳定承诺 | `agent-team`、`forge`、`webhook`、`subagent-oar` 均 `experimental`、版本 `0.2.2-alpha.2`；上游变更需跟随，且 `AGENTS.md` 称公共 API 属 pre-stable |
| R8 | 取代 Dify 的迁移资产 | Dify 内沉淀的知识库与提示词需导出迁移；导出能力**未验证** |
| R9 | 自助搭建越权 | §7.3 |
| R10 | 底架回归 | `test:gui` 有 68 个文件、272 个测试失败，分布在多个无关包，非本项回归（`docs/dev/归档/合并后执行计划.md`）；本方案不依赖 GUI 测试通过，但底架治理仍是入场条件 |

## 10. 分阶段落地

原则：先跑通短链路，再加审核深度、多机、知识库。每阶段可演示。阶段内每项给出"动作 / 落点 / 验收信号"。

### 阶段 0：入场条件（不做新功能，只做核实与清点）

| 动作 | 验收信号 |
|---|---|
| 读 `execution-host-targets`、`execution-runtime` 源码，确认节点健康检查与恢复现状 | 书面结论，补进 §6.1 的"未验证"项 |
| 在 Windows 上验证 `subagent-oar`（宿主 CLI）与 `subagent-codex`（npm 载荷）各自能否跑通一个 one-shot 任务 | 两条路径各一份通过/失败记录 |
| 确认 ZK租赁代码托管平台（GitHub / Gitee / 自建 GitLab） | 决定 B9 是否进阶段 1 |
| 确认 Dify 的实际使用面与知识库来源、导出能力 | 补进 §1 与 R8 |
| 评审 `credentials` / `permission-presets` 对多部门隔离的支撑度 | 补进 §7.3 |
| 核实 §4.1 沙龙项目的仓库、许可、活跃度（AgentTeams 已核实，余五项待办），更新 §4.1 的“未验证”标注 | 各项目一行核实结论 |

> **核实结果（2026-11-08，四会话并行收口；细节见 `docs/dev/归档/发布坐标迁移-2026-11-08.md` §9 与 `.mrdayone/side-session-notes/`）**：
> - 健康检查：两包均**无**主动健康检查、心跳、自动重连——失联为被动 markLost（消息即 "reconnect to inspect"），重连留人工/上层；唯一心跳类机制是 OpenSSH ServerAliveInterval（需显式配置）。B3 放置 / B4 owner 回收确属自建。
> - Windows 双执行端：subagent-codex（npm 载荷，keyless）**7/7 通过**；oar-claude **通过**；oar-codex 失败但根因在机器配置（默认模型 id 在 magpie 网关 404 + codex CLI 0.166.0 的 Windows workspace-write 沙箱卡死，0.153.4 载荷无此问题），路径本身可通（CODEX_HOME 透传已验证）。
> - ZK租赁托管平台：**仓库内无法确认**（全量 grep 仅命中本文件「待确认」原文），需用户提供；work-items-gitee（GITEE_TOKEN）/ work-items-gitlab（自建 origin）承载位就绪。
> - Dify：本机 18088 探测时未运行；经典知识库 API **无整库导出端点**（文档 ZIP ≤100 个/次、分段正文逐条读）→ R8 迁移资产按「只读拉取」为能力边界。
> - 隔离评审：credentials scope=插件属主（防插件互读）**非部门/租户**；permission-presets 进程级全局、切档无权限检查、变更不记主体 → §7.3 三项治理（权限分级、凭据统一、变更审计）需自建。
> - 沙龙项目：AgentScope 主框架 35.6k★ Apache-2.0（2026-11-04 推送）；OverlayFilesystem 实际在 `agentscope-ai/agentscope-java`（6.3k★）的 agentscope-harness 模块，已源码级核实（copy-on-write、草稿落 lower 层供外部审批）；其余四项目已核实——Nacos ARD（ard-spec 规范仓 + Nacos 33.5k★，3.3.0 ARD 2026-10-29 发版）、OBI 624★ CNCF（GenAI payload 提取默认关闭需配置）、UnifiedModel 454★（标准 Apache-2.0）、Blade AI 6.5k★（沙龙口径与仓库 v0.4.0 有漂移，已校准）；运行级实测仍开放。

### 阶段 1：Demo，单机闭环（软件板块，workflow 单轮）

决策：demo 用 `workflow` 脚本，复用 `webhook-github/examples/github-review/` 的受理骨架；耐久层放阶段 2。

- 受理：GitHub（或确认后的平台）webhook → 规则创建会话。
- 派发：workflow 脚本用 `agent({provider})` 逐阶段选执行端（host.ts:204、runtime.ts:186），同一任务可在 codex / claude 间切换，这是给总监看的直观卖点。
- 门禁：`forge.fetchChecks()` + `workspace/changes`。
- 审核：spawn-in-process 子会话，`outputSchema` 出结构化裁决。
- 回执：`forge.submitReview()`；通过则 `merge()`。
- 验收信号：一个真实 PR 从 webhook 进、到 review 评论写回，全程是可回放的 session 事件流；同一任务切换执行端各跑通一次。
- **已知局限，demo 阶段接受**：workflow 无恢复，进程重启则该轮作废；webhook 无去重，重复投递会重复建会话。

### 阶段 2：MVP，耐久层 + 受理器 + 审核深度

- B1 持久化 coordination provider ✅（2026-11-08 交付 `@cinlan/coordination-sqlite`：崩溃恢复与不重复派发已有专项测试背书，验收信号即 recovery.spec 的三条断言）；B2 受理器（含 Dify 入口作为一个来源）；B5 语义评审预设。
- 规则管理前移到此阶段（§6.2）。
- 验收信号：杀掉进程后，进行中的 Run 能从落盘状态续跑，且不重复派发；重复 webhook 不重复立案。

### 阶段 3：多机、放置策略、外部端轨迹

- B3 放置策略、B4 owner 回收、B6 轨迹上浮。
- Windows 执行端按阶段 0 验证结果决定路径。

### 阶段 4：取代 Dify 的缺口（波 2 对应）

- B7 文档知识库层、B8 Bot 定义配置面、§7.3 治理边界；向量召回作为可选增强。
- **2026-11-08 进展：B7（knowledge-base + tool-knowledge-search）与 B8（bot-registry + client-ui-bot-studio）四个包已落库并挂 cinlan-web / web-app 组合；§7.3 治理边界随 B8 的角色门 + 审计先行，跨部门角色治理仍开放。**

### 阶段 5：迁移与生产化（波 3 对应）

- 部门迁移、Dify 资产导出迁移、幂等/重试/Outbox 打磨、可观测（对标 §4.1 OBI 的无侵入 eBPF 方案，覆盖模型/MCP 调用链路）。

## 11. 与底座现有规划的衔接

- 多渠道受理长在 `docs/dev/任务来源`（Work Items）与 `experimental/webhook` 之上。
- 总管分发长在 `docs/dev/编排`（Orchestration）与 `coordination` 之上。
- 远程中枢与多机观察并入 `docs/dev/远程访问路线` 的战略裁决（`api/remote-access` vs 自研中继）。
- 本文不新造并行体系；形态切换（原生 / 调度 / 执行）仍是预设 + 设置，不是三份代码库。

## 12. 待你拍板

1. ZK租赁及首期其他项目的代码托管平台（决定 B9 与阶段 1 的受理入口）。
2. 对方 Windows 工控机是否需要作为执行端（决定阶段 3 路径与 R4 优先级）。
3. Claude Code 作为执行端的合规边界是否需要法务先确认（§4）。
4. 阶段 0 的核实项是否先行（成本低，能消掉本文大部分"未验证"）。
