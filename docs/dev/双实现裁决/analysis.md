# 树内双实现裁决分析（Step 2）

> 生成日期：2026-10-31
> 依据：`docs/dev/合并后执行计划.md` Step 2、`docs/dev/官方功能差距对比.md` 第二节、`.devin/rules/Cinlan Harness Fork 边界与同步规则（窄 fork + 宽插件）.md` 第 3 节
> 方法：`git log upstream/master -- <目录>` 判归属；`git diff upstream/master HEAD` 与 `git log HEAD --not upstream/master` 找本地增量；实测运行可疑测试
> ~~本报告只做分析，未改代码、未删包、未改任何配置。所有裁决均为建议，待 YG 确认，未执行。~~
> **执行状态（2026-10-31）：YG 已确认并全部执行完毕，执行结果见 §7。**

## 0. 先修正一个前提：三组"撞车"的真实形态

逐组用 git 取证后，三组的实际形态与计划文档的假设有出入：

| 组 | 计划假设 | 取证后的实际形态 |
|---|---|---|
| Ralph | 我们的 `workflow/tool-ralph` vs 官方 `experimental/tool-ralph` | **双实现已不存在**。upstream 在 `b48384223a`（refactor(experimental)!: classify optional packages and move prototypes）已把 `workflow/tool-ralph` 移到 `experimental/tool-ralph`；upstream 当前树无 `packages/workflow/tool-ralph`。本地工作树里该目录也已不存在，剩余 4 个本地文件正以 **staged rename（R）** 移往 `experimental/tool-ralph`（在途改动，未提交，本会话未碰） |
| session-title | 我们的 `session/session-title` vs 官方 experimental bundle | **两边都是官方的**，且是分层关系不是平行实现：`session-title-all-prompts-llm` 的 peerDependencies 直接依赖 `dsh-session-title` + `dsh-session-title-llm`（experimental bundle 是插在核心服务上的 provider 插件）。我们的本地增量只有 3 个测试文件，且实测全部失败（见 §2） |
| CUA | 我们的 `computer-use/*` vs 官方 `experimental/cua*` | 部分成立。官方 `cua`/`cua-bundle`/`cua-macos` 都 peer/依赖 `dsh-computer-use`——**官方实现建在我们共同拥有的 provider 注册 seam 之上**，底层已统一。真正重叠的只有模型可见工具面；我们侧还有两个官方没有的独有包 |

---

## 1. Ralph：`workflow/tool-ralph`（已消失）vs `experimental/tool-ralph` + `ralph-bundle`

### 1.1 归属判定

- `git log upstream/master -- packages/experimental/tool-ralph`：有大量 upstream 提交（release 0.2.2-alpha.2/alpha.1、rc.4 合并等）→ **官方**。
- `git log upstream/master -- packages/workflow/tool-ralph`：仅命中移动提交 `b48384223a`（把包从 workflow/ 移到 experimental/）→ 旧路径，upstream 已放弃。
- 本地独有提交（`git log HEAD --not upstream/master`）：`experimental/tool-ralph` 0 个、`ralph-bundle` 0 个；`workflow/tool-ralph` 7 个但全部是历史同步/合并提交，目录在当前工作树已不存在。
- 结论：**官方实现是唯一实现**。合并时 upstream 的代码（`src/index.ts` 与 upstream 逐字一致）被保留，我们旧路径上的增量只剩 4 个文件，正被 staged rename 挪进官方新位置：
  - `packages/experimental/tool-ralph/src/settings.ts`（新增 `ralphPolicy` Host 服务）
  - `packages/experimental/tool-ralph/tests/policy-settings.spec.ts`、`tests/policy-settings.cordis.yml`
  - `packages/experimental/tool-ralph/tsdown.config.ts`

### 1.2 功能对照表

