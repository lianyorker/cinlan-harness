# 官方 0.1.6-alpha.2 功能覆盖核对

> 2026-09-20 三方源码复核见[官方、本地 main 与 Orca 差异报告](official-local-orca-differences-2026-09-20.md)。本页保留原范围和验收历史；当前能力缺口、默认装配及旧结论纠偏以新报告为准，版本相同不代表官方源码或会话语义完整同步。

## 概述

本报告核对用户要求的官方 `dsh-v0.1.6-alpha.2` 长清单，合并重复条目，并区分源码实现、构建、实际界面验收与可安装成品。目标参考为 `ddefc45fbc7f8e46dd73185e68295696d1297887`，工作树为 `D:/Company/cinlan/cinlan-harness-upstream-016`。官方源码构建735、Windows完整打包755及同次产物的原生验收759均已通过。Office、独立Settings、归档、反馈、并排子会话／冷队列及交付卡已有实际GUI证据，Headless已跨进程验证。新版EXE/MSI、哈希和实际版本见Windows交付；产物未签名，安装向导与发布未执行。

[版本同步记录](../../.artifacts/official-016-audit/version-sync.json)记录最初379份manifest同步；[构建后验收账本](../../.artifacts/official-016-audit/assembled-validation.md)确认385个dsh发行族成员全部为 `0.1.6-alpha.2`，依赖顺序解析通过。这是不同阶段和集合的数量，不相加。[Desktop manifest](../../apps/desktop/package.json)、新EXE/MSI及同次win-unpacked已完成本轮构建与限定范围的原生验收；实际版本字段和哈希见[Windows交付](#windows-delivery)。既有 `0.1.5-alpha.1` 产物、[选择性集成记录](upstream-0.1.6-alpha.2.md)及[导航交付记录](cinlan-feature-navigation-windows-package.md)保留原历史范围，不用来证明本轮交付。

## 目录

- [状态与证据口径](#status)
- [模型、附件与子会话](#models)
- [设置、侧栏与文件交付](#product)
- [工具、Headless 与可选运行时](#runtime)
- [网络与基础修复](#fixes)
- [当前验证账本](#verification)
- [Windows 交付](#windows-delivery)
- [开发备注](#dev-note)

<a id="status"></a>
## 状态与证据口径

状态与验证是两个独立维度。功能有源码不等于已装入成品，mock通过不等于外部服务可用。未另标构建编号的早期built场景来自685及其后验收；独立官方构建735和打包755内完整构建均通过。冷队列控制器回归及735上的并排子会话完整GUI已通过；其他场景分别记录。“未验证”可以与“新增移植”同时出现。

| 状态 | 使用范围 |
|---|---|
| 原有能力 | 本轮补全前已存在；引用现有源码审计或历史定向验收，不冒充新测试 |
| 本地等效 | Cinlan 通过既有 Settings、better-sidebar、权限或传输实现所需行为；明确与官方不同的限制 |
| 新增移植 | 本轮已加入或适配的源码；是否已验证由证据列单独说明 |
| 未验证／未完成 | 尚缺特定场景、真实外部环境或未执行的安装／发布流程；记录确切缺口，保留已通过构建与实际验收的范围 |
| 按需启用 | 必须显式安装、挂载、配置或选择；不代表默认 Desktop 已启用 |

基线来源是[模型与文件审计](../../.artifacts/official-016-audit/model-files.md)、[界面审计](../../.artifacts/official-016-audit/ui-features.md)、[核心工具审计](../../.artifacts/official-016-audit/core-tools.md)、[反馈与细节修复审计](../../.artifacts/official-016-audit/feedback-fixes.md)。这些是实施前源码审计，所列测试文件不是通过记录；后续实现报告及下文明确检查覆盖其对应旧结论。保留 Cinlan 属主的依据见[双语架构记录](../../.agents/notes/implemented/architecture/2026-09-20-official-capabilities-preserve-cinlan-architecture.zh.md)。

<a id="models"></a>
## 模型、附件与子会话

本节区分模型声明、真实路由与界面行为；不会用模型名称猜测图像或系统提示词更新能力。

| 功能条目 | 当前状态与入口 | 证据 | 平台／验证限制 |
|---|---|---|---|
| DeepSeek-V41-Flash／deepseek-flash，文本与图像输入 | 新增移植；原生默认模型目录声明 text + image | [模型实施报告](../../.artifacts/official-016-audit/models-url-implementation.md)，默认目录及两种协议用例 | 未运行真实模型 API；显式自定义目录仍可覆盖同名模型能力 |
| 新会话默认 Flash，显式设置优先 | 新增移植；共享 base 默认使用 deepseek-flash | 同上，真实 patch 合成与 agent-default-model 测试 | 已保存选择及显式 profile 默认不被批量替换；ACP 的显式选择保留 |
| 动态系统提示词保留 KV Cache 前缀 | 原有等效机制；新增 Flash 能力声明使其适用 | [模型审计](../../.artifacts/official-016-audit/model-files.md)，[模型实施报告](../../.artifacts/official-016-audit/models-url-implementation.md) | 仅确切路由声明 in-history 时追加；路由切换、工具变化等会重新建立序列，不保证供应商实际缓存命中率 |
| 可选 Messages 与图像请求 | 原有已集成能力；Chat Completions 仍为默认 | [选择性集成记录](upstream-0.1.6-alpha.2.md)，本轮模型回归 | Messages 必须显式选择；本轮无真实 API 验收 |
| 模型发现：provider.models 对象、Anthropic 原生列表、名称及容量回退 | 原有能力 | [模型审计](../../.artifacts/official-016-audit/model-files.md)直接比较 source 与实际消费方 | Anthropic 只读一页，与官方一致；安装目录或远端响应决定可发现项 |
| pi-ai 无效配置保留并显示诊断 | 原有能力 | 同上，配置解析、持久化与修复 UI 调用链 | 拒绝无效新写入；配置保存与模型可调用状态分开；非所有错误都代表凭据问题 |
| 自定义模型 Base URL 校验及去空白 | 新增移植；创建与发现前统一校验 HTTP(S) | [模型实施报告](../../.artifacts/official-016-audit/models-url-implementation.md)，合计 380 个选定用例 | 语法正确不等于端点可访问；网络失败与字段错误分开 |
| 通用文件上传与图像／文件混排 | 原有等效能力；输入区、Chat 和模型保存路径链路存在 | [模型审计](../../.artifacts/official-016-audit/model-files.md)，file-upload 与 Session 提交调用链 | 非图像文件向模型提供保存路径等文本；仍遵循授权、附件存储与路由能力 |
| 上传进度、取消、重试与切换会话继续 | 原有等效能力 | 同上，根级上传操作身份与草稿服务 | 仅活动客户端内切换；不承诺浏览器或进程丢失后的 HTTP 断点续传 |
| Trajectory 的混合附件摘要／预览／Raw | 新增移植；735上文件上传8/8行为通过，含有序混合附件、完整缩略图、键盘原图、Raw元数据及重载一致 | [文件与队列报告](../../.artifacts/official-016-audit/files-queue.md)；[最终745日志](../../.artifacts/official-016-audit/file-upload-final-replay.log) | 整套回放未通过（退出1）：仅afterAll持久Session的Windows附件路径与POSIX golden比较失败；未重写JSONL或归一化器 |
| Continuable subagent 队列编辑、删除、单条／全部 Steer、Stop、Sending 禁用 | 原有等效能力，活动子会话链路完整 | [模型审计](../../.artifacts/official-016-audit/model-files.md)中的 UI、Remote、Host 与 inbox 路由 | 一次性子会话只读；离线父会话限制发送；Stop 保留待处理队列 |
| 冷打开时显示持久队列 | 新增移植并验证；零Agent下读取、冷Edit／Remove、持久重开及更新投影均有Host回归，完整GUI保存与重开通过且未激活子Agent | [新8项、相邻30项及投影51项](../../.artifacts/official-016-audit/assembled-validation.md)；[735上GUI743结果](../../.artifacts/official-016-audit/subagent-sidebar-gui-mKwSSF/result.json) | 仅当前自身身份为continuable的冷子会话；一次性、seed-only及冷普通Session不走此修改路径；运行时Steer权限保持原规则 |
| 子代理数量与深度设置 | 原有已集成能力；并发默认 8，保留本地深度 3 | [选择性集成记录](upstream-0.1.6-alpha.2.md)，[所有权决策](../../.agents/notes/implemented/architecture/2026-09-19-selective-upstream-integration-preserves-product-ownership.zh.md) | 显式部署配置优先；不采用官方深度默认 1 |

<a id="product"></a>
## 设置、侧栏与文件交付

功能入口继续使用 Cinlan 独立设置页、原生保存行为和 better-sidebar API。局部源码适配不能替代 Web 与 Desktop 的完整界面检查。

| 功能条目 | 当前状态与入口 | 证据 | 平台／验证限制 |
|---|---|---|---|
| 插件安装、配置、实时启停 | Web原有等效；新版Desktop原生Add窗口打开／复用／关闭、配置行off/on/off与renderer刷新、禁用状态和配置跨完整重启均通过 | [定向回归](../../.artifacts/official-016-audit/desktop-features.md)；[原生759](../../.artifacts/desktop-settings-B2UqF6/report.json)：真实fixture生命周期、刷新时Host PID／URL／历史不变 | 验证使用预置无依赖fixture；Add仅打开原生包管理窗口，未实际新增外部包；包安装／卸载及组合变更仍归shell事务 |
| 独立Settings功能导航与保存 | 保留Cinlan独立菜单和原生保存／重置；新版Desktop中英切换、搜索焦点、Git／终端字体／Tasks保存及完整重启持久化均通过 | [Web699／702](../../.artifacts/official-016-audit/assembled-validation.md)；[packaged原生759](../../.artifacts/desktop-settings-B2UqF6/report.json) | 不显示Design入口；未来Linear.app仅为设计背景，本轮不替换视觉方案 |
| 回合结束改动卡与逐文件 Diff | 原有本地等效；turnCards 与 better-sidebar review | [界面审计](../../.artifacts/official-016-audit/ui-features.md)，[历史验证](upstream-0.1.6-alpha.2.md) | 摘要随活动 Session 生命周期；非 Git 只归纳成功文件工具改动，二进制／过大文件不给文本 Diff |
| Word／Excel／PowerPoint 预览 | 新增移植；Web三格式完整PDF预览、下载、中英工具栏通过；新版Desktop离线安装的Office及Windows引擎验证，并实际转换DOCX成功 | [90 Host／44 Client及Web验收](../../.artifacts/official-016-audit/office-preview.md)；[原生759](../../.artifacts/desktop-settings-B2UqF6/report.json)：1781字节DOCX→22877字节完整PDF，Host PID不变 | 安装后实际转换覆盖固定DOCX；XLSX/PPTX另有Web与Windows转换证据，旧格式及任意缺失字体保真度不由此推断 |
| 侧栏网页 URL 浏览 | 原有本地等效，iframe、后退／前进／刷新 | [界面审计](../../.artifacts/official-016-audit/ui-features.md) | 受站点 CSP／X-Frame-Options 限制；跨域页内导航无法完整回传历史；本地 URL 策略与官方不同 |
| 并排查看 subagent 对话 | 新增移植且735上完整GUI通过；父选择／正文不变，普通子工具卡、独立草稿、冷队列保存、标签去重与关闭重开均验证 | [425个不同定向用例](../../.artifacts/official-016-audit/subagent-sidebar.md)；[GUI743完整结果](../../.artifacts/official-016-audit/subagent-sidebar-gui-mKwSSF/result.json)及同目录截图 | 无子Agent激活，无page errors；新版Windows安装包验收另列 |
| 已提交计划预览与审阅 | 原有本地等效；按 Session/callId 打开 better-sidebar 正文 | [界面审计](../../.artifacts/official-016-audit/ui-features.md)，[历史验证](upstream-0.1.6-alpha.2.md) | 无 callId 的临时审阅只在内存中，刷新后可过期 |
| 终端多标签、逐标签 Shell 选择、刷新恢复 | 新增选择器，扩展已有多标签与恢复机制 | [终端报告](../../.artifacts/official-016-audit/terminal.md)：152 通过／1 Windows 跳过、6 Chromium、3 真实 Windows PTY | 保留本地 3 标签限制；只复用存活进程，Host 重启不能恢复运行中的命令；不可用显式 Shell 不自动回退 |
| 归档会话设置列表、筛选与恢复 | 新增移植；Personal独立菜单及完整unarchive链路，生成Remote和完整Web场景已验证 | [归档报告](../../.artifacts/official-016-audit/archived-sessions.md)：136个不同unit；[构建后验收](../../.artifacts/official-016-audit/assembled-validation.md)：浏览器1项通过含重载持久化 | 官方范围为列表、筛选、恢复，不提供单独正文查看动作；新版安装包验收另列 |
| 点赞／点踩确认、分类、失败草稿与错误保留 | 新增移植并完成built浏览器检查；初次／更换评分确认、撤回、失败及冲突草稿保持 | [反馈报告](../../.artifacts/official-016-audit/feedback-implementation.md)：95个不同UI用例；2个message-feedback浏览器用例及最终16项反馈回放通过 | 真实反馈模型API未调用；12项release再次通过是重复验证，不计额外唯一用例 |
| 独立反馈与裸 /feedback、详情及上下文披露 | 新增移植；裸命令／菜单打开对话框，带文本命令保留Host记录与确认行；built最终16项通过 | [反馈报告](../../.artifacts/official-016-audit/feedback-implementation.md)：command123、domain54、遥测／log45及最终release12／layout3／protocol1 | 提交才追加现有v3可选元数据；三份已提交JSONL哈希不变；SDK对照仍有独立平台请求头差异 |
| 显式文件交付卡、预览、默认应用打开、定位 | 新增移植；735上的GUI748验证两张交付卡、工具成功状态及Preview实际fs.read，源Session／cwd／路径与当前文件内容一致 | [350个不同定向用例](../../.artifacts/official-016-audit/deliverables.md)；[真实GUI结果](../../.artifacts/official-016-audit/present-deliverables-0xG1l6/result.json)及同目录截图 | 预览打开当前源文件，不保存不可变副本；未启动外部编辑器／文件管理器；安装包验收另列 |
| 交付布局与 Chat 间距 | 原有改动卡与新交付卡共用turnCards／turnTail；本地token保留，真实GUI748呈现两张交付卡和侧栏预览 | [交付GUI748](../../.artifacts/official-016-audit/present-deliverables-0xG1l6/result.json)；[反馈layout六种视口](../../.artifacts/official-016-audit/feedback-implementation.md) | 已验具体卡片及反馈布局，不推断所有交付物／视口组合；不因官方4px差异替换本地样式 |
| 代码文件、文件名与项目类型图标 | 新增移植；48类artwork接入ProducedFiles、PresentedFileCard及ChangedFiles；GUI748验证代码和Markdown图标实际呈现 | [350唯一用例含169图标测试及consumer markup](../../.artifacts/official-016-audit/deliverables.md)；[GUI图标尺寸结果](../../.artifacts/official-016-audit/present-deliverables-0xG1l6/result.json) | Flutter等项目识别依赖可选项目上下文；两种图标实机显示不代表48类均逐图验收 |
| 右侧栏标签、拖动分栏与常见格式 | 原有本地等效 | 同上，better-sidebar 注册、布局与文件预览链路 | 图片、Markdown、HTML、代码和浏览器原生 PDF 各受自身格式及浏览器限制 |
| 相对文件路径、全屏／恢复 | 新增移植；源Session cwd解析及持久几何保留；735上全屏、Restore按钮与Escape真实GUI全部通过 | [文件队列20项后续回归](../../.artifacts/official-016-audit/files-queue.md)；[GUI743](../../.artifacts/official-016-audit/subagent-sidebar-gui-mKwSSF/result.json)验证全屏边界、同一DOM挂载及双草稿不变 | 全屏仅临时改变展示，不改写保存尺寸；本行行为证据来自实际Web GUI，成品原生验收范围另见Windows交付 |
| 非活动会话文件的即时预览 | 新增移植；立即在可见侧栏打开，源Session身份、cwd、媒体读取授权分别保留；官方构建通过 | [文件队列报告](../../.artifacts/official-016-audit/files-queue.md)：20个后续用例，含挂载可见输出、child reader和布局重载 | 自定义预览器接收源读取器；跨源同路径不合并；专门的完整跨会话浏览器场景尚无通过记录 |
| oldDetail 移除对应布局 | 原有本地等效 | [反馈审计](../../.artifacts/official-016-audit/feedback-fixes.md) | 当前 AppFrame 与 better-sidebar 已拥有布局；不需要恢复同名官方组件 |
| 顶栏 Open in App | Web原有能力；Desktop新增Connection Fetch适配，已纳入通过原生验收的新应用 | [Desktop报告](../../.artifacts/official-016-audit/desktop-features.md)：104项通过、3项承载方式不适用跳过 | 本机应用发现决定选项，SSH隐藏入口；保持无监听Web服务的管道架构；未真实启动外部编辑器或文件管理器 |
| Windows 文件夹选择器前置显示 | 新增移植；Show 前执行官方 Alt 按下／释放协助 | [反馈实施报告](../../.artifacts/official-016-audit/feedback-implementation.md)：26个 Win32 mock 用例，5个新断言在修改前失败 | best effort，可能短暂高亮菜单；未验证真实桌面窗口激活 |
| 空白字符不误显示输入占位符 | 新增修复；原始文本为空且无附件／claim时才显示提示 | [反馈报告](../../.artifacts/official-016-audit/feedback-implementation.md)：86个InputBar用例、整体Client构建与最终反馈回放通过 | 发送仍判断去空白后的语义，纯空白不启用发送；输入法专项无单独验收记录 |

<a id="runtime"></a>
## 工具、Headless 与可选运行时

本节的外部提供方均不因移入仓库而默认激活。每个提供方的 README 拥有完整部署条件。

| 功能条目 | 当前状态与入口 | 证据 | 平台／验证限制 |
|---|---|---|---|
| MCP 资源发现、URI 模板、读取 | 新增移植；共享三个工具，配置服务器后按作用域出现 | [MCP 实施报告](../../.artifacts/official-016-audit/mcp-resources-implementation.md)：161个不同 mock／Loader 用例跨定向运行通过 | 保留 SDK v1 监督器；每次列表一页并保留 opaque cursor；无服务器无工具；无资源能力时列表为空、读取失败；无真实外部 MCP 验收 |
| MCP 外部指令与字面花括号 | 新增移植；初始化与发现成功后发布作用域内指令，断开／卸载撤销；system-prompt 使用 interpolate:false | [MCP 实施报告](../../.artifacts/official-016-audit/mcp-resources-implementation.md)：新增9例覆盖字面文本、脱敏、字节上限及未完成启动时卸载 | maxInstructionBytes 默认32768，包含服务器标题的完整UTF-8文本；已知凭据在发布前脱敏；其余提示词仍严格解析变量 |
| Headless 位置参数与文本输出 | 原有能力，本轮保持默认行为 | [Headless 报告](../../.artifacts/official-016-audit/headless.md) | CLI 模式，与 Desktop 会话 API 分开 |
| Headless stdin／单独 - 任务 | 新增移植；735上两次真实built CLI进程分别验证省略位置参数和单独-从stdin取任务 | [最终744证据](../../.artifacts/official-016-audit/headless.md)：Unicode及尾部换行逐字保留，均退出0、stderr为空 | 显式任务优先；smoke使用确定性模型适配器并阻止外网，无真实API调用 |
| Headless --session-id 续跑 | 新增移植；735上独立第二进程读取同一持久Session，轮次从1推进到2，输出保留两轮原文 | [最终744证据](../../.artifacts/official-016-audit/headless.md)：压缩日志从13133增至23323字节，原前缀逐字节不变 | 需persistence/query，拒绝未知／活动冲突／子会话及cwd不符；无真实模型或工具调用 |
| Headless --json JSONL 事件 | 新增移植；735上两进程各8个完整JSON对象精确比较通过，覆盖session／状态／思考／文本／final | [最终744证据](../../.artifacts/official-016-audit/headless.md)，另105项源码回归覆盖更广错误／工具事件 | smoke未调用工具或真实模型；非final字段8KiB、行32KiB，final保持完整 |
| SSH 远端文件、命令与 PTC | 新增移植，按需启用的自定义 POSIX 组合 | [SSH 报告](../../.artifacts/official-016-audit/ssh.md)：正常工作区 103 协议／提供方 mock；Node PTC 181 mock | 官方客户端与 helper 仅 Linux/macOS；Windows 端点不支持；需 OpenSSH、匹配 Node/helper/bootstrap 与摘要；没有真实 POSIX SSH 验收 |
| browserUse + Playwright MCP | 新增移植、按需启用；115个不同keyless用例及完整build，合成场景已执行截图并核对日志 | [Browser报告](../../.artifacts/official-016-audit/browser-use.md)，含17个MCP Loader通过记录 | 真实Chromium／CDP外部条件未验；完整回放仍因官方与Windows／本地工具请求头差异失败 |
| Chrome DevTools MCP | 新增移植、按需启用；adapter4项通过，构建后合成截图执行与Session行核对通过 | [Browser报告](../../.artifacts/official-016-audit/browser-use.md) | 真实Chrome／CDP未连接；同一回放后续请求头比较失败，不能写为完整场景通过 |
| Stagehand | 新增移植、按需启用；72个provider／Worker／Loader用例通过，built合成提取与截图执行成功 | [Browser报告](../../.artifacts/official-016-audit/browser-use.md) | 需独立模型凭据与兼容扩展；真实API／浏览器未验，完整header golden仍失败 |
| Computer Use + Cua Driver MCP | 新增移植、按需启用；保留Cinlan facade，112本地+25适配器通过，built合成场景执行／日志一致 | [Computer Use报告](../../.artifacts/official-016-audit/computer-use.md) | 外部cua-driver、图形会话及OS权限未实测；与Cinlan provider互斥；完整回放header比较失败 |
| Cua Driver native 与截图 | 新增移植、按需启用；持久图像准入，built合成截图及完整Session行比较通过 | [Computer Use报告](../../.artifacts/official-016-audit/computer-use.md) | 真OS截图／输入／native激活未验；Linux musl无所列平台包；完整header golden不是通过状态 |
| 截图持久化与模型能力检查 | 原有等效基础设施，供新增适配器复用 | [核心审计](../../.artifacts/official-016-audit/core-tools.md)，[Computer Use 报告](../../.artifacts/official-016-audit/computer-use.md) | 图片必须通过存储、格式与确切模型能力检查；基础设施不证明驱动已就绪 |
| experimentalAutoReview | 新增移植与定向检查完成，按需启用；包含当前格式冷恢复、权限确认和内部PTC拒绝传播 | [AutoReview 报告](../../.artifacts/official-016-audit/auto-review.md)：124 reviewer／Loader／PTC、34权限及其余分项通过 | 停止profile后安装／移除并重启显示选择器；明确选择Auto与模型；外层run_code及直接JS副作用不审查；卸载时活动Auto选择迁为Full access；无真实API证明 |
| 过滤后的 subagent FS／Web 工具指导 | 新增移植；七个指导贡献按当前作用域工具可见性处理 | [工具指导结果](../../.artifacts/official-016-audit/tool-guidance-results.md)：20 新回归，所属文件 278 通过／1 跳过 | read/write/edit/glob/grep/search/fetch 分别检查相关工具；PTC 的内部可见工具也适用；该数字不包含完整模型 API |

<a id="fixes"></a>
## 网络与基础修复

通用代理策略与特定网络库的行为分开核对，已修复的基础行为也不自动证明新安装包可用。

| 功能条目 | 当前状态与入口 | 证据 | 平台／验证限制 |
|---|---|---|---|
| HTTP_PROXY／HTTPS_PROXY／ALL_PROXY／NO_PROXY | 共有策略为原有等效；Desktop Host在插件前安装并于失败／退出后释放，新成品Host启动和清理已通过 | [核心审计](../../.artifacts/official-016-audit/core-tools.md)、[真实Loader生命周期](../../.artifacts/official-016-audit/desktop-features.md)、[原生759](../../.artifacts/desktop-settings-B2UqF6/report.json) | 小写优先、loopback绕过；仅HTTP(S)，无SOCKS/PAC/CIDR；未实测成品经外部代理联网，OTLP／模型worker／updater例外仍见下文 |
| “所有网络请求”代理覆盖 | **未达到字面全覆盖，官方也有例外** | [核心审计的代理范围](../../.artifacts/official-016-audit/core-tools.md) | OTLP 直连；模型工作线程不继承代理环境；Electron updater／构建下载和第三方内部传输未证实遵循共同策略；不能写成全网络已代理 |
| MCP 重复分页游标保留已有工具 | 原有本地等效，保留检测及上一代工具 | [MCP 实施报告](../../.artifacts/official-016-audit/mcp-resources-implementation.md)含既有客户端回归 | 拒绝失败更新；不代表不支持资源分页；资源列表使用显式逐页请求 |
| fs-ext 安装原生编译问题 | 原有等效依赖替换；JSONL 使用 node-addon-system flock | [核心审计](../../.artifacts/official-016-audit/core-tools.md) | 各平台仍需匹配预编译 payload；本轮源码依赖结论不是当前安装包离线验收 |
| 子代理完成通知仅最终文本 | 原有已集成修复 | [选择性集成记录](upstream-0.1.6-alpha.2.md) | 完整输出保留在子会话与前台结果；非空文本才转发 |
| 已生效沙箱模式不重复批准 | 原有已集成修复 | 同上 | 真正扩大权限仍需对应授权；不提供绕过审批 |
| Fork 在所选轮次结束处截断 | 原有已集成修复 | 同上 | 保留本地 worktree/task 与日志语义 |
| Windows 子进程隐窗、Session 写入占用提示 | 原有能力；本轮native/control编译已通过 | [历史Windows复核](upstream-0.1.6-alpha.2-windows-package.md)、[整体构建](../../.artifacts/official-016-audit/assembled-validation.md) | Windows安装包及真实原生窗口验收另列 |
| ContextMeter 视口、长标题 hover、Thinking Markdown | 未验证／仍为独立 UI 细节项 | 同上列明的审计差异 | 本轮没有这些条目的最终完成证据，不据其他界面通过代填 |
| logger exporter 清理 ID | 未验证；历史报告列为独立 vendor 补丁 | 同上 | 当前 Desktop 触发未被证明；本次文档工作不修改 vendor |

<a id="verification"></a>
## 当前验证账本

下表转录实际执行并留下的证据。文档检查由本次整理执行，行为测试和构建来自实现负责人及集成账本；重叠重跑不累加。官方源码构建735、workspace约束739、目录生成730／741、Windows完整打包755及原生验收759通过；外部提供方、完整回放和未执行场景仍单列限制。

| 范围 | 已记录结果 | 未覆盖 |
|---|---|---|
| 官方源码构建 | [最终735构建日志](../../.artifacts/official-016-audit/build-official-final-queue-2.log)：冷队列类型及根服务生命周期修复后，Host编译／bundle、生成Remote、Client编译／bundle和Web资源全部通过 | 源码构建不替代完整GUI、外部提供方或Windows安装包验收 |
| 发行成员、目录与既有不变量 | [385个同版成员、依赖顺序及最终约束739通过](../../.artifacts/official-016-audit/assembled-validation.md)；[Cordis730](../../.artifacts/official-016-audit/gen-cordis-cold-queue.log)、[Cordis API741](../../.artifacts/official-016-audit/gen-cordis-api-final.log)完成当前源码生成 | 包清单使用规范lib/types/**/*.js；/types仍导出rpc.js；built不变量692为此前检查记录，不冒充735后重跑 |
| 模型目录与 URL | [380个不同选定用例通过](../../.artifacts/official-016-audit/models-url-implementation.md)，其后官方Host/Client构建通过 | 真实模型API未执行；自定义目录覆盖仍归用户 |
| Headless | [105项源码回归＋最终744稳定735产物证明](../../.artifacts/official-016-audit/headless.md)：2个独立built CLI进程、各8个精确JSON事件、同Session续跑、Unicode／换行及原日志前缀保留，网络尝试0 | 确定性模型适配器，无真实API或工具调用；早期与构建重叠的运行不作为最终证据 |
| MCP | [161个不同用例通过](../../.artifacts/official-016-audit/mcp-resources-implementation.md)，源码构建和目录接线已完成 | 多次定向运行，非单次161全绿；外部真实MCP server未验 |
| Office | [90 Host／44 Client／1真实Windows转换／1完整Web验收](../../.artifacts/official-016-audit/office-preview.md)；[原生759](../../.artifacts/desktop-settings-B2UqF6/report.json)确认安装后Windows引擎及真实DOCX→PDF | 不扩大固定DOCX成品验证至所有格式／字体；旧DOC/XLS/PPT无同等实机证据 |
| 归档会话 | [136个不同用例](../../.artifacts/official-016-audit/archived-sessions.md)，[built Web恢复与重载1项](../../.artifacts/official-016-audit/assembled-validation.md)通过 | 无单独正文查看动作；新版Windows成品验收另列 |
| 终端 | [152通过／1Windows跳过、6Chromium回放、3真实Windows PTY](../../.artifacts/official-016-audit/terminal.md)；[原生759](../../.artifacts/desktop-settings-B2UqF6/report.json)确认终端配置保存 | packaged场景未创建Workspace／Session，终端命令执行明确not-run；POSIX权限分支未验 |
| Browser | [115个不同keyless用例；三个built场景执行、stdout/stderr及Session行比较通过](../../.artifacts/official-016-audit/browser-use.md) | 三个完整回放全部在header比较失败：bash/pwsh、保留ralph及MCP分页描述差异；之后断言未到达；非真实外部浏览器 |
| Computer Use | [112本地+25适配器通过；两个built场景执行与Session行核对通过](../../.artifacts/official-016-audit/computer-use.md) | 两个完整回放均在官方／Windows本地工具header比较失败；真实GUI、OS权限与native激活未验 |
| SSH 与 PTC | [103 SSH mock、181 Node PTC mock及88 FS工具用例](../../.artifacts/official-016-audit/ssh.md)；相关包已纳入整体源码构建 | 无真实POSIX SSH／远端认证／约束验收；Windows symlink EPERM未放宽；SSH Windows端点不支持 |
| 文件、队列与侧栏 | [基础200个不同用例及后续20项](../../.artifacts/official-016-audit/files-queue.md)；[最终745](../../.artifacts/official-016-audit/file-upload-final-replay.log)文件上传8/8行为通过；冷队列Host及GUI另行通过 | 整套上传回放未通过：仅afterAll的Windows附件路径比较失败；定向集合重叠不累加，JSONL及归一化器未重写 |
| Desktop | [54 Host/manager、59 shell、67 inventory/UI/preload、104 Open in App](../../.artifacts/official-016-audit/desktop-features.md)；[新版原生759](../../.artifacts/desktop-settings-B2UqF6/report.json)整体passed:true，隔离离线首启、Settings、插件窗口／启停／重启、Office转换及清理均通过 | 无实际外部编辑器／文件管理器启动或新增外部插件包；安装向导与发布未运行；分项重跑不重复求和 |
| 共享 Agent 生命周期消费方 | [105核心及34 SDK协议用例](../../.artifacts/official-016-audit/agent-created.md)、[728消费方通过／2跳过](../../.artifacts/official-016-audit/agent-created-consumers.md)，整体官方构建通过 | SDK控制回放在重建后已执行，仍因POSIX bash与Windows pwsh工具header不同而失败；不标记SDK快照全绿 |
| 反馈、输入与原生选择器 | [429个不同定向用例；built最终16项反馈回放通过](../../.artifacts/official-016-audit/feedback-implementation.md)，另2项message-feedback浏览器通过 | 12项release重复验收不重复计数；原生目录前置仍只有Win32 mock证明，真实API未调用 |
| 显式交付与文件图标 | [350个不同定向用例](../../.artifacts/official-016-audit/deliverables.md)；[735上GUI748](../../.artifacts/official-016-audit/present-deliverables-0xG1l6/result.json)1项通过，卡片、代码／Markdown图标及当前源文件预览真实接线，console／page／transport errors为空 | 外部编辑器／文件管理器未启动；无真实模型调用，安装包验收另列 |
| AutoReview | [124、34、25、5、71等分项通过](../../.artifacts/official-016-audit/auto-review.md)，其后整体源码构建及built不变量通过 | 分项有重复不求和；真实审查模型与外部profile安装未验；仍需显式选择Auto |
| 并排子会话 | [425个不同用例／26文件](../../.artifacts/official-016-audit/subagent-sidebar.md)；[735上完整GUI743](../../.artifacts/official-016-audit/subagent-sidebar-gui-mKwSSF/result.json)1项通过（14.28秒），冷Save返回accepted并持久重开，全屏恢复保持挂载 | 无子Agent激活；不以这个场景替代真实模型调用或Windows安装包验收 |
| 文档 | [新增缺陷修复与基线分类](../../.artifacts/official-016-audit/docs-final-triage.md)：全图链接1947文件通过、模型体验392 README通过、14修正配对通过；类型等价415+415通过 | 整体test:docs原9个失败叶中，剩余旧voice/dev配对／换行／摘要、voice笔记、Automation格式和11限制章节均有HEAD证据；不宣称全部文档门禁通过 |

<a id="windows-delivery"></a>
## Windows 交付

**新版Windows产物已构建，同次原生应用验收通过。** [官方打包755](../../.artifacts/official-016-audit/package-win-x64-016-2.log)退出0，[实际元数据](../../.artifacts/official-016-audit/windows-016-artifacts.json)记录新EXE/MSI的大小、SHA256及版本；[最终原生验收759](../../.artifacts/desktop-settings-B2UqF6/report.json)在同次win-unpacked上通过，[运行日志](../../.artifacts/official-016-audit/packaged-settings-016-3.log)确认passed:true。隔离离线首启、独立Settings、原生插件窗口／配置启停／完整重启及安装后Office转换已验证；进程退出0、调试端口关闭、临时profile清理完成。两安装包及应用均未签名，安装／卸载向导和发布未执行。

| 验收项 | 当前记录 |
|---|---|
| 目标应用及包版本 | 目标及EXE安装器FileVersion／ProductVersion均为0.1.6-alpha.2；MSI数据库ProductName为DeepSeek Harness、ProductVersion为0.1.6.0；[实际记录](../../.artifacts/official-016-audit/windows-016-artifacts.json)区分完整预发布标识与Windows数字版本 |
| Windows x64 打包命令与退出结果 | pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64完整流水线755退出0；[完成日志](../../.artifacts/official-016-audit/package-win-x64-016-2.log)含MSI、NSIS EXE及blockmap生成 |
| EXE 路径、字节数、SHA256 | [deepseek-harness-0.1.6-alpha.2-win-x64.exe](../../apps/desktop/.desktop-build/targets/win-x64/artifacts/deepseek-harness-0.1.6-alpha.2-win-x64.exe)；355656818字节；SHA256 `e1e653067c4590fee45d4a6543afedb789713c43fb80bf53ac47cdff5eecce7f` |
| MSI 路径、字节数、SHA256 | [deepseek-harness-0.1.6-alpha.2-win-x64.msi](../../apps/desktop/.desktop-build/targets/win-x64/artifacts/deepseek-harness-0.1.6-alpha.2-win-x64.msi)；385723217字节；SHA256 `d41a30b55f83f28659d549788210f50af0253dbd37c5e1d5f5c565310c8a43f1` |
| 同次构建 win-unpacked 应用 | [DeepSeek Harness.exe](<../../apps/desktop/.desktop-build/targets/win-x64/artifacts/win-unpacked/DeepSeek Harness.exe>)；244674048字节；FileVersion为0.1.6-alpha.2、ProductVersion为0.1.6.0；SHA256 `b549910505d3dd2e65df39a0594202ea3b01bb4dd676698504301d894b684ab1`；原生759通过 |
| 隔离 DSH_HOME、离线 seed、首次启动与完整重启 | [最终759报告](../../.artifacts/desktop-settings-B2UqF6/report.json)通过：使用bundled Node、离线安装同版本dsh／Host、隔离home和Electron数据，完整重启保持配置；最终退出0、debugPortsClosed及developmentRootRemoved均为true |
| 独立 Settings 与新增功能入口 | 新成品中英导航、搜索与焦点、Git／终端字体／Tasks保存通过；Add打开／复用／关闭原生Plugins窗口，配置off/on/off刷新时Host PID／URL／历史不变，禁用状态和配置字节跨完整重启保留，再启用通过 |
| 安装后的Office Windows引擎及真实转换 | [最终报告](../../.artifacts/desktop-settings-B2UqF6/report.json)确认Office0.1.6-alpha.2、Kit及win32-x64引擎0.0.1均从隔离profile解析，3次启动校验载荷／执行文件指纹；真实Host将1781字节DOCX转换为22877字节PDF，%PDF-及EOF完整、Host PID不变；[输出PDF](../../.artifacts/desktop-settings-B2UqF6/packaged-office-fixture.pdf) |
| 签名、安装／卸载向导、发布 | GetAuthenticodeSignature核对EXE、MSI和win-unpacked应用均为NotSigned；安装／卸载向导与发布未执行 |

<a id="dev-note"></a>
## 开发备注

本页是本轮迁移的证据快照，不替代包 README 和源码约定。并行任务完成时，只更新对应行和验证证据；真实外部条件与未执行项保留。原工作树、冻结归档、提交与推送不属于本次文档修改。Cinlan 独立 Settings 与未来 Linear.app 视觉方向见[功能导航设计背景](../design/cinlan-feature-navigation.md#dev-note)，不由官方功能版本决定。
