# 官方、本地 main 与 Orca 差异复核

## 概述

本地 main 已同步到代码提交 `1c88551e2d0c27bbc8a208b91ee82e064c27d3ea`。385 个 dsh 发行成员均为 `0.1.6-alpha.2`；官方、本地、Orca 的能力和产品流程仍有实质差异。本地是保留 Cinlan Settings、侧栏、原生 Desktop 传输及扩展服务的选择性集成，不能作为官方标签的完整镜像，也不能视为 Orca 的完整替代品。

本次最重要的结论是：官方消息投影／图像卸载和 Office 生成技能尚未迁入；默认代码执行与 Desktop 更新策略不同；本地 Computer Use／Mobile Emulator 的现有 bundle 仍走 Orca bridge。另一方面，本地已经有原生 Browser、语音、通知、持久自动化、Git 写操作、MCP 管理和 SSH 目标管理，旧报告中相关“未接入”结论不再适用。

本文是 2026-09-20 的源码与装配快照。它补充并纠正[上轮官方清单验收](official-0.1.6-alpha.2-feature-parity.md)与[旧 Orca Settings 对账](orca-settings-audit.md)的覆盖边界；上轮实际通过的测试和安装包验收仍按当时产物有效，不扩展为本轮新增发现的兼容性证明。

## 目录