| 维度 | 官方 `experimental/tool-ralph`（+ `ralph-bundle`） | 我们的（旧 `workflow/tool-ralph` 增量） |
|---|---|---|
| 工具名 / 模型可见面 | `ralph-loop`（`src/index.ts` 内注册名；cli e2e 里以 `ralph` 出现，见 `apps/cli/tests/optional-bundle-transitions.e2e.ts:289`）；system prompt 走 workflow/seam | 同一个包、同一工具名，无差异 |
| 配置项 | `maxRounds`（默认 256）、`subagentProvider`；无 settings 面 | 官方全部 + 我们新增 `ralphPolicy`（`enabled` 默认 false、`maxRounds` 默认 64，volatile，Host 作用域） |
| 平台支持 | 全平台 | 同 |
| 测试数量 | `tool-ralph` 3 个 spec / 19 its（含我们 staged 的 policy-settings 1 it）；`ralph-bundle` 0 spec | 增量即 policy-settings 1 it，**实测通过**（1 passed） |
| 定位差异 | 官方：opt-in 实验包（`listedByDefault: false`，进 `OPTIONAL_BUNDLES`） | 我们：`bundle/base/cordis.patch.yml:448-452` 把 `tool-ralph` 直接挂进 base（**upstream 的 base 无此条目**，系我们本地新增） |

### 1.3 引用清单（我们的版本 / 相关挂载点）

- `packages/bundle/base/cordis.patch.yml:447-452` — base 默认挂 `@deepseek-ai/dsh-tool-ralph`（`maxRounds: 64`，我们本地新增）
- `packages/experimental/ralph-bundle/cordis.patch.yml:12-16` — 官方 bundle 挂同一包
- `packages/util/official-bundles/src/bundles.ts:66` — `ralph-bundle` 在 `OPTIONAL_BUNDLES`
- `packages/util/official-bundles/src/plugin-manager.ts:58`、`:77` — `MORE_BUNDLES` / `EXPERIMENTAL_BUNDLES`
- `packages/util/official-bundles/src/catalog.generated.ts` — 生成目录
- `apps/cli/package.json:111`（`dsh-experimental-ralph-bundle`）、`:125`（`dsh-tool-ralph`）
- `apps/cli/tests/optional-bundle-transitions.e2e.ts:176`（期望默认 agent **不含** `ralph` 工具）、`:285-297`（bundle 开关切换 ralph）

### 1.4 关键张力与未接线事实

- 全树（HEAD）搜索 `ralphPolicy`：只出现在 staged 的 `settings.ts` 和它的测试里。**upstream 的 `tool-ralph/src/index.ts` 不消费它**——这是一个没有任何消费者的死服务。
- 推断其意图：base 默认挂载 `tool-ralph` 与 cli e2e"默认 agent 不含 ralph"的期望冲突，`ralphPolicy`（默认 `enabled: false`）疑似准备作为默认关闭的门，但接线（index.ts 读取 policy）没有完成。疑似合并会话/上一个 Step 2 会话的在途半成品。
- `policy-settings.spec.ts` 自洽可过（已实测 1 passed），但它只测 policy 服务自身，不测与 ralph-loop 的集成。

### 1.5 裁决建议：**让位官方（结构上已达成）+ 处置 4 个本地文件（二选一，需 YG 定）**

- **理由**：upstream 已把包收编进 `experimental/` 并持续维护（release 提交）；我们的旧路径实现已无独立价值。工具名、配置、行为与官方完全同源，无双实现维护成本可省。
- **4 个 staged 文件的处置选项**：
  1. **完成接线（保留）**：让 `tool-ralph/src/index.ts` 在每次调用前读 `ctx.ralphPolicy.current()`，`enabled: false` 时拒绝——这样 base 默认挂载 + 默认关闭 + settings 可开，兼顾我们产品"base 自带"与官方 opt-in 语义，并让 cli e2e 的默认期望成立。
  2. **删除（彻底让位）**：丢弃 4 个文件，同时把 `bundle/base/cordis.patch.yml:447-452` 的 tool-ralph 条目摘掉（回到官方 opt-in 形态，需要用时装 ralph-bundle）。
- **风险**：
  - 选 1：改动官方包 `src/index.ts`（违反"窄 fork"纪律第 2 节"收敛到无扩展点的最后一处"，需在 PR 说明列清单）；且 `maxRounds` 双层（policy 64 / config 256）语义要写清。
  - 选 2：base 失去 ralph 能力，依赖 ralph 的既有用户/profile 需改挂 ralph-bundle。
  - **历史会话回放**：两种选项工具名都不变（同包同注册名），回放无影响。唯一风险是若选 2 且某历史会话在 base 默认挂载期间用过 `ralph` 工具，回放环境若无 ralph-bundle 会出现未知工具——需在执行时抽查历史会话。
