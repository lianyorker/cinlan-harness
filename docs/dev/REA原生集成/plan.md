# REA 原生集成计划

> 当前交付决定（2026-11-03）：Yorker 要求先迭代一版，不集成 REA。默认组合与设置入口撤出 REA，安全研究 Agent 保留；下文为延后方案与历史实施记录，不作为本轮待办。

> 状态：方案已确认（2026-10-31）；阶段 1–3 已实现并通过测试（2026-11-01），阶段 4 按 YG 决策取消；阶段 6 快照可移植化与启动收口已完成（2026-11-01），阶段 5 文档收口进行中。
> 来源：`docs/dev/合并后执行计划.md` Step 7。

## 1. 定位

REA（[rea-agents](https://github.com/morluto/rea)，MIT）的逆向能力作为 Cinlan Harness **产品内置能力**，跟随"安全研究"组合（`packages/bundle/security-research`）加载。

不走外部集成：不让用户 `npm i -g`、不跑 `rea setup`、不手写 `~/.clh` 配置、不依赖 `~/.agents/skills` 里的技能副本。外部方案（全局 npm 安装 + home 层 patch + 共享 skills 目录）已否决：它把 REA 装进每个 profile（范围过大）、依赖用户手动维护、且与"只有安全研究需要它"的产品语义不符。

**使用方式：直接说大白话。** 用户在安全研究会话里说"帮我看看这个 exe 是干嘛的""这个 apk 的登录签名怎么算的""反编译一下这个 dll 的 main"，就能直接工作，不需要知道 REA、MCP、工具名或任何命令。

## 2. 前置阻塞项 → 已决策（2026-10-31）

| 检查项 | 结果 |
|---|---|
| 依赖许可 | ✅ rea-agents `6.8.0`，MIT，无传染性；许可证随包分发 |
| 产品运行时 Node | ⚠️→✅ rea-agents engines 要求 `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1`；产品分发链上两处 Node 均不满足，按下方决策补齐 |

### 2.1 已核实的事实

- rea-agents `engines`：`^22.23.4 || ^24.22.1 || >=26.12.1`（`rea.mjs` 入口无运行时版本门，但部分工具依赖新 Node API，如 `inspect_sqlite_database` 要求 `>=24.15` 的 `DatabaseSync.limits`，低版本会静默降级）。
- 桌面 Host 跑在 **Electron 内置 Node** 上（`apps/desktop/src/main.ts:217`），本机 Electron 44.0.0 内置 Node 是 `24.18.1` ——低于 `24.22.1`。
- 产品随包分发 **primary-runtime Node**，`scripts/primary-runtime/lock.json` 锁定 `24.21.0`，`apps/desktop/src/command-management.ts:139` 已用它执行命令——同样低于 `24.22.1`，差距只在补丁版本。

### 2.2 YG 决策（改良版 b，不选 a）

不升级产品主运行时（不改 Electron、不改根 `engines`、不动 Host 启动链路）；改为**只升级 primary-runtime 的补丁版本**，并让 `security-rea` 用它 spawn REA：

1. `scripts/primary-runtime/lock.json` 的 `nodeVersion` 升到 Node 24 最新补丁版（`>=24.22.1`），各平台产物 sha256 从 nodejs.org `SHASUMS256.txt` 取回同步更新，跑 `scripts/primary-runtime/prepare.spec.ts` 验证。属官方文件改动：登记在 §7 官方文件改动清单，注明"同大版本补丁升级，合并上游时取较高版本"。
2. `security-rea` 新增 `Config` 字段 `nodeExecutable`（spawn REA 的 Node 路径），**不**用 `process.execPath`；安全研究组合默认填 primary-runtime 的 node 路径——解析方式参照 `apps/desktop/src/host-process.ts` 与 `main.ts` 传递 primary-runtime 的机制，不写死。
3. 启动 REA 前校验该 Node 版本满足 rea-agents engines（读 `rea-agents/package.json` + semver 判断）。不满足时**不抛错、不阻塞产品启动**：`status()` 返回 `unavailable` + 原因；设置页 REA 卡片与会话回复用大白话提示"逆向分析需要更新运行时"。带测试。
4. 开发环境做法：nvm 装 Node 24 最新补丁版，开发 profile 把 `nodeExecutable` 指向它（`$CLH_HOME/profiles/<name>` 的 patch 层）。

## 3. 设计

### 3.1 新包 `packages/security/security-rea`

完整 capability seam（Service Definition + Provider），职责：

- 精确固定依赖 `rea-agents`（`pnpm add` 加 `--registry=https://registry.npmjs.org`，本机默认 npmmirror 与 lockfile 不匹配）。
- 在自身 fiber 里挂载 `@deepseek-ai/dsh-mcp-client`（stdio、`serverName: 'rea'`、command 用产品 Node + 包内 `node_modules/rea-agents/scripts/rea.mjs mcp`）。
- 状态目录 `<clh home>/security/rea/`；env 隔离（断言 `DSH_HOME`、`.dsh` 不进子进程 env）。
- 可调项全部做成 `Config` 字段（不设 `DEFAULT_*` 常量，遵守"no hardcoded tunables"）。
- 对外提供 `status()` 与 `doctor()`：连接状态、REA 版本、本机检测到的逆向工具（Ghidra、JDK、Frida、adb 等）。

### 3.2 大白话路由

- `ctx.skills.register()` 注册产品内置逆向技能（以 REA 自带的 `reverse-engineer-anything` 为底），技能描述补齐中文口语触发词：逆向、反编译、脱壳、找签名、看看这个 exe/dll/so/apk、分析协议、这个程序干嘛的。
- `security-workflow-prompt` 与 security-research preset 写明："用户给出二进制、安装包或网页目标时，直接用 REA 工具取证分析，不要求用户指定工具；结论先行，用大白话回复。"
- 快照用例：用户只说"帮我看看这个 exe 是干嘛的"→ 断言模型调用 `mcp__rea__*` 工具。

### 3.3 权限

只读静态分析工具在授权范围内直接可用；会运行目标、改设备或改分析数据的工具走 assessment-scope 审批（`assessment-scope-tool-policy` 放行只读类、动态/变更类走审批）。

### 3.4 设置页（已取消，2026-11-01 YG 决策）

不设设置卡片、不加 Remote 方法：REA 是安全研究组合的内置能力，打开安全研究即可直接使用；不可用时由服务状态与会话内大白话提示兜底（"逆向分析需要更新运行时"）。原 Remote/卡片草案作废，若后续需要诊断面，可再评 `doctor()` 的产品化出口。

## 4. 实施阶段

### 阶段 1：`security-rea` 包骨架 ✅（2026-11-01）
- 新包（Service Definition + Provider + Config）✅
- 固定 `rea-agents@6.8.0` 依赖，stdio 挂载 mcp-client ✅
- `status()`/`doctor()` + env 隔离断言（`.dsh`/`DSH_*` 拒绝）✅
- 单元测试 16/16 过（`tests/security-rea.spec.ts`）✅

### 阶段 2：接入安全研究组合 ✅（2026-11-01）
- `packages/bundle/security-research` 的 `package.json` + `cordis.patch.yml` 增 `security-rea` 条目 ✅（`nodeExecutable` 从 primary-runtime argv 推导，`!!js` 表达式）
- `assessment-scope-tool-policy` 规则 ✅：`mcp__rea__*` 按类归入 `shellTools`/`networkTools`/`browserTools`（默认项随行），只读检视类不列名自然直通
- `verify-cordis-config` 待跑

### 阶段 3：大白话链路 ✅（2026-11-01）
- 内置逆向技能注册 ✅：服务构造时经 `ctx.skills.register()` 挂载 `reverse-engineer-anything`（读 `rea-agents` 自带 SKILL.md，`resourceBase` 指技能目录），描述带中文触发词（`REA_SKILL_DESCRIPTION`）
- preset + `security-workflow-prompt` 文案 ✅：persona 与 `security:rea` 段都写明"给目标直接分析、结论先行、大白话"，含 帮我看看这个 exe 是干嘛的 / 想拿到这个页面里没权限看的内容 两个例句
- 快照用例 ✅ 组合级快照（`tests/security-rea.spec.ts`：patch 条目 + 工具分类 + persona/技能触发词断言）；真正模型回放快照待会话录制设施

### 阶段 4：设置页 ❌ 取消（2026-11-01 YG 决策）
不设 REA 设置卡与 Remote 方法；不可用时经 status()/对话大白话兜底。

### 阶段 5：收口
- README 三件套（en/zh/i18n）✅（2026-11-01 补模型侧 token 实测数字）
- Agent Note（第三方能力产品内置、随组合加载、大白话触发）
- 执行计划勾掉 Step 7、附录 F 改完成
- 提醒 YG 旧外部方案残留（全局 `rea`、`~/.agents/skills/reverse-engineer-anything`）可删与否

### 阶段 6：快照可移植化 + 启动收口 ✅（2026-11-01）
- `rea-routing` 快照不再依赖本机绝对路径与真实 REA：cordis.yml / cordis.snapshot.yml 改用 `!!js process.execPath` + `!!js process.env.DSH_REA_FIXTURE_SERVER`；`headless.snapshot.ts` 注入确定性假 MCP server（`security-rea/tests/fixtures/rea-stub-server.mjs`，5 个代表性工具，schema 取自真实 REA 定义子集），快照经正常 refresh 流程重新生成，路由断言（'帮我看看这个 exe 是干嘛的'→ `mcp__rea__*`）不变。
- `startupTimeoutMs` Config 字段（默认 15000ms）：首次连接就绪按配置上限等待；超时或不响应的服务器标记 `unavailable`/`startup-timeout`，服务照常激活不阻塞、不抛错。假 hang server（`rea-stub-hang-server.mjs`）覆盖不卡死路径。
- 真实 REA 连通性冒烟（`security-rea.spec.ts` 末项）：Node 不满足 engines 或无 REA 时 `testCtx.skip`，不进快照。
- 顺手修上游 bug：`mcp-client` 连接快照 `state.tools` 恒为 `[]`——`syncTools` 新增加载描述符的 `onCommitted` 回调，`connection.ts` 缓存 `committedTools`，`getSnapshot()`/`probe()` 惰性合并；`status().toolCount` 由此正确反映已注册工具数。
- `session-snapshot/src/normalize.ts`：cwd 拼写表增补双反斜杠变体（JSON 转义写法 `C:\\Users`），见 §7。
- **HEAD 快照 collection 修复（2026-11-01）**：`ralph-loop/snapshot.yml` 误把 `composition` 写成 `default`，与 `text-turn` 争同一个 patch owner（`headless composition default has multiple patch owners`）。其 `cordis.snapshot.yml` 注释本就自述"for the `ralph` composition"——改为 `composition: ralph` 并加 `header.pin: true`（沿用 `worktree` 先例：独立 composition 自管 header pin）。`collectScenarios` 的 "one current-writer pin" 检查（168 场景）通过。
- **框架 bug 记录（llm-replay adapter 重复注册，阻塞 replay 验证）**：`dsh --profile headless` 重放时 `installLlmReplay` → `registerAdapter` 在 `llm/src/index.ts:443` 抛 `an adapter for provider "deepseek-official" is already registered`，`text-turn`/`error-finish` 等既有场景同样 exit 1（HEAD 既有故障，非本任务引入）；`ralph-loop`/`rea-routing` 表现为 30s 不退出，应为同一断点的不同失败模式。只记录、不修——归属 llm/llm-replay 上游。
- **框架 bug 记录（stabilizeRefreshLog）**：refresh 顺序为 `stabilizeRefreshLog` → `portableFixture`/`tokenizeSessionFixtureCwd`。stabilize 把 fresh 的 volatile 字符串映射回**旧 fixture** 的实值以保跨次稳定；当旧 fixture 内嵌字面 cwd（如上一轮临时目录 `dsh-log-snap-<old>`）时原样回填，而 cwd 转义只替换**本次** run 的路径 → 旧临时路径字面量漏进新 fixture（表现为 fixture 里残留过期的 `dsh-log-snap-*`）。复现：旧 fixture 含非 portable 的 cwd → 以新临时目录再 refresh → 新文件仍含旧字面路径。未手改 fixture 绕过：以 portable 配置重跑 refresh 生成干净 fixture 后该路径不再出现。修法建议：normalize 阶段先把 cwd 改写为 volatile 占位（或 stabilize 对 cwd 类路径串同样走 token），再映射旧值——待上游评估，勿在快照层打补丁。

## 5. 验收

1. 安全研究 profile 启动后 `mcp__rea__*` 工具可用，无需任何用户配置。
2. 用户只说"帮我看看这个 exe 是干嘛的"→ 路由经技能触发词 + persona/workflow prompt 落到 `mcp__rea__*`：组合级断言已测；`rea-routing` 模型回放快照已落地（假 MCP server，5 工具），且 fixture 无平台/本机路径依赖。
3. `status()`/`doctor()` 报告 REA 版本、连接状态、本机工具检测清单；运行时不满足时对话里大白话提示"逆向分析需要更新运行时"；`startupTimeoutMs` 内服务未就绪 → `unavailable`/`startup-timeout`，不阻塞激活。
4. 动态/变更类工具走 assessment-scope 审批；只读检视类直通。
5. `verify-cordis-config`、typecheck、focused tests 通过；`security-rea` spec 20/20（含 1 条按条件 skip 的真实 REA 冒烟）；`test:coverage` 归属 mcp-client 的两处历史失败与本改动无关（stash 基线复现同一批 22+2）。

## 6. 非目标

- 不做 REA 自动更新（先固定版本，更新评估后置）。
- 不碰官方文件（除 §7 清单）；`security-rea` 全部在 fork 自有目录。
- 不依赖全局安装、不读 `~/.agents/skills`、不写 `~/.dsh`。

## 7. 官方文件改动清单

（新增项见表尾；`mcp-client` 与 `security-rea` 属本仓自有代码，不入表；`stabilizeRefreshLog` 为框架 bug 记录于阶段 6，未动）

| 文件 | 改动 | 上游提案评估 |
|---|---|---|
| `scripts/primary-runtime/lock.json` | `nodeVersion` 24.21.0 → 24.22.2 + 五平台 `nodeSha256` 同步（SHASUMS256.txt） | 不提上游；属产品分发锁定清单。合并上游时取较高版本 |
| `scripts/primary-runtime/prepare.ts` | 合并重复 `node:fs` import（`existsSync` 并入主 import 行，删重复行） | 可以，作为修复：重复声明直接让 `prepare.spec.ts` 编译失败 |
| `packages/test-support/session-snapshot/src/normalize.ts` | cwd 拼写表补 `value.replaceAll('\\', '\\\\')` 双反斜杠变体，JSON 转义的 Windows 路径（`C:\\Users\\…`）也能归一化到 `{{cwd}}` | 可以，bug 修复：Windows 上 JSON 转义后的 cwd 写法无法归一化 |
| `packages/mcp/mcp-client`：`src/index.ts`、`src/types.ts`、`src/tools.ts`、`src/connection.ts` | `Config`（stdio/streamable-http 两臂）新增可选 `toolFilter: readonly string[]`——`syncTools` phase-1 按 **raw** tool name 裁剪，注册前丢弃，被裁工具不进 `ctx.tools` 也不进模型目录；`security-rea` 经 `StdioConfig.toolFilter` 使用 | 可以，通用能力 |

## 8. 工具面与 token 成本

> 实测：2026-11-01，`rea-agents@6.8.0`（229 个 `mcp__rea__*` 工具）。字节为 MCP `tools/list` 实收 JSON；token 按 ~3.6 字符/token 估算（cl100k 近似），README 同步。

### 8.1 MCP wire 与模型侧成本（实测）

| profile | tools/list 字节 | inputSchema | outputSchema | names+descs | 估算 token（模型可见） |
|---|---|---|---|---|---|
| 默认（input=compact, output=full） | 3,504,983 | 121,537 | 3,199,098 | 139,509 | ≈ 73k |
| `REA_MCP_OUTPUT_SCHEMA_PROFILE=off` | 302,346 | 121,662 | 458 | 139,509 | ≈ 73k |
| `REA_MCP_INPUT_SCHEMA_PROFILE=full` | 4,231,228 | 847,782 | 3,199,098 | 139,509 | ≈ 275k |
| input=full + output=off | 1,029,866 | 849,182 | 458 | 139,509 | ≈ 275k |

- **模型可见成本** = name+description+inputSchema：DeepSeek 序列化（`llm-deepseek/src/serialize.ts`）只发 `name/description/input_schema`，`outputSchema` 与 `instructions` 均不进模型请求。默认 compact input 下 229 工具 ≈ 261 KB ≈ **73k token/请求**；`instructions`（2,924 B ≈ 812 token）经 `systemPrompt` 段进系统提示。
- **wire/内存成本** = 3.5 MB `tools/list`（其中 outputSchema 3.2 MB）+ 每次 `listTools` 的解析与 `assertSupportedJsonSchema` 校验；不进模型但实打实走子进程 stdio 与宿主内存。
- `output=off` 对行为零影响：`mcp-client` 的 `structuredContent` 字段照样透传，只是不再带服务端声明的输出 schema；3.5 MB → 302 KB 是纯赚。
- `input=full` 把 inputSchema 从 121 KB 撑到 849 KB（≈275k token），收益只是更细的参数注解——不建议。

### 8.2 REA 官方取值（读 `rea-agents@6.8.0` 源码确认，非猜）

- `REA_MCP_INPUT_SCHEMA_PROFILE`：`"compact"`（**默认**）或 `"full"`；compact = "advertises bounded input schemas with fewer nested annotations"（`mcpInputSchemaProfile.js` / `createServer.js`；Kimi client 注册时缺省值也自动填 `"compact"`）。
- `REA_MCP_OUTPUT_SCHEMA_PROFILE`：`"full"`（默认）或 `"off"`；off 时 `tools/list` 不再带 output schema，服务端仍按 canonical contract 校验返回内容（`mcpOutputSchemaProfile.js`）。

### 8.3 工具过滤缝（已落地实现）

- `mcp-client` 的 `Config` 原本**没有**工具过滤字段；本次在 `StdioConfig`/`StreamableHttpConfig`/`ToolBridgeOptions` 新增 `toolFilter: readonly string[]`，`syncTools` phase-1（`tools/list` 返回后、public-name 映射前）按 raw name 裁剪——注册前裁掉，既省 wire/内存也让模型只看到子集。
- `ToolsService.restrict({allow,deny})` 存在但**只作用于 agent scope**：全局 ctx 调它直接抛错（"deny the tool for the intended agent instead"），组合层无法用它做服务端白名单——因此过滤缝开在 `syncTools`。
- `security-rea` 侧：`Config.toolAllowlist` 整体替换默认集、`Config.additionalTools` 追加放行（动态/设备类按需开启），两者去重后传给 `StdioConfig.toolFilter`。

### 8.4 已落地默认与工具面决策

1. **`output=off` 已落地**（2026-11-01 YG 决策）：`Config.outputSchemaProfile` 新增字段，默认 `off` 注入 `REA_MCP_OUTPUT_SCHEMA_PROFILE`——wire 3.5 MB → 302 KB，模型侧无变化，行为无回归；设 `full` 可还原。测试：`rea-stub-env-server.mjs` 探针断言子进程 env。
2. input 保持默认 `compact`（73k/请求可接受；`full` 涨到 275k 不值）。
3. 工具面决策（2026-11-01 实测推翻原计划）：deferLoading 链路调研结论见 §8.5.1——它管“可调用性”不管“成本”，且 baseline 后无激活路径、当前模型目录半数缺 `toolUpdate` 元数据；**按 YG 兜底条款改走白名单**并已落地（§8.5.2）：`mcp-client.Config.toolFilter` + `security-rea` 默认 62 个静态分析核心工具（`REA_DEFAULT_TOOL_NAMES`），≈19k token/请求；动态车道经 `additionalTools`/`toolAllowlist` 按需开启。

### 8.5 工具面调研与落地

#### 8.5.1 deferLoading 调研结论（三个问题的答复）

1. **模型怎么发现/激活 defer 工具**：schema 完整序列化（`llm-deepseek/serialize.ts:165` 只加 `defer_loading: true` 标志，`name/description/input_schema` 全量发出）——**per-request token 成本一分不降**；激活依赖 `tool-addition` developer 块，由 `agent-loop/src/agent.ts` 对前后请求 header 的 tool-name diff 发出。**harness 内没有任何工具搜索/模型侧激活入口**（grep 全仓库仅 `llm-pi-ai` 测试字符串），baseline 时就标记 defer 的工具**永远不会被激活**——它只为 `when` 门控的动态注册设计（`dynamic-tool-updates` fixture：条件翻转→进 active set→emit addition→可调）。
2. **当前 DeepSeek 模型元数据**：`llm-deepseek/src/models.ts` 默认目录中 `deepseek-flash` 声明 `toolUpdate: 'addition-only'`；`deepseek-v4-pro` **未声明**。
3. **未声明时的退化行为**：`llm/src/content.ts` `projectToolUpdates()` 剥掉 `deferLoading` 标志并丢弃 developer 更新块，全量工具立即可用——安全退化但零收益。

**结论：deferLoading 解决的是“工具集随步骤动态扩增”的声明问题，不是 token 瘦身。用错机制；白名单才是省 token 的正解。**

#### 8.5.2 白名单落地与实测（2026-11-01，`rea-agents@6.8.0` catalog 静态统计）

- 默认 `REA_DEFAULT_TOOL_NAMES`：**62 个静态分析核心工具**（会话生命周期、原生清单、函数级分析、调用图/引用追踪、native inspect、主流格式探针、证据访问、分析师批注）。动态车道（adb 24、frida 9、调试器/rizin 11、运行时 capture 4、live web/electron 15）默认排除，`additionalTools` 按需放行或 `toolAllowlist` 整体替换。
- 实测：229 → 62 工具，模型可见 schema 从 271 KB 降到 **69.5 KB ≈ 19k token/请求（-74%）**；加上 `output=off` 的 wire 收益（3.5 MB→302 KB）是叠加的。
- 静态全集（排除全部动态车道）为 166 个 / 204 KB，仅省 27%——为满足“40 个左右”的意图取核心工作流集；完整取舍见 `src/index.ts` 的常量注释。
- 测试：`security-rea.spec.ts` 三例（默认裁掉 `instrument_with_frida`、`additionalTools` 放行、`toolAllowlist` 整体替换）；`mcp-client.spec.ts` 一例（toolFilter 仅注册白名单内 raw name，含点号名规范化验证）。