- [同步结果与版本基线](#baselines)
- [三方产品定位](#positioning)
- [官方与本地的实际差异](#official-delta)
- [本地与 Orca 的能力矩阵](#orca-delta)
- [默认启用、选装与 Orca 依赖](#activation)
- [源码规模与包清单](#inventory)
- [后续优先级与验收条件](#priorities)
- [验证证据及未覆盖项](#validation)
- [开发备注](#dev-note)

<a id="baselines"></a>
## 同步结果与版本基线

| 对象 | 本次固定基线 | 含义 |
|---|---|---|
| 官方 DeepSeek Harness | `ddefc45fbc7f8e46dd73185e68295696d1297887`，标签 `dsh-v0.1.6-alpha.2` | 本次查询 upstream 远端 HEAD 与该标签均指向此提交；参考工作树干净。结论不保证此后的远端仍未更新。 |
| 本地 main 产品源码 | `1c88551e2d0c27bbc8a208b91ee82e064c27d3ea` | 已将经过验收的集成及提交检查修正提交，再从原 main 快进；本文及附件随后以独立文档提交保存。 |
| origin/main | `763766ee8a8b076125b287464e1ef84c4a7f5222` | 本次 fetch 后确认的远端位置；仅同步本地 main，未 push。 |
| 原本地 main | `3aa151d216264e67cd2f9af35a018550b4d39ca3` | 比 origin/main 落后 10 个提交；快进保留了这些提交及本轮集成，无 rebase／强制覆盖。 |
| Orca 当前工作树 | HEAD `9c192525aaca8ab82ac751999b863ece07138676`；分支 `codex/orca-refactor-upstream-sync` | 源自本机 `D:/Company/cinlan/orca`，origin 为 Gitee 的 cinlan-ide；采样有 330 条工作区状态，package.json 声明 1.4.181。比较包含未提交改动，不能当作公开上游或已发布版本。 |

当前主目录 `D:/Company/cinlan/cinlan-harness` 已切换到 main；原有未跟踪 `apps/desktop/coverage-floating/` 保留。集成工作树 `D:/Company/cinlan/cinlan-harness-upstream-016` 保留用于核验和产物存放。29 个未跟踪编译／tsx 临时文件已移到集成树的 `.artifacts/main-three-way-audit/pre-commit-residue/`，没有混入提交，也未删除原始数据。

本次同步修正了暂存检查发现的格式与测试声明，并让 Desktop IPC 复用已校验 URL，保持来源限制。还补迁官方 LibreOfficeKit 六个精确包身份的 MPL-2.0 声明、来源及 NOTICE 义务；不将任意 MPL 依赖加入许可例外。对应来源见[第三方声明](../../THIRD_PARTY_NOTICES.md)和[独立 Kit 记录](../../.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.zh.md)。

<a id="positioning"></a>
## 三方产品定位

| 维度 | 官方 Harness | 本地 Cinlan Harness | Orca 当前源码 |
|---|---|---|---|
| 核心 | Cordis Agent runtime、Session 日志、工具／模型／子代理、Web／Desktop／SDK | 官方运行主干加独立功能设置、better-sidebar、Host 服务和业务扩展 | 多外部 CLI Agent 的项目／worktree／终端桌面工作台，并有远程及移动产品 |
| Agent 管理 | 原生 Harness Agent 和可选外部 Codex 子任务 Provider | 保留上述能力、冷子会话队列、侧栏复用；另外有尚未完全装配的 coordination/worktree-task | 当前产品 TUI Agent 策略包括 Claude／Codex／Grok；账号池、运行身份、历史和项目关联更完整 |
| 插件机制 | Cordis 配置与生命周期、MCP、Skills | 同一机制加 MCP desired state、设置 metadata、原生包管理事务 | 实验插件 manifest／进程外 worker，另外管理外部 CLI Skills／MCP 配置 |
| 主要优势 | 可组合运行时、持久记录及可回放执行 | 面向本地功能的服务与独立 UI，保留原生 transport；安全研究、Work Items 等已有真实后端 | 外部 Agent、账号、PR／CI、项目、多 Host 与手机配对的产品流程 |
| 主要边界 | 实验 Provider 仍有配置和平台条件 | 存在未迁入官方链路、未挂载扩展与仍依赖 Orca 的桥接能力 | 本次仅审当前脏树；功能有代码不证明所有平台或外部服务已经运行通过 |

Orca 的 Security Research 页面主要负责 reverse skill 安装／更新，而本地已有 assessment scope、finding、报告与工具策略服务；Orca 的 MCP 设置检查不能代替本地 MCP 连接和资源运行时。因此差异不是所有领域都单向落后，也不能用菜单数量评价谁完整。

<a id="official-delta"></a>
## 官方与本地的实际差异

| 范围 | 当前结论 | 对使用和维护的影响 |
|---|---|---|
| Session 消息投影、图像卸载 | **明确未迁入**：官方有 SessionMessageProjection、currentSessionMessageProjections 和 compaction-image-offload；本地缺这组注册与恢复装配 | 双方 Session format 都是 3，但事件语义不同，不能承诺日志互读。本地还缺官方图像预算超限时替换旧图并重试普通请求／压缩摘要的恢复链，新建多图会话也受此能力差异影响；具体失败行为未运行复现。未知必需事件不能绕过校验。 |
| Session 事件词表 | 官方有 image/offload、subagent/catalog；本地有 assessment、finding 等扩展事件，双方词表不同 | 必须用实际日志验证双向支持／拒绝范围。当前源码差异不等于已发生数据丢失。 |
| Office 预览与生成技能 | Office→PDF 和本地预览已集成、前轮有实测；官方 skill-office 的 docx／pptx／xlsx 技能、assets/checker 未迁入 | “能预览 Office”不能写成“官方 Office 创作技能齐全”。本次已补齐许可证声明，但没有补该技能。 |
| 默认 PTC／workflow | 官方 base 选 ptc-runtime-node + workflow-ptc；本地保留 code-runtime-worker-thread／workflow-worker-thread | 本地文件明确 worker containment 不是安全边界。PTC 源码存在不代表默认执行获得官方同等隔离；这是部署策略差异，须另行决策。 |
| Desktop 更新 | 本地保留 startup／seed／更新 coordinator；官方 mandatory policy、task lock、update journal 等文件没有等价迁入证据 | 已验证的启动／重启与插件保存不证明强制更新、活动任务协调和更新恢复已等同官方。 |
| MCP | 官方连接、重连、资源基础保留；本地增管理存储、凭据引用和 owner 生命周期 | 后续上游同步应合并这些行为，不直接覆盖本地 client／connection／management。 |
| Settings 与侧栏 | 本地 metadata 搜索分组、独立功能菜单和 better-sidebar 为有意保留 | 官方 ui-sidebar-browser/documentpreview/terminal 三包缺失主要是替代实现，不能按缺目录算成功能全无。 |
| Side Chat | 旧 sidechat.start/prompt/cancel/dispose/info/history 路由明确返回 501 | 这是未实现入口；与已通过的“现有子代理会话在侧栏打开、队列保存和全屏恢复”属于不同操作。 |
| Headless、feedback、deliverables | Headless 主执行与 JSON 流、message-feedback 服务逻辑实读一致或仅注释差异；present/workspace-changes src 哈希相同 | 已迁入的能力要保留。本地 runtime 装配及 UI 改造另计，不能由组件差异推出后端丢失。 |
| 模型、附件与归档 | 上轮已核验 Flash 默认目录、能力声明、自定义 Base URL、附件处理与归档 UI；本轮不将这些适配视为整个 LLM／Session 源码相同 | 具体行为与测试范围见上轮清单报告；真实模型 API、本次新发现的图像预算恢复应分别验收。 |
| AutoReview | 实验源码及独立 cordis.patch.yml 已有；base／web-app 默认未装配 | 仅当前会话 Auto 权限预设的 LLM 审查路径，需显式配置；并非已默认启用的全局审批系统，也不是 Orca 的系统权限设置。 |
| 生命周期与传输 | 本地保留 caller owner／Loop 卸载关系、冷队列投影、MCP 关闭确认、dsh-app + framed pipes | 这些是需要维护的本地修改，不能为了追求文本相同破坏现有生命周期和 transport。 |

关键源码：官方 [surface.ts](../../../deepseek-harness-reference-016/packages/core/session/src/surface.ts) 的 22／35 行、[generation.ts](../../../deepseek-harness-reference-016/packages/session/session-persistence-jsonl/src/generation.ts) 的 538 行、[base patch](../../../deepseek-harness-reference-016/packages/bundle/base/cordis.patch.yml) 的 376／379／414 行；本地 [surface.ts](../../packages/core/session/src/surface.ts) 的 13／22 行、[Side Chat 路由](../../packages/client/ui-better-sidebar/src/index.ts) 的 436 行、[worker runtime](../../packages/code-runtime/code-runtime-worker-thread/src/index.ts) 的 2–5 行。更完整的逐项文件行号与 11 个官方独有包分类见[官方／本地附件](official-local-orca-2026-09-20/official-local.md)。

<a id="orca-delta"></a>
## 本地与 Orca 的能力矩阵

“默认挂载”只表示代码中的 profile 组合；“选装”需要用户或部署配置；“未发现”限定于本轮读取的源码及入口，不排除用户自行组合。

| 能力 | Orca 当前实现 | 本地当前实现 | 实质差异 |
|---|---|---|---|
| 外部 CLI Agent | Claude／Codex／Grok 产品策略、terminal 创建与运行归属 | 原生 Harness Agent、Codex one-shot Provider、PTY | 长期外部 CLI 的账号／终端／历史／项目身份尚非同等产品链。 |
| 多账号池 | Codex／Claude／Grok 账号服务，导入、重认证、选择与 target | 模型凭据引用、provider 选择、Session usage-query | 凭据管理和 token 统计不等于外部 CLI 账号池、配额和隔离 runtime home。 |
| Worktree／项目 | checkout、base、setup、父子 lineage、Host 和 Agent 启动 | worktree-task 生命周期和 UI 有源码；非测试默认挂载未发现 | 优先接通已有 provider/controller/UI，再讨论补写；不要说完全没有 worktree。 |
| Git 操作 | Git 与托管 review 入口 | sidebar-git 默认挂载，可 stage／unstage／commit／checkout／discard／revert／cherry-pick | “本地 Git 只读”不准确；model-facing git seam 的只读约束不适用于 UI Git。 |
| PR／CI | 托管 review、checks、rerun、merge，按 repo/Host/head 关联 | 本地 diff 与 issue provider；GitHub Work Items 明确过滤 PR | 尚未查到同等 PR／CI 创建、刷新、重跑、合并流程；执行 gh 命令不等于产品实现。 |
| Work Items | GitHub issue／PR 及其他集成服务 | GitHub／GitLab REST、Linear GraphQL 的原生 provider，选装、allowWrites:false | 不依赖 Orca，但需要 token／scope；不等于全量任务与 PR 产品覆盖。 |
| AI Vault | 多 Host 的外部历史扫描、恢复、删除及活动性检查 | Harness Session 历史／检索／恢复 | 缺等价外部 Claude／Codex／Grok 日志归档与恢复产品。 |
| 全局自动化 | 持久 jobs、runNow、SSH target、precheck、每次 worktree 等 | 同一 Host profile 的持久自动化，默认 UI、revision 编辑和幂等触发 | 已不只是 Session schedule；远程路由、补跑和 run 工作树策略仍不同。 |
| 编排 | 持久 Run／Dispatch／mailbox／ack、federation；Run 本身不会自动调度 worker | 原生子代理；coordination-local 为内存 DAG；默认挂载未发现；已有并行度／覆盖率 Settings | 面板存在不等于持久运行控制台；要补任务身份、取消、重启恢复与多 Host 归属。 |
| 手机配对 | Expo／React Native 客户端、pairing、relay RPC | Web／Desktop、SDK／SSH；未找到同等手机配对产品 | 独立缺口，不能以 Mobile Emulator／ADB 代替。 |
| SSH／远程 | ssh2／系统 SSH、repo/worktree/terminal 的 Host 路由 | 官方 POSIX SSH adapter + 本地 OpenSSH execution-host-targets；目标管理默认挂载 | 已有真实连接和目录检查，但不证明 Agent／FS／Git／PTY 都绑定同一远端。 |
| Browser | Electron BrowserWindow、持久 partition、嵌入式管理 | 原生 Playwright/local 持久 Browser 选装；iframe 预览另有实现 | 原生 local 无需 Orca；也不与 Electron Browser 或实验 browser-use 完全等价。 |
| Computer Use | 自有 macOS helper、Windows／Linux script provider | 现有 cinlan bundle 仍 exec Orca；另外迁入 CUA native／MCP | 当前没有“全面脱离 Orca”；CUA 与旧 facade 的设置／工具协议还需接通。 |
| Mobile Emulator | Android adb/emulator/scrcpy；iOS simctl/serve-sim | mobile-device-cinlan bridge，SDK 路径检查和 UI | SDK 检查不是设备后端；此链仍依赖 Orca，iOS 本身限 macOS。 |
| Terminal | node-pty daemon 与公开 CLI handles | 原生 model terminal + sidebarTerminals／PtyManager，默认 UI | 并非缺终端；差异在外部 Agent／Host／项目统一管理。 |
| Voice／通知 | Sherpa STT worker、模型和系统通知设置 | 原生 Sherpa voice、dictation 与 notifications 已默认挂载 | 旧“未接入”结论过时；模型下载、麦克风、系统通知本轮未实测。 |
| Security Research | 主要为 reverse skill 发现、安装、更新和 prerequisite | 原生 scope／policy／finding／NVD／报告服务及选装 bundle | 本地已有更深的领域服务；默认授权范围为空，不是空实现。 |
| Skills／MCP | 外部 CLI Skills 发现／更新、配置检查；部分只限本机 | 原生 Skill registry + MCP 连接／资源管理和持久 desired state | 本地 MCP runtime 不弱于一个配置页；外部格式导入、freshness、跨 Host 更新仍需单列。 |
| 插件 | 实验 manifest、进程外 worker、panels/commands 等 | Cordis 生命周期、原生 Plugins 窗口、实时启停和配置持久化 | 插件格式不同；没有通用二进制／manifest 兼容承诺，市场安装和外部包更新未本轮验收。 |
| Design | 当前审查范围未找到完整 Design runtime | 无独立 Design Provider，Settings 明确不注册 Design | 不应将外部 design skill 等同于三方产品已集成的设计／导出流水线。 |

本表的源码行号、默认注册链及旧结论逐条纠偏见[Orca 产品附件](official-local-orca-2026-09-20/orca-product.md)与[原生能力附件](official-local-orca-2026-09-20/native-capabilities.md)。Orca 的 32 个固定 Settings ID 来自 [useSettingsNavigationMetadata.ts](../../../orca/src/renderer/src/hooks/useSettingsNavigationMetadata.ts)；它还按平台、开发标志和项目动态增加或隐藏入口，32 不是各平台同时显示的功能数。完整逐项结果见[32 项 Settings 对照](official-local-orca-2026-09-20/settings-matrix.md)，其中 servers 是配对远程服务而非 SSH Hosts，advanced 包含 Electron HTTP/1.1 兼容开关，developer-permissions 是 macOS 系统权限，dev 仅为开发环境演练；这些不应与本地同名或相近设置直接等同。

<a id="activation"></a>
## 默认启用、选装与 Orca 依赖

| 装配层 | 当前状态 | 需要的条件 |
|---|---|---|
| Desktop 默认 profile | base + web-app；用户插件在此之后追加 | 安装包有依赖或设置菜单可见，不代表 provider 自动启动。 |
| 持久 Browser bundle | cinlan-browser 选择 browser-playwright/local | Playwright、Chrome／Chromium 与浏览器权限；默认 channel 为 chrome，不保证 seed 自带可用浏览器。 |
| browser-use 三种 provider | Playwright MCP、Chrome DevTools MCP、Stagehand native 源码与公开 allowlist 已迁入；未在默认 bundle yml 装配 | 两种 MCP 的 npm server 子进程；Stagehand 另需模型／API key 和浏览器／CDP。无需 Orca。 |
| AutoReview | 实验包有独立 patch，默认 base／web-app 不加载 | 需显式安装／挂载及可用模型配置；本轮没有运行真实审批模型。 |
| CUA native／MCP | 源码与公开 allowlist 已迁入，默认未装配 | native 需 @trycua SDK／平台资源；MCP 需 cua-driver mcp。不是同一部署条件。 |
| Cinlan Computer Use | cinlan-computer-use 选装层指定 cinlan Provider | 默认调用 orca 或 orca-ide；与 CUA 独占注册互斥。 |
| Cinlan Mobile | cinlan-mobile-device 选装层指定 cinlan Provider | 仍执行 Orca，另需 Android／iOS 工具和设备。 |
| Work Items／安全研究 | 原生选装服务；设置页可先于服务出现 | 任务 token／scope／写策略；安全 target/action/egress/credential 授权范围。 |
| Voice | web-app 默认挂载 | Sherpa native addon、已下载模型、麦克风权限；本轮没有录音。 |
| worktree-task／coordination | 源码和部分 UI 有，非测试默认装配未发现 | 应明确 bundle、Provider、controller、UI 及持久运行 owner，不能以 Settings 名称代替。 |

CUA 是当前最容易误判的一项：[computer-use Service](../../packages/computer-use/computer-use/src/index.ts) 的独占 register 与旧 registerProvider 明确互斥；[CapabilitySection](../../packages/client/ui-settings-security/src/client/CapabilitySection.tsx) 只匹配旧包名，[device-capabilities-controller](../../packages/api/device-capabilities-controller/src/index.ts) 仍调用 facade.capabilities。由此可推导“CUA 自有工具可工作而旧页面未显示 ready”的风险，但本轮没有执行该组合，不能把推导当成已复现故障。

<a id="inventory"></a>
## 源码规模与包清单

| 指标 | 官方 | 本地 main |
|---|---:|---:|
| packages/*/*/src 与 apps/*/src 文件 | 2,204 | 2,541 |
| 同范围物理行（含注释、空行） | 385,653 | 461,778 |
| packages 与 apps 的包目录 | 295 | 396 |
| 共同包目录 | 284 | 284 |
| 各自独有包目录 | 11 | 112 |

共同路径的源文件中，1,299 个相同、636 个修改；另有官方独有 269、本地独有 606。统计排除了 node_modules、lib、构建／缓存产物和 vendor，CRLF 归一化为 LF；不包含 tests／docs／scripts／native／python 的总代码量，也不是去注释 SLOC。修改包括注释与生成源码，不能将 636 当成 636 个功能差异。

385 是实际 release family 成员数，396 是 packages/apps 目录数，两者不能相加或互换。双方此时 package.json 顶层版本已对齐，纯 version-only 差异为 0。[摘要](official-local-orca-2026-09-20/source-summary.json)、[发行成员核对](official-local-orca-2026-09-20/release-members.json)和[完整联合包目录](official-local-orca-2026-09-20/package-inventory.md)保留统计口径。

官方独有 11 包中，图像卸载、Office 技能是明确能力缺口；workflow-ptc／实验 Python 是执行装配差异；三种官方 sidebar 是本地替代实现；hmr 有其他本地实现；remote-mock、chunked-list、lazy-require 为内部或测试支撑，不能一概按产品缺失计算。

<a id="priorities"></a>
## 后续优先级与验收条件

以下是建议，不表示本次分析已实施这些新增能力。P0 表示应优先澄清或修复的发布／兼容性问题，不代表已确认安全漏洞。

| 优先级 | 工作 | 完成判据 |
|---|---|---|
| P0 | 明确 Session 双向兼容范围；评估迁入消息投影／图像卸载和 subagent/catalog | 官方含新事件及本地 assessment/finding 日志分别重开／续跑；验证普通请求和 compaction summary 的图像预算超限恢复；支持项可重放，未知必需项明确拒绝；不改写已提交日志代际。 |
| P0 | 明确 CUA／旧 facade／Browser provider 的选择和状态 | 新 profile 的依赖／provider／工具／设置一致；互斥冲突可解释；不再用旧 facade readiness 证明 CUA 全部状态。 |
| P0 | 形成按 profile 的能力装配清单，含 worktree-task、coordination | 冷安装后入口可达、后端真实可用、取消与重启行为正确；选装仍明示选装。 |
| P1 | 确定本地 worker runtime 信任约定与官方 PTC 隔离要求 | 选择的默认执行器与文件／进程权限可验证，文档准确，不以源码存在代替装配。 |
| P1 | Office 生成技能与 Desktop 更新策略专项补齐 | 技能/checker/资源来源齐全并实测生成；更新按活动任务、失败恢复、journal 逐场景验证。 |
| P1 | 打通已有 Git／worktree／Host，补 PR／CI | 项目、Host、repo、PR、head SHA 身份一致；检查、重跑、合并及冲突恢复可审查。 |
| P1 | 若以替代 Orca 为目标，补账号池、AI Vault、手机配对 | 显式授权导入、账号／Host 隔离、历史恢复、设备撤销及版本兼容；不读取或迁移未授权的 Orca 用户数据。 |
| P1 | 去除现有 Computer／Mobile 的 Orca 依赖 | Computer Use 先适配 CUA 协议；Mobile 实现原生设备 transport；在目标平台真实完成观察、操作、取消与清理。 |
| P2 | 持久编排、跨 Host federation、外部 CLI Teams、更多 provider | 先稳定本地 run/task/dispatch 身份与恢复，再扩多 Host；不要把多 Agent 命令存在当成自动调度。 |

建议顺序是先修复发布口径和兼容性，再接通本地已有但未完整装配的服务，最后补 Orca 产品层的新流程。继续保留 Cinlan 独立菜单和原生 transport，无需以更换界面来完成这些能力。

<a id="validation"></a>
## 验证证据及未覆盖项

| 本次已执行 | 结果与范围 |
|---|---|
| Git 身份、远端读取和 main 同步 | origin/main fetch 成功；官方远端 HEAD／tag 相同；集成提交成功，本地 main 快进，保留未跟踪目录，未推送。 |
| 正常 pre-commit | 配对、暂存 lint、第三方声明、空白和 vendor manifest guard 全通过；保留类型感知规则在轻量配置下的 unused-disable 警告，不声称 0 警告。 |
| Desktop IPC 来源与插件入口 | main-startup、preload-app 两文件共 32 测试通过。来源拒绝与插件窗口行为未放宽。 |
| 暂存测试修正 | sidebar-crash 与 queue-dock 两文件共 38 测试通过；仅规范修正，不当作完整侧栏产品验收。 |
| LibreOffice 声明 | 29 测试通过，generator／freshness、限定 lint、Note 配对通过；任意无关 MPL／近似包名／已知包改 GPL 或 UNKNOWN 仍拒绝。 |
| 三方源码审查 | 实读源码、默认 patch、包及资源配置、定点 diff；统计脚本成功；Orca 未启动、未修改。 |
| 既有构建／成品证据 | 上轮 official build、Windows 打包和三次隔离原生启动／设置／插件／Office 转换通过；本轮不重复构建，不把旧成品标成最终 main 的逐字节制品。 |

本轮新增了声明、格式和等价 IPC 整理，没有重新生成 EXE/MSI。既有安装包仍在集成树的 `apps/desktop/.desktop-build/targets/win-x64/artifacts/`，其哈希和验收见[上轮报告](official-0.1.6-alpha.2-feature-parity.md)。下一次对外分发应从选定的最终提交重建并复核声明、资源和签名；当前安装包未签名，安装／卸载向导未执行。

完整仓库检查未全绿：已知文档配对、Summary／换行／限制章节等仍有基线问题；本次额外类型感知定向 lint 也暴露 Desktop activationStarted 条件与终端测试断言问题，未扩改为新一轮产品重构。完整文档检查有 10 项通过、6 项失败，诊断位于本次声明修正以外；随后全仓 doc-sync／lint 已停止，不能记为通过。上轮 Browser／CUA／SDK 请求头及文件上传 Windows 路径回放差异也仍保留。

没有执行三方日志互导、真实外部模型／账号服务、实际 PR／CI 写入、Orca CLI、手机配对、设备操作或全部平台原生二进制测试。本文正向源码结论不升级为运行／发布结论；负向“未发现”也不扩大为所有自定义 profile 不可能实现。

<a id="dev-note"></a>
## 开发备注

主报告面向路线判断，附件保留精确源码路径／行号和装配判断。[官方／本地](official-local-orca-2026-09-20/official-local.md)、[Orca 产品](official-local-orca-2026-09-20/orca-product.md)、[原生能力](official-local-orca-2026-09-20/native-capabilities.md)中的目录缩写各自在附件开头定义，使用时以该附件为准。相邻官方与 Orca 路径依赖当前工作区布局；仅拉取本仓库的读者可按上面的固定 SHA 和附件路径复查。忽略目录中的过程日志不是唯一事实来源。

本次只完成 main 同步、提交检查修正与三方分析，不执行上述后续功能开发。没有重写历史、推送、创建发布或移动 Orca 私有数据。后续任一功能若进入实现，仍需单独明确默认 profile、权限、平台、持久化与运行验收范围。