- **结论：待 YG 确认，未执行。**

---

## 2. session-title：`session/session-title` vs `experimental/session-titles-bundle` + `session-title-all-prompts-llm`

### 2.1 归属判定

- `packages/session/session-title`、`session-title-llm`、`session-title-first-prompt-llm`：upstream 树内全部存在，本地独有提交 0（`session-title` 的 6 个"本地独有"全是历史同步/合并提交）→ **官方**。
- `experimental/session-titles-bundle`、`session-title-all-prompts-llm`：upstream 树内存在，本地独有提交 0 → **官方**。
- 结论：**本组不存在"我们 vs 官方"**，是官方自己的核心服务 + 两个 cadence provider 的分层结构：
  - `session-title`：log-backed 标题服务 + provider 注册表（Config：`fallbackMaxWords`/`fallbackMaxBytes`/`maxTitleBytes`/`automatic: 'first-prompt' | 'all-prompts'`，见 `src/index.ts:56-127`）
  - `session-title-llm`：provider 基座；`first-prompt-llm`（稳定，base 默认挂）与 `all-prompts-llm`（实验，titles-bundle 挂）是两个 provider 实现
  - `all-prompts-llm` package.json peerDependencies 显式依赖 `dsh-session-title` + `dsh-session-title-llm` → 插件关系实锤

### 2.2 功能对照表

| 维度 | `session/session-title`（核心，官方稳定） | `session-titles-bundle` + `all-prompts-llm`（官方实验层） |
|---|---|---|
| 工具名 / 模型可见面 | 无模型工具（后台标题服务） | 无模型工具；仅改变标题刷新 cadence（每条 human prompt 都刷新 vs 仅首条） |
| 配置项 | `fallbackMaxWords: 5`、`fallbackMaxBytes: 40`、`maxTitleBytes: 80`、`automatic` cadence | `targetWords: 5`、`targetCjkCharacters: 10`（provider 级） |
| 平台支持 | 全平台 | 全平台 |
| 测试数量 | 核心 9 spec / 53 its（upstream 7 spec + 我们 2 个失败 spec）；`session-title-llm` 1/15；`first-prompt-llm` 2/9；`all-prompts-llm` 1/8；`titles-bundle` 0 | — |

### 2.3 引用清单

- `packages/bundle/base/cordis.patch.yml:61-72` — 挂 `session-title` + `first-prompt-llm`（与 upstream base 一致，非我们增量）
- `packages/bundle/sdk-minimal/package.json:59`、`cordis.patch.yml:113-117` — upstream sdk-minimal 也挂核心服务
- `packages/util/official-bundles/src/bundles.ts:69`、`plugin-manager.ts:56` — titles-bundle 在官方可选 bundle 清单
- `apps/cli/package.json:112` — titles-bundle
- `apps/cli/tests/optional-bundle-transitions.e2e.ts:299` — "switches title cadence off/on/off" e2e

### 2.4 我们的本地增量（唯一需要裁决的东西）

`packages/session/session-title/tests/` 下 3 个文件（随合并提交入库）：

- `automatic-settings.spec.ts`（87 行）
- `profile-settings.spec.ts`（49 行）+ `profile-settings.cordis.yml`（10 行）

**实测结果：2 个 spec 全部失败**（本会话运行 vitest 验证）。原因：测试断言 `ctx.settings` 里有 `ns === 'session-title'`、值为 `{ automaticEnabled: true }` 的设置项，但当前服务 Config（`src/index.ts:56-62`）只有 `fallbackMaxWords/fallbackMaxBytes/maxTitleBytes`，**没有 `automaticEnabled` 字段**；`automatic-settings.spec.ts:32` 调用的 `ctx.sessionTitle.register({...})` 签名也与现服务不符。这是合并会话遗留的过期 WIP 测试（可能针对一个未落地/已改形的 settings 集成方案）。

### 2.5 裁决建议：**让位官方（删除我们的 3 个失败测试文件）**

