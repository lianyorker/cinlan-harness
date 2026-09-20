# 官方 Harness 主干与独立功能菜单迁移方案

## 概述

本方案按本轮用户约束收敛：[三方差异报告](official-local-orca-differences-2026-09-20.md)中的缺口用于定位，不再把“完整替代 Orca 的多 CLI 工作台”作为产品目标。产品执行统一采用官方 Harness 的 Agent、Session、Skills、工具、权限、Cordis 插件、profile 和持久化机制；Orca 只提供功能与部分可迁源码参考。每个功能有自己的设置菜单，页面复杂度取决于真实用途。

代码和交付统一进入本地 main。当前 main 为 `2604e4ab8a`，官方对照为 `dsh-v0.1.6-alpha.2`／`ddefc45fbc`；当前版本号已对齐，但官方消息投影／图像卸载、Office 技能、执行装配与更新行为仍未完整对齐。本文件是拟执行方案，不表示这些补迁、卸载 Orca 依赖或工作树清理已经完成。

## 目录

- [产品边界](#scope)
- [main 与工作树收敛](#main)
- [官方主干迁移](#upstream)
- [独立菜单与功能范围](#menus)
- [下载和功能状态](#installation)
- [手机、SSH 和设备能力](#remote)
- [实施顺序与验收](#delivery)
- [源码依据与待落实项](#evidence)

<a id="scope"></a>
## 产品边界

| 决策 | 执行含义 |
|---|---|
| 保留官方 Harness 核心与机制 | 优先迁入官方当前完整行为及其依赖，应用层差异通过 Cordis 插件、Provider、profile 和 Client contribution 实现，不再另建第二套 Agent loop／Session 日志／审批系统。 |
| 不使用多外部 CLI Agent | 产品默认、预设、UI 和发行依赖不引入 Claude／Codex／Grok CLI 安装、账号池、PTY 对话解析或外部 CLI 运行管理。官方可选 provider 源码若因上游维护保留，也不装配进本产品执行路径。 |
| 保留原生多 Agent | Harness 自身 subagent／fork／控制、官方 workflow 和 Session 继续保留。多模型 API provider 与多外部 CLI Agent 是两件事，模型 API 配置不删除。 |
| Orca 能力按 Harness 机制实现 | 可迁算法、平台 helper、界面交互和资源管理逻辑；替换 Orca 的 IPC、全局 store、Agent／账号模型及运行协议，接入 Harness service/controller/tool。 |
| 运行时独立于 Orca | 不执行 orca／orca-ide／指向 Orca 的 cinlan shim，不连接 Orca daemon、不读取其用户目录，不要求其安装、登录或在线。也不把 Orca 二进制改名后包装为新 Provider。 |
| 合理保留平台依赖 | 官方 CUA SDK、浏览器、OpenSSH、ADB、Sherpa 等可作为明确管理的组件。系统工具或上游 SDK 不等同于依赖 Orca；页面必须显示实际依赖和平台支持。 |
| 保留 Cinlan UI | 独立功能导航、Settings 样式、共享保存机制、better-sidebar API 和本地 Desktop transport 保留；官方能力接入这些视图。 |

上轮报告中的“外部 CLI 账号池、跨 CLI AI Vault、CLI Teams 管理”不再进入待补功能清单。历史检索继续服务 Harness Session；编排继续使用官方子代理／workflow，不引入 Orca 的外部 CLI 调度框架。既有本地 coordination 层先审其调用方，功能重叠的部分收敛至官方 owner，避免再维护一套调度系统。

安全研究按“技能资源管理页”交付。页面不扩展为扫描、漏洞台账或报告中心；已有安全研究后端若有消费者或持久记录，先保持数据兼容与可选加载，不因简化页面直接删除。技能安装也不自动授予网络、文件或工具执行权限。

<a id="main"></a>
## main 与工作树收敛

主工作目录固定为 `D:/Company/cinlan/cinlan-harness`，分支 main；以依赖有序的小提交推进。常规修改直接在该目录完成，通过对应检查后提交，不按每个菜单创建长期工作树。确有隔离需要时最多使用一个短期集成工作树，当批完成即快进 main 并收尾。

当前另外注册了集成工作树和官方只读参考树。实施第一批先清点集成树中被 Git 忽略的 EXE/MSI、日志、截图、临时保留文件，将需要保存的内容转存稳定交付目录并核对哈希、修正依赖原路径的交付索引；确认无独有提交和工作改动后，用正常 worktree remove 清理。官方参考树只在迁移核验期间保留，随后可用 Git 标签查询替代。不使用强制删除清理有内容的工作树，也不动原来的 coverage-floating 数据。

“减少 work-task”在工程侧按减少临时工作树和长期任务分支处理；产品中的 Git worktree 功能不因此删除。它仍可作为用户项目功能，通过 Harness workspace/session 管理，默认不为每次对话自动创建工作树。本轮方案不新增工作树、不做目录删除、不推送远端。

<a id="upstream"></a>
## 官方主干迁移

实施时先读取官方远端和发布标签，锁定一份明确基线；本方案的已核证据以 0.1.6-alpha.2 为准。若有更高官方版本，将新增差异纳入同一迁移清单后再实施，不能在开发过程中不断移动基线。

迁移单位是“行为及依赖闭包”，包括 service、事件、controller、工具、配置、资源、测试、SDK 和生成目录。只复制官方独有包或改 package.json 版本都不足以完成迁移。

| 批次 | 必须完成的工作 | 验收要求 |
|---|---|---|
| Session 与日志 | 迁入消息投影、图像卸载、subagent/catalog 及相关事件解释和持久恢复链；合并本地 assessment/finding 等扩展事件 | 官方与本地代表性日志重开／续跑；普通请求及压缩摘要图像预算恢复；未知必需事件准确拒绝；不可改写已提交历史 JSONL 代际。 |
| 执行与权限 | 以官方 PTC／workflow 装配为目标，迁全工具执行、文件策略、取消、审批、SDK 相关依赖；替换本地偏离的默认 worker-thread 执行链 | Web、Headless、SDK、Desktop 都运行相同机制；验证进程退出、取消、文件策略和模型可见日志。按官方平台实现逐项验证 Windows，不将 worker 终止当作文件隔离。 |
| Office | 迁入官方 Office Skills、资源、检查器，保留已实现预览／转换 | 技能可发现、可加载，生成样例并由检查器验证；预览独立回归；Kit 许可证和平台载荷齐全。 |
| Desktop 更新 | 合入官方任务锁、更新策略、journal／恢复语义；适配现有 startup／seed／原生传输 owner | 活动任务期间更新、失败恢复、再次启动有一致行为，不留下两套竞争的更新控制器；保留 UI 与本地无端口通信。 |
| 其他官方能力 | 按官方发行变更与完整源码差异重新核验模型／附件、终端、MCP、归档、反馈、deliverables、Headless、SDK、browser-use、CUA、AutoReview 和测试支持 | 每项记录“按官方集成／以本地视图接入／显式选装／产品范围排除”，不能留未说明差异；实验能力遵从官方装配及权限条件。 |

优先保留官方语义；本地确需维护的生命周期修复、MCP 管理、设置 metadata、冷队列和 Desktop pipes 都要逐项合并并回归。不能整目录覆盖后，仅用一次编译通过证明行为等价。已返回 501 的旧 Side Chat 路径若保留可见入口，应接官方子会话能力；无法在该批完成时取消可用操作入口，避免把现有子代理查看页当作创建 Side Chat 已实现。

<a id="menus"></a>
## 独立菜单与功能范围

采用同一 Settings 导航、搜索、语言、保存和重置机制，每个功能贡献独立 section。可以复用下载按钮／状态等基础组件，但不同功能拥有自己的内容与操作，不把所有页面套成同一张“能力配置表”。具体页面沿用 Cinlan 样式。

| 功能菜单 | 页面内容 | Harness 实现与边界 |
|---|---|---|
| Agent／预设 | 官方 Agent preset、模型和工具组合 | 原生 Agent；无外部 CLI 安装和多 CLI 切换。 |
| 模型与凭据 | 模型 API、Base URL、能力与凭据配置 | 官方 LLM／credentials；不做外部 CLI OAuth 账号池。 |
| 安全研究 | 未安装／已安装／版本；下载、重新下载、更新、移除、错误重试 | 迁入技能资源并适配官方 Skills。使用技能和执行工具在正常 Harness 会话完成；不新增扫描控制台。 |
| Browser／browser-use | 技能／组件安装、浏览器选择、依赖检测、启用和必要连接配置 | 复用官方 browser-use 或本地原生 Playwright Provider；设置页负责配置，浏览器视图／会话负责操作。删除 Orca bridge 运行路径。 |
| Computer Use | 官方 CUA 组件安装／修复、系统权限、能力状态 | 官方工具机制执行；统一 CUA readiness 与设置状态，不再调用旧 Orca facade；按实际支持平台显示。 |
| Mobile Emulator | SDK／helper 下载、路径检测、设备选择／连接和必要状态 | 与“手机配对”不同；迁入 Android／iOS 后端逻辑，直接管理 ADB／simctl 等，不执行 Orca CLI。 |
| Voice | 模型下载／重下／更新、引擎状态、麦克风、转写测试 | 复用已有 Sherpa 与 Harness voice；不再建设通用语音引擎。 |
| 手机配对 | 手机端下载／安装说明、连接组件状态、启用、二维码／配对码、设备列表、撤销和连接测试 | 新的 Harness 配对与远程访问插件；手机访问原生 Session、流、提问与审批；不是下载页完成即宣称功能完成。 |
| SSH／远程 | 匹配版本的远端组件下载／安装、Host 配置、检测、连接／断开、远端工作目录、会话和终端入口 | 官方 SSH／FS／subprocess／sandbox 为基础；复用本地目标管理 UI；统一执行目标归属。 |
| 远程服务器 | Harness Server 添加／配对、版本、连接和移除 | 直接连接 Harness 服务，与 SSH 登录分开；可共享手机设备授权服务，但不引入 Orca account／relay。 |
| 自动化 | 作业、计划、启停、立即执行、结果 | 现有持久作业触发 Harness Agent；远端作业在 SSH 主链验收后扩展。 |
| 编排 | 原生子代理／workflow 设置、状态、取消与可核验结果 | 沿用官方执行和持久化，不复制 Orca Run／Dispatch 的外部 CLI 产品模型。 |
| Git | Git 偏好、实际本地操作；PR／CI 在后续批次逐步接入 | 复用 sidebar-git。托管服务 API 适配成 Harness Provider，不能以 issue 或 diff 冒充 PR。 |
| Tasks／Work Items | 来源配置、列表、状态、项目／会话关联 | 复用已有 GitHub／GitLab／Linear，按 Provider 的真实范围交付；远端写操作保留现有确认。 |
| Terminal／快捷命令 | 终端偏好与原生 PTY；快捷命令独立菜单管理保存命令 | Terminal 不承载外部 CLI Agent 管理；命令库按 workspace／Host 区分，执行仍走现有权限与终端归属。 |
| 文件／交付物 | 文件预览、Office 设置、Harness present 与产物访问 | 复用官方 deliverables 和本地侧栏，避免再建 Orca artifact 协议。 |
| Skills／MCP／插件 | 三个独立功能页：技能管理、MCP 连接、Cordis 插件安装与配置 | 共用官方服务和现有管理层，不支持 Orca 插件 manifest 作为运行格式。 |
| 外观／输入／通知／快捷键／浮动窗口／用量 | 各自独立设置；仅迁移有实际用户价值的缺失项 | 保留已实现服务；用量统计 Harness Session；中键粘贴等平台行为单独验证。 |
| 引导／常规／集成／高级 | 模型与组件初始配置、应用设置、外部服务配置、必要诊断 | 引导检查 Harness 环境；高级设置仅有真实后端时展示，不照搬 Orca 专有字段。 |
| 系统权限 | 麦克风、屏幕、辅助功能等平台权限与设置跳转 | 与 Agent 审批分开；不支持的平台明确显示限制。 |
| 实验功能 | 官方实验 Provider 的可选安装和真实状态 | 默认不开启有外部依赖或权限前提的功能；安装、启用、可用三个状态分开。 |

Orca account、外部 CLI accounts、外部 AI Vault、CLI Teams 及其云订阅入口不迁。Orca 的 dev 演练页不进入生产菜单。Design 当前无已确认完整产品实现，本方案不顺带恢复旧 Design Studio；如采用设计技能，按技能资源机制单独接入，而不是声称已有设计引擎。完整 32 项原始导航映射见[设置对照](official-local-orca-2026-09-20/settings-matrix.md)，以上是在新产品边界内的采纳决定。

<a id="installation"></a>
## 下载和功能状态

先以安全研究技能包落实第一条完整下载链，再复用被证实相同的部分，避免预先设计大型组件商城。后端职责分开：资源下载与校验由资源 owner 负责，插件包安装继续由官方 profile／Desktop 原生事务管理，运行由对应 Provider 负责。不得让一个通用下载器直接改写 Desktop node_modules 或执行任意安装脚本。

下载的是 Harness 管理的资源，不是 Orca 安装包。第一方迁入资源进入本仓库或受控资源仓库，固定来源、版本、校验值、支持平台和许可声明；第三方运行组件来自其明确的发行源。Skill 文本也要检查 Orca 命令、协议、用户目录和外部 Agent 假设，改成实际可用的 Harness 工具说明；仅替换名称不足以完成迁移。

安全研究最小页面交互：未安装时显示“下载”；已安装时显示版本和“重新下载”，有新版本时提供“更新”；下载中显示进度和“取消”，失败显示原因和“重试”。重新下载只替换该资源版本，保留用户配置，不触碰用户自定义技能。下载、解压和校验先进入临时目录，成功后再切换可用版本；失败或取消保持旧版本可用。新资源注册到官方 Skill Provider 后才能报告安装成功，skill registry 本身不承担下载器职责。

运行型菜单另显示“已安装／待配置／运行中／不可用／不支持”，不把下载完成等同于功能就绪。可下载组件缺少发布产物时显示真实不可用原因，不用占位下载地址或安装 Orca 作为自动修复方案。卸载资源只撤销对应 provider／资源，遵守正在执行任务的生命周期，不能破坏其他插件。

<a id="remote"></a>
## 手机、SSH 和设备能力

### 手机配对

迁移 Orca 的配对交互、设备列表和可复用手机 UI；重写依赖外部 CLI chat、终端注入、Orca 账号、Orca RPC 的数据层。手机端直接消费 Harness 的 Session、消息流、工具结果、提问和审批，通过已有公开能力扩展 controller，不解析外部 CLI 输出。

当前 Desktop overlay 禁用 webserver/web-runtime，本地 renderer 使用 dsh-app + pipes。建议新增显式启用的远程访问 Cordis 插件：网络入口映射至同一 Host 的受授权服务，本地管道仍保留；不为手机另开一个同时写相同 Session 的独立 Host。配对凭据绑定设备和授权范围，具备过期、撤销、重连和版本协商；审批必须进入原会话官方审批记录，不另存一份手机审批结果。

先完成局域网／用户可达网络的直连链，实际验证桌面会话、手机收流、发送、停止、回答提问、审批和断线恢复；跨公网中继作为后续可选独立组件，协议和部署由本产品控制，不依赖 Orca 云服务。Android、iOS 手机端各有独立构建与安装渠道，iOS 不能用一个“下载 APK”按钮代替；按具备的签名／测试设备交付证据，未完成的平台明确列出。

### SSH／远程与服务器

优先贯通官方 SSH Provider 的执行模型，现有 execution-host-targets 提供目标配置和 UI。当前本地连接只证明 worker 初始化与目录检查，且代码明确不委派 Session／Agent 权限，必须扩展为完整服务装配后才能提供远程 Agent 执行。

远程组件的检测、下载／安装与升级使用匹配本地协议的 Harness runtime/helper；保留 host-key 校验，显示远端版本及安装位置。一个 workspace/Session 的 FS、命令、PTY、Git 与权限均指向同一 Host；运行中不能只切一个下拉框就把后续操作偷偷转回本机。远端断开要准确结束／保留可恢复任务，不默认在本机继续。

官方 SSH 当前有 POSIX 客户端限制，不能因本地 Windows 有 OpenSSH 就宣称整条执行链受支持。先沿用官方已支持的端点语义，再补 Windows 客户端适配并实测；远端 Linux/macOS 与 Windows 远端分别列支持矩阵。远程服务器配对则直接连接 Harness 网络服务，复用设备授权而不是复制 SSH 密钥模型。

### Computer Use 与模拟器去 Orca

Computer Use 优先使用官方 CUA Provider，先统一设置、权限和真实工具状态。若平台不被选定 CUA 版本支持，再按官方 capability 机制迁入必要的原生 helper；不长期保留 CUA 和 Orca facade 两套相互冲突的注册路径。

Mobile Emulator 可以迁移 Orca 的 adb／emulator／scrcpy 和 simctl／helper 处理，但 Host-facing 类型、取消、事件和资源所有权改为 Harness Service。开发验收不只做 SDK 探测，至少覆盖列表、启动／连接、观察、输入操作和退出清理。Android 与 iOS 分平台验收；手机配对与模拟器是两个独立菜单和后端。

<a id="delivery"></a>
## 实施顺序与验收

| 顺序 | 交付范围 | 本批完成的证据 |
|---|---|---|
| 0：主线与资源整理 | main 为唯一长期开发主线；归档已验证产物／证据，安全收尾旧集成工作树；固定官方基线和差异清单 | 无丢失未跟踪内容，交付路径有效，不新增长期 worktree。 |
| 1：完整官方行为对齐 | Session／图像恢复、PTC／workflow、Office、Desktop 更新及其余发行功能；保留 Cinlan UI 和必要适配 | 官方功能清单逐项解释、Host/Client 构建、日志恢复与取消、SDK/snapshot 相应更新；外部 CLI Agent 不进入产品装配。 |
| 2：菜单与资源管理 | 独立功能导航；先交安全研究下载／重下，再接语音／浏览器／CUA 资源配置 | 真下载、取消、失败重试、旧版本保留、技能可发现／加载；菜单状态来自真实后端，重启后持久。 |
| 3：消除现有 Orca 运行依赖 | 移除 browser-cinlan 使用路径；Computer Use 改官方 CUA；Mobile 改原生设备后端 | 在未安装 Orca、PATH 无 Orca、无其用户数据的环境完成对应功能；无 Orca 网络／进程调用。 |
| 4：SSH 与远程服务 | 组件管理、Host 配置、统一执行目标、断连与恢复、Server 配对 | 至少一套真实受支持远端执行文件／命令／终端／Git操作；失败时不落回本机；平台范围如实记录。 |
| 5：手机配对 | 自有客户端、下载入口、配对服务、设备管理、Session 交互 | 真机配对、发送／收流／取消／提问／审批、撤销和重连；与桌面观察同一持久化结果。 |
| 6：剩余功能与成品 | 补其余矩阵中采纳的菜单和真实功能，完成 Git/PR/CI、快捷命令等选定范围；重建 Windows 产物 | 最终 main 生成 EXE/MSI，冷 profile 启动／重启、资源下载、功能操作和清理通过；版本、哈希、签名状态匹配该提交。 |

各阶段在 main 上分别提交可审查的完整小批次；单项完成标准是“菜单 → 后端 → 官方机制 → 持久化／生命周期 → 真实验收”，不是只完成页面。阶段 1 完成后才以其稳定接口大规模适配 Orca 功能，防止先移植再被官方机制变更推翻。

测试分为：官方行为回归、Loader 真实 profile 组合、功能 UI、未安装 Orca 的干净环境、最终打包应用。静态依赖检查覆盖可执行命令、运行模块、资源脚本、Skills 指令和服务地址；历史报告、迁移说明和源码归属中的 Orca 字样允许保留，不用全局字符串替换冒充无依赖。真实服务／设备尚不可用的功能保留未验收状态，mock 结果不代替平台实测。

现有全仓文档与部分回放有已知失败，实施时按目标源码基线区分旧问题与引入问题，不降低检查或改写录制输入来获得全绿。新的主干变化必须完成对应构建和有效回归；旧 EXE/MSI 不作为新提交产物，发布时重新打包。

<a id="evidence"></a>
## 源码依据与待落实项

- [官方架构与 profile](../../docs/architecture.md)：Cordis 生命周期、统一 dsh 启动、Agent／Session、Desktop pipes。
- [Skill registry](../../packages/skill/skill/src/index.ts)：合并、发现和加载 Provider 内容，不是资源安装器。
- [Desktop overlay](../../apps/desktop-host/config/desktop.cordis.patch.yml)：本地默认禁用 webserver/web-runtime，因此手机网络访问要显式新增装配。
- [SSH target connection](../../packages/execution-host/execution-host-targets/src/connection.ts)：当前固定启动远端执行 profile，初始化和目录检查不等于完整 Agent 委派。
- [原生能力审查](official-local-orca-2026-09-20/native-capabilities.md)：CUA／旧 facade 互斥、Browser local、Orca bridge 和组件依赖。
- [官方／本地审查](official-local-orca-2026-09-20/official-local.md)：尚未迁入的完整行为链与需要保留的本地适配。
- Orca 当前源码中的 SecurityResearchPane、pairing RPC 和 mobile chat controller 已复读：技能页包含 Orca CLI prerequisite，手机 controller 仍有外部 CLI 输入／权限解析，均不能整页原样复制后宣称独立运行。

实施时仍需确定每个可下载资源的固定来源和构建清单、手机版本与分发渠道，以及每个平台的实测条件。这些属于实际交付条件，不改变“官方机制、main 主线、独立菜单、运行时不依赖 Orca”的决策。源码迁入保留来源与许可证；没有可迁源码或协议独立性不足的部分，按 Harness 当前接口实现。

本次只输出方案和证据核对，未修改运行代码、移除 Provider、删除工作树或启动安装。该方案取代旧报告中“把多外部 CLI Agent／账号池作为待补产品”的路线建议；旧报告的源码事实和测试记录继续保留。