- **理由**：核心服务与两个 provider 都是官方的且分层清晰，无任何双实现维护成本可省；我们唯一的增量是 3 个当前必失败的测试文件，留着只会污染 `pnpm run test`。
- **风险**：极低。需先向合并会话负责人确认 `automaticEnabled` 不是计划中的新设置面（若是计划功能，应先实现服务侧再留测试，而不是删测试）。无工具名变化，历史会话回放零影响。
- **结论：待 YG 确认，未执行。**

---

## 3. Computer Use：`computer-use/*`（+ cua-driver-*）vs `experimental/cua` + `cua-bundle` + `cua-macos`

### 3.1 归属判定

| 包 | upstream 树内 | 本地独有提交 | 判定 |
|---|---|---|---|
| `packages/computer-use/computer-use`（seam） | 有 | 8（含实质改动） | 官方基础 + **我们大改**（diff +3342 行：branded ID、`ComputerUseError`、`registerProvider`/readiness、重复注册防护等） |
| `packages/computer-use/tool-computer-use` | **无** | 有 | **我们独有** |
| `packages/computer-use/computer-use-permission-policy` | **无** | 有 | **我们独有** |
| `packages/experimental/cua` | 有 | 0 | **官方**（工作树有 2 个其他会话的在途修改文件，未碰） |
| `packages/experimental/cua-bundle` | 有 | 0 | **官方** |
| `packages/experimental/cua-macos` | 有 | 0 | **官方**（有独立功能提交：notarized helpers、smoke 测试等，活跃维护） |
| `packages/experimental/computer-use-cua-driver-mcp` / `-native` | 有 | 7 / 8 | 官方包 + 我们的适配改动 |

### 3.2 关键架构事实

- 官方 `cua` 的 dependencies 含 `@deepseek-ai/dsh-computer-use`；`cua-bundle`/`cua-macos` peer 它——**官方整套建在我们共同维护的 seam 上**，`cua-bundle/cordis.patch.yml:2-3` 第一条就是挂 `dsh-computer-use`（provider registry）。
- 两边的模型可见工具面不同源：
  - 官方 `cua`：**单一 `cua` 工具**（`src/index.ts:282`，backend dispatch）+ system prompt section `computer-use:dsh-cua`（`:326`）+ 授权流（peer `dsh-user-questions`，client 端 `ApplicationApproval` 审批卡）。
  - 我们的 `tool-computer-use`：6 个固定工具 `computer_list_apps` / `computer_list_windows` / `computer_observe` / `computer_pointer` / `computer_keyboard` / `computer_accessibility` + system prompt section `tool:computer-use`。
  - 实际在线的工具面（第三条路）：`cua-driver-native` 通过 Cua Driver SDK **动态发现并发布工具**（`src/index.ts` 的 ToolCatalog/toolNames），这才是我们产品当前真正暴露给模型的桌面工具。
- 平台：官方 `cua-macos` 仅 darwin（`cua-bundle/cordis.patch.yml:6` 用 `disabled: !!js process.platform !== 'darwin'` 门住；`catalog.generated.ts:24-26` 标 `platforms: ['darwin']`）；我们的 `cua-driver-native` 跨平台（Windows 桌面能力的唯一来源）。

### 3.3 功能对照表

| 维度 | 我们侧（computer-use seam 扩展 + permission-policy + tool-computer-use + cua-driver-native） | 官方侧（cua + cua-bundle + cua-macos） |
|---|---|---|
| 工具名 / 模型可见面 | cua-driver 动态工具（在用）；`computer_*` 6 工具（**未挂载，孤儿**） | 单一 `cua` 工具 + macOS backend |
| 配置项 | `computer-use` provider 选择（`provider: cua-driver-native`）；permission-policy `native: ask/allow/deny` | `agentPreset: ptc`；bundle 级 darwin 门；授权走 user-questions |
| 平台支持 | 跨平台（Windows 实测在用） | macOS only（cua-macos） |
| 测试数量 | seam 2 spec/8 its；tool-computer-use 1/10；permission-policy 1/3；cua-driver-native 4/12；cua-driver-mcp 2/8 | cua 12 spec/**149 its**；cua-macos 7/64；cua-bundle 1/0 |
| 授权/审批 UI | permission-policy 服务级门（ask/allow/deny） | 完整 client 审批流（ApplicationApproval composer 卡 + `cua-permission-outcome` shell overlay） |

### 3.4 引用清单（文件:行号）

我们的版本被引用于：

- `packages/bundle/cinlan-computer-use/package.json:41-43` — deps：`dsh-computer-use` + `dsh-computer-use-permission-policy` + `dsh-experimental-computer-use-cua-driver-native`
- `packages/bundle/cinlan-computer-use/cordis.patch.yml:5-16` — 挂 seam（`provider: cua-driver-native`）+ permission-policy（`native: ask`）+ cua-driver-native
- `packages/bundle/web-capability-defaults/cordis.patch.yml:6-7` — 启用 `computer-use-cua-driver-native`（该 bundle 与 cinlan-computer-use 均为**我们独有**，upstream 树内不存在）
- `apps/cli/package.json:36` — `dsh-cinlan-computer-use`
- `apps/web/tests/browser-resources.e2e.ts:55-66` — profile 组合 `base + web-app + cinlan-browser + cinlan-computer-use + web-capability-defaults`
- `apps/cli/tests/profiles/device-control/profile.expected.e2e.ts:24,39-44` — 断言 `computer-use-permission-policy` 配置 `native: ask`
- `packages/bundle/cinlan-computer-use/tests/cinlan-computer-use.spec.ts:10` — 显式断言 patch **不含** `dsh-tool-computer-use`

官方侧被引用于：

- `packages/util/official-bundles/src/bundles.ts:85` — `cua-bundle` 在 `ON_DEMAND_BUNDLES`
- `packages/util/official-bundles/src/plugin-manager.ts:52,66`、`catalog.generated.ts:24-26` — 目录（darwin）

`tool-computer-use` 的全部引用：自身包、cinlan-computer-use 的"不含"断言、`tsconfig.base.json`（构建）、migration reports——**没有任何 bundle/profile/apps 挂载它**。

### 3.5 裁决建议：**分层（底层 seam 已统一；工具面各归各位；删孤儿）**

- **seam（`computer-use/computer-use`）**：保留我们的扩展版。官方 cua 族依赖它，我们的扩展是纯增量（新导出 + 防护），兼容官方消费者。这是"我们的做适配/加固层，底层协议统一"的既成事实。
- **`tool-computer-use`（6 个 `computer_*` 固定工具）**：**让位，建议删除**。它未被任何 bundle/profile 挂载，功能与 cua-driver 动态工具面重复，且我们自己的 bundle 测试明确断言不含它。删除前需确认历史会话中没有 `computer_*` 工具调用（该包从未通过 bundle 上线，风险接近零，执行时抽查一次即可）。
- **`computer-use-permission-policy`**：**保留我们的**。在用（cinlan-computer-use + device-control e2e 断言）、官方无等价物（官方授权流是 macOS client UI，我们是服务级策略门）。
- **`cua-driver-native` / `cua-driver-mcp`**：**保留**（官方包 + 我们的适配）。Windows/跨平台桌面能力的唯一来源，删掉 = 产品桌面能力归零。
- **官方 `cua` + `cua-bundle` + `cua-macos`**：**保留在树内，不挂进我们的默认组合**。它们是官方 on-demand bundle（darwin 门），macOS 用户将来可开；其 149+64 个 its 是官方维护投入，留在树内零成本。若未来我们的 macOS 支持要切换到官方 cua，注意**工具名从 cua-driver 动态名变为单一 `cua`**，历史会话回放会出现工具名失配——切换时需做回放兼容评估（这正是"工具名变化对历史会话回放的影响"的主要风险点）。
- **在途改动警示**：`packages/experimental/cua/src/client/ApplicationApproval.tsx`、`mount.ts` 有其他会话未提交修改（composer slot API 适配，9+/6-），本会话未碰；执行任何 cua 相关清理前先等该会话收口。
- **风险**：
  - 删 `tool-computer-use` 需同步清 `tsconfig.base.json` 引用与 cinlan-computer-use 测试里的"不含"断言（断言删包后应改为目录不存在或直接删除断言行）。
  - 保留双工具面（cua-driver 动态 vs 官方 cua）意味着 macOS 上两者可能同时可用——靠 bundle darwin 门 + opt-in 天然隔离，暂无冲突。
- **结论：待 YG 确认，未执行。**

---

## 4. 汇总表

| 组 | 官方判定 | 双实现是否真实存在 | 建议 | 核心执行项（确认后） |
|---|---|---|---|---|
| Ralph | `experimental/tool-ralph` + `ralph-bundle`（upstream 已移包收编） | **否**（旧路径已消失，剩 staged rename 的 4 个本地文件） | 让位官方 + 处置本地增量 | 二选一：完成 `ralphPolicy` 接线，或删 4 文件 + 摘 `bundle/base/cordis.patch.yml:447-452` 条目 |
| session-title | 两边都是官方（核心服务 + provider 插件分层） | **否**（是官方内部分层） | 让位官方（删我们的失败测试） | 删 `packages/session/session-title/tests/{automatic-settings,profile-settings}.spec.ts` + `profile-settings.cordis.yml`（先确认 `automaticEnabled` 不是在途计划） |
| CUA | `experimental/cua` + `cua-bundle` + `cua-macos`（macOS、活跃维护） | 部分（seam 共享；工具面不同源） | **分层** | 删孤儿 `tool-computer-use`（+ tsconfig/断言清理）；保留 permission-policy、cua-driver-*、seam 扩展；官方 cua 族留树不挂默认 |

## 5. 建议执行顺序

1. **session-title（最轻）**：删 3 个失败测试文件。前置确认：`automaticEnabled` 是否其他会话的在途计划。
2. **Ralph（中）**：YG 先定 4 个 staged 文件二选一（接线 vs 删除+摘 base 条目）；注意 staged rename 本身是在途改动，执行时与该会话负责人对齐。
3. **CUA（最重）**：删 `tool-computer-use` 孤儿包；等 `experimental/cua` 的 2 个在途修改文件收口后再动 cua 相关任何东西；macOS 切官方 cua 是远期项，届时单独评估回放兼容。

## 6. 本会话观察到的在途改动（未碰）

- staged rename：`packages/workflow/tool-ralph/{src/settings.ts,tests/policy-settings.*,tsdown.config.ts}` → `packages/experimental/tool-ralph/...`（R，未提交）
- modified：`packages/experimental/cua/src/client/ApplicationApproval.tsx`、`mount.ts`（其他会话 composer slot 适配）
- 其余 `git status` 在途文件一律未碰。

## 7. 执行记录（2026-10-31，YG 已确认）

| 组 | 执行结果 |
|---|---|
| Ralph | 选 2（彻底让位）：`git rm` 4 个 staged 增量文件（`src/settings.ts`、`tests/policy-settings.{spec.ts,cordis.yml}`、`tsdown.config.ts`）；`bundle/base/cordis.patch.yml` 摘除本地新增的 tool-ralph 条目（`git diff upstream/master` 该文件已无 ralph 差异，其他本地条目未动）。回到官方 opt-in（ralph-bundle）形态 |
| session-title | 删 3 个失败测试文件（`automatic-settings.spec.ts`、`profile-settings.spec.ts`、`profile-settings.cordis.yml`）。注：全库搜 `automaticEnabled` 仍有命中——`ui-settings-general/AutomaticTitlesRow.tsx`（未注册的 UI 组件）、`.agents/notes` 旧实现记录、升级指南等，经核实均为其他会话未落地 WIP 或历史文档，**未动**；当前服务 Config 无该字段，删除的测试与现状一致 |
| CUA | 删孤儿包 `packages/computer-use/tool-computer-use`（`git rm -r` + 清 `lib/`、`node_modules/` 构建残留）；同步清理：`tsconfig.base.json` 2 条 paths、`tsconfig.host.json` 1 条 reference、`cinlan-computer-use.spec.ts` 的"不含"断言、`device-control/profile.expected.e2e.ts` 的过滤前缀、`pnpm-lock.yaml` importer、`computer-use/README{,.zh}.md` 包表。保留：`computer-use-permission-policy`、`cua-driver-*`、seam 扩展；官方 cua 族留树不挂默认 |

验证：`pnpm install --offline` 通过、lockfile 无 tool-computer-use 残留；`tsc -b` 对 computer-use seam 与 permission-policy 通过；`cinlan-computer-use.spec.ts` 1/1 通过。`verify-cordis-config` 仍报既有问题（acp profile、inspector、session-query-sqlite 测试依赖声明、security-research preset 路径），均为其他会话在途问题，与本次无关。
