# Cinlan 设置实现方案

状态：最终 Windows 包已包含捕获 bundle/草稿交接修正，实际打包应用启动、设置保存及完整进程重启检查通过。通知、Worktree、Git、原生 PTY 与元素捕获的定向测试和真实 Web 场景已有本轮证据；全仓文档检查仍有失败，发布验收也有未执行项，详见[当前验收记录](settings-native-acceptance-status.md)。25 页、148 个原型字段是消费者分类数，不能当作全部功能实现数。视觉与信息架构继续以用户确认的 [settings-native-preview.html](../../reports/settings-native-preview.html) 为唯一原型，文件未修改。下方第一批验证回执只属于历史基线，不覆盖本次修正。

## 交付范围

保留六组导航和 25 个页面。沿用 Harness 当前通用设置的行式布局、轻分隔线、胶囊选择器和外观选项，参考 Orca 补齐功能行为。原型内的示例数据、localStorage 模拟、连接检查、导出 JSON 和标为方案预览的控件不能直接作为正式实现。

| 分组 | 页面 |
|---|---|
| 个人偏好 | 通用、通知、快捷键、浮动工作区 |
| AI 与模型 | 模型、Agent 预设、编排、语音 |
| 开发工作流 | Git、集成、工单、Worktree 任务、工作区隔离 |
| 工具与设备 | 安全研究、浏览器、元素捕获、计算机控制、移动设备、设计 |
| 扩展管理 | 插件 |
| 实验 | MCP 服务、自动化、执行主机、终端、使用统计 |

实施时不再参考被清理的旧 demo、warm、v2–v4，也不使用 cinlan-design 的通用默认值覆盖已确认页面。原型中的颜色与尺寸需要映射到已有主题 token；需要的新 token 由主题包拥有。原型是视觉基准，真实能力、权限、平台限制和生效方式以当前源码与运行验证为准。

## 视觉验收基准

- 桌面侧栏 280px、顶栏 64px；主要设置区最大宽度 960px，桌面内部左右留白 36px。中等窗口沿用原型的收窄规则。
- 桌面标题 26px，设置标签 14px，说明 12px；字体沿用系统中文字体栈。移动布局不通过缩小必要文字解决空间不足。
- 行式设置使用细分隔线；资源列表才使用完整边框。外观选择块为 20px 圆角，选择控件约 36px 高并使用胶囊轮廓。
- 保留左右独立滚动、组折叠、选中态、面包屑、搜索定位与移动端抽屉。窄屏弹层必须处理焦点、背景不可交互、滚动锁定和返回焦点。
- 使用现有图标和 UI primitives，删除原型中的手写 SVG 复制及统一大字典页面渲染器。密度沿用基准；可点击范围、对比度和缩放适配按实际控件审查，不照搬原型的可访问性缺口。
- 在相同视口与相同数据下对比实际渲染：1680×1000、1280×800、768×1024、390×844；补充 320px 回流、200% 缩放、浅色和深色。截图在实施验证时重新生成，不把清理掉的临时截图作为依赖。

## 初次实施核对与必要修正

以下保留最初制定方案时的源码基线与实施要求；当前消费者分类以[字段账本](settings-native-field-ledger.md)为准，实际运行结果以[验收记录](settings-native-acceptance-status.md)为准。

| 核对项 | 现状与实施要求 |
|---|---|
| 导航与搜索 | 当前 section 仅有 id/order/label，搜索只匹配页面标签。分组、字段搜索、定位必须增加明确的元数据路径，不能给通用 slot 任意附加字段。 |
| 用户设置 | 主机插件命名空间按 schema 默认值 → 组合基础值 → 用户覆盖解析；有 revision、可写状态和 set/unset。恢复默认应移除用户覆盖。 |
| 语音偏好 | 当前启用、听写方式、模型与麦克风选择由浏览器 localStorage store 持有；模型资源与执行在主机。不能统一改成主机配置而不设计迁移与设备语义。 |
| Agent 与权限 | Agent 预设由独立文件组合；默认预设和默认权限作用于新会话。当前会话的权限与已开始会话的组成分别管理。 |
| 模型 | 提供商、凭据和会话模型选择各有写入入口。会话模型切换还会保存为未来 Agent 默认值，正式说明需保留这一事实。 |
| 工单 | 当前可选组合已包含 GitHub、GitLab、Linear 三种真实 Provider，外部写入默认关闭。原型中“仅 GitHub / Linear”的说明需要在正式实现时纠正。 |
| 快捷键 | 当前页面可保存 overrides，但真实 Lexical、CodeMirror 等按键消费者仍需接入，不能以“保存成功”代替动作验证。 |
| 浮动工作区与设备偏好 | 部分字段有 schema 和 UI，但运行时消费尚未核实或缺失；逐字段补齐读取、应用与反馈。 |
| 元素捕获 | 当前独立设置页主要是静态指引；真实捕获与产物附加需要连接对应能力，不能由设置页伪造操作结果。 |
| Worktree / 隔离 | 已有原生任务与生命周期能力；相关管理页有本机限制，普通 Web 组合未默认挂载。接入时明确可选组合和可用性。 |
| 插件 | 已有命名空间配置与主机/预设只读清单。安装、启停、更新、回滚需要正式插件事务支持，不能改成直接偏好开关。 |
| 残余目录 | 初查时 ui-settings-primitives、ui-settings-terminal 只有残余构建产物；ui-settings-terminal 已按正式源码、manifest 与消费者重新建立，旧构建产物不作为实现依据。 |

## 技术方案

### 1. 设置域元数据与页面组成

在现有 [ui-settings](../../packages/client/ui-settings/src/client/index.ts) 中增加设置域元数据服务，建议私有实现文件为 settings-metadata.ts。通用 ui-slots 框架保持不变，所有 UI 继续通过 ctx.slots.register 组成。

页面所有者注册 sectionId 与 groupId；字段所有者注册稳定 itemId、anchorId、标题/说明/关键词的本地化解析，以及实际需要的 tabId、namespace、path。页面名称、顺序与图标继续以 settings.section / settings.section.icon 为唯一来源，字段文案复用界面本身的 locale keys。搜索不收录当前值、密钥、令牌或用户目录内容。

元数据与组件在同一个 slots.inject 生命周期中登记并共同释放；只有实际存在的 section 才进入导航，字段卸载后同步移除索引。没有指定分组的第三方 section 统一归入扩展管理，这是显式兼容策略。六个标准分组名称与顺序由设置 shell 的 locale 拥有。

服务提供稳定的纯数据快照，shell 通过 inject hooks 消费；React 组件不直接订阅 Cordis 服务。搜索词、当前页、展开状态、定位请求属于界面状态，不写 Session log。增加定位 owner props 时同步修改所有消费者及类型测试；定位请求携带稳定 itemId，页面在目标已挂载后滚动并聚焦，只消费一次。

以下是现有页面 owner 和 section id；正式迁移保留这些 id，不用 HTML 的简短路由名重命名用户入口。

| 页面 | 当前源包（packages/client/ 下） | section id |
|---|---|---|
| 通用 | ui-settings-general | general |
| 通知 | ui-notifications | notifications |
| 快捷键 | ui-keybindings | keybindings |
| 浮动工作区 | ui-floating-workspace | floating-workspace |
| 模型 | ui-settings-models | models |
| Agent 预设 | ui-agent-preset | agent-presets |
| 编排 | ui-orchestration | orchestration |
| 语音 | ui-voice-dictation | voice |
| Git | ui-git-settings | git-source-control |
| 集成 | ui-integrations | integrations |
| 工单 | ui-work-items | workItems |
| Worktree 任务 | ui-worktree-task | worktree-task |
| 工作区隔离 | ui-workspace-isolation | workspace-isolation |
| 安全研究 / 浏览器 / 计算机控制 / 移动设备 / 设计 | ui-settings-security | cinlan-security / cinlan-browser / cinlan-computer / cinlan-mobile / cinlan-design |
| 元素捕获 | ui-browser-element-capture | browser-element-capture |
| 插件 | ui-settings-plugins；ui-settings-plugin-inventory 注入清单 tab | plugins |

五个实验页已有专用设置 owner：ui-settings-mcp、ui-settings-automation、ui-settings-hosts、ui-settings-terminal、ui-settings-usage，以及对应运行服务和真实组合证据。新包同步登记 manifest、Client tsconfig、bundle 和依赖；新增 Remote 通过 Typert 正常生成并接入，不直接修改生成物。终端 Client 传输归 API Controller 的独立 Client 编译面，UI 只注入普通回调。

### 2. 公共布局与控件

在 [ui-settings-general](../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx) 实现分组导航、顶栏、标题区与搜索结果，在其 CSS Module 中复刻原型几何。复用 [ui-primitives](../../packages/client/ui-primitives/README.md#component-catalog) 的 Button、Switch、Input、Menu、Modal、Tag 和图标。

优先使用已有 primitives；SettingsRow、SettingsSection、资源列表行等布局在出现两个真实消费者时再提取到公共静态包。新组件接收本地化纯数据与回调，不拿 ctx、不读主机业务状态、不从一个功能插件导入另一个功能插件的组件。主机与浏览器的新业务行为放在已有服务或所属提供程序中。

迁移触及 Floating、Keybindings、Mobile 等存在组件内手动订阅的代码时，将订阅改为框架 inject hooks 和明确动作，保持改动在所迁移功能内，不扩展为全仓重构。

### 3. 写入、生效和失败反馈

普通主机偏好继续走 SettingsScope 与现有 describe mirror、串行写入、revision 校验。成功状态必须由实际写入结果驱动；失败保留输入并给出重试，冲突读取最新版本后让用户重做选择，不静默覆盖。即时偏好与带提交按钮的配置表单分别处理，不强加统一保存模式。

普通配置、凭据、Agent 文件、浏览器设备偏好、工作区记录分别使用所属入口。顶栏只聚合当前页面实际发生的保存状态，不统一显示“已保存到本地”。远程非本机设置维持当前只读/不可用语义，未扩展正式主机写入协议前不放开写入。

可重置字段通过 unset 恢复继承；带基础配置、重启要求或只对新任务生效的字段显示简短说明。保留旧键名和用户值，必要迁移由所属持久化模块负责，不为视觉重构创建第二套设置文档。

### 4. 能力状态与后续扩展

设置页显示的状态来自能力服务：可用、未配置、缺依赖、平台不支持、当前主机不可达等，具体状态按已有服务结果映射。检测、安装、启停和任务执行是不同操作，不能把“插件存在”当作“连接成功”。

第一阶段可在完整产品组合中提供 25 个信息入口。尚未完成运行接入的页面由该功能插件提供真实说明和可用下一步，不显示会假保存的控件。headless、最小配置或第三方组合不强制挂满 25 页，也不为了导航效果默认启用可选执行能力。

## 分阶段实施

### P0：字段账本与基准冻结

为原型每个交互字段记录：当前源码 owner、存储位置、读取方、写入方、运行消费者、生效时间、可写条件与验收场景。分类为可直接接入、已有设置但缺消费、需新服务能力、仅视觉示例。修正工单、语音、快捷键等已发现差异，不以 HTML 的演示默认值覆盖正式默认值。

验收：25 页每个可编辑字段都能说明实际改变哪项行为；没有消费者的字段进入后续阶段，不在 P1/P2 伪装完成。

### P1：导航、搜索、公共样式

修改设置域元数据、shell 合同、shell 组件和 locale，给现有功能入口登记分组。完成字段搜索、空结果、展开定位、快捷搜索、稳定滚动位置和移动抽屉；让通用、模型、插件三个代表性页面首先达到视觉基准。

验收：插件加载/卸载和热更新后导航、图标、字段索引一致；中英文切换后搜索索引更新；无密钥入索引；截图中侧栏、内容列和控件与 HTML 对齐；键盘定位和失去目标页面时的回退正常。

### P2：已有偏好与 AI 功能接入

| 页面 | 实施内容 |
|---|---|
| 通用 | 复用语言、主题、字号、对话展示、发送行为与默认权限；新增工作区/导航项仅在存在消费者后接入。 |
| 通知 | 连接现有完成提醒、终端铃声、声音、聚焦静默与测试动作；浏览器授权和偏好开关独立。定时免打扰单列为新增行为。 |
| 模型 | 保留提供商编辑、模型目录、主机凭据入口；默认模型和会话模型的关系说明准确，检测使用真实响应。 |
| Agent 预设 | 内置只读、自定义复制/打开文件/删除、新会话默认值；现有 authoring 只允许从已有预设复制。结构化编辑预设组成需要新的主机 authoring API，不能把浏览器提交的任意配置直接写入。 |
| 编排 | 接上真实预设能力覆盖与可配置并行参数，保持各参数的主机/预设归属。 |
| 语音 | 复用浏览器 voice settings store、麦克风设备与权限、主机模型资源状态；验证听写进入草稿，失败不丢原稿。 |
| 插件 | 复用命名空间配置卡与主机/预设清单；插件内容自行注册设置和搜索项。 |

验收：改值 → 实际行为改变 → 刷新或重连后的正确恢复；写入失败/冲突可恢复；预设、权限和模型不意外改变已有运行任务。

### P3：开发工作流与工具设备

| 页面 | 实施内容 |
|---|---|
| Git | 接入现有 git-source-control 字段；分支前缀、基准更新、比较与署名逐项验证实际 Git 调用。原型新增的 AI 提交项按提供能力单列。 |
| 集成 | 展示真实服务和凭据引用，管理入口复用对应 Provider/主机配置；不在工单页再维护一份令牌。 |
| 工单 | 接入 GitHub/GitLab/Linear、范围与分页、工作区/会话关联；外部修改保留预览与单独确认。 |
| Worktree 任务 | 接通现有任务列表、详情与审查；默认目录/Hook 等先补 owner 与真实任务消费，任务创建仍由任务能力执行。 |
| 工作区隔离 | 接通租约/活动记录、休眠、差异、合并/导出和安全回收；主机与平台限制如实显示。 |
| 安全研究 | 使用主机 readiness 与工具能力；检测失败给出具体缺项，不用假安装按钮。 |
| 浏览器 | 复用原生浏览器服务与已持久化偏好；主页、链接路由、配置文件与真实操作逐项对应。 |
| 元素捕获 | 从静态指引接入真实目标选择、捕获结果与会话草稿附加；对模型可见的输入按 Session 记录规则落地。 |
| 计算机控制 | 展示真实设备、权限与检测状态；配置变更要由执行提供程序消费。 |
| 移动设备 | SDK、adb、设备枚举与首选目标分开；先补偏好消费，再提供自动路由；环境安装不冒充路径保存。 |
| 设计 | 保留能力清单和真实可用入口；产物目录/导出偏好仅在对应输出能力消费后开放。 |

验收：完成正常、未连接、缺依赖、拒绝授权和恢复连接流程；使用真实组合或受控 Provider 场景，不能只测 mock 设置表单。

### P4：补齐偏好到执行的缺口

快捷键以稳定 command id 和焦点作用域为单位，将有效绑定接入 Lexical、CodeMirror 及 shell 的实际动作。共享解析/冲突算法由窄的键盘能力 owner 提供；各输入组件保留自己的事件分派。验证 IME 组合输入、平台修饰键、浏览器保留键、弹层优先级、恢复默认和热更新，不把一个全局 keydown 接管全部编辑器。

浮动工作区先接通开关、入口位置与实际 shell 渲染，再接尺寸和终端目录。网页浮层与 Electron 独立窗口分清支持范围；实现焦点返回、工作区切换与窗口关闭后的资源清理。

与 P2/P3 同时跟踪每个已保存但未消费的字段。完成标准是动作结果改变和生命周期正确，不是写入 API 返回成功。

### P5：实验功能完整接入

| 页面 | 先决条件与交付 |
|---|---|
| MCP 服务 | 在现有 Tools 桥接能力上补管理 API；校验 stdio 命令/HTTP 地址、凭据引用、所属组合、连接及工具列表，明确启动与停止行为；不宣称支持 Resources/Prompts。 |
| 自动化 | 先确定持久任务定义、时区、去重、错过执行、并发、暂停和运行历史，再提供跨工作区计划 UI；会话提醒、Webhook 与计划任务的执行语义不能直接混同。 |
| 执行主机 | 先有主机记录、认证、连接状态和能力查询；配置与设备归目标主机，远程设置写入另行实现明确协议。 |
| 终端 | 以当前持久终端服务和真实终端消费者为 owner；补默认 Shell/目录/渲染偏好与恢复行为。不能复用只剩 lib 的目录作为源码。 |
| 使用统计 | 基于真实 Session/telemetry 数据聚合时间范围、模型和用量；未知值、零值、加载失败分开，不以示例倍数生成统计。 |

验收：每个实验项先完成服务、Provider、UI 消费和真实组合验证，再移除“未接入”说明；实验入口本身不意味着能力默认激活。

## 检查与交付

每个阶段提交独立、可审查的改动，依赖顺序为 P0 → P1 → P2/P3 → P4/P5。P2 与 P3 可按功能 owner 并行；公共导航和元数据由一个任务串行维护，避免多任务同时改同一合同。

- 功能测试覆盖值的读写与恢复、失败与冲突、只读场景、定位和操作结果；元数据覆盖重复登记、语言切换、卸载与 HMR。
- 页面与渲染调整使用仓库 GUI 检查；实际组合变化增加 keyless Web replay 和对应预期输出。运行命令与范围按改动选择，实际执行结果见本轮验证记录。
- 每个功能页保留中英文 typed locale；功能公开行为同步 README/JSDoc。非局部改动附 Agent Note，只有完成运行验证后才记录为 implemented。
- 浏览器验证包含主机/浏览器保存归属、刷新重连、跨语言搜索、浅/深主题、键盘、触屏目标、长文案、失败重试与可选能力缺失。
- 带 GUI 改动的 PR 按仓库要求附交互证据；不以静态图或 HTML 模拟证明真实集成完成。

当前源码覆盖 P1–P5 的页面和已记录运行消费者；消费者账本区分未支持偏好、固定行为和已暴露操作。本轮执行了免打扰、Worktree 默认值/审查/程序生命周期、元素捕获草稿交接、Git 和终端的定向测试及真实组合检查，并成功生成和启动 Windows 安装产物。最终源码与产物的一致性、剩余 UI 矩阵及文档失败仍需逐项确认；[当前验收记录](settings-native-acceptance-status.md)是这些结果和待续事项的唯一汇总。

## 第一批验证记录

- 设置元数据：63 项测试通过，新增元数据模块语句/分支/函数/行覆盖率均为 100%。外壳最终定向测试 52 项通过，覆盖搜索草稿保留、卸载和焦点恢复。
- 全量 `GUI`：5749 项通过、7 项跳过，10 项测试失败，并有 3 个测试文件在导入阶段失败。剩余问题位于未修改的侧边栏 CodeMirror/PTY 路径、图标计数和旧 CSS 约束；本批引入的 metadata 依赖夹具问题已修复，不能将全套测试标为通过。
- 全局界面文案门禁：731 个 Client 源文件通过。设置域、外壳和模型/插件的定向 lint 通过；全库 lint 仍有既有问题。
- 全库 `doc-sync`：执行结果 16 项通过、18 项失败；本批新增 Agent Note 结构与元数据 JSDoc 问题已修正。剩余包括既有语音 Agent Note 格式、缺失文档引用、导出 JSDoc 和 README 规范问题。相关中英文配对已单独验证。
- 最终 `pnpm run build`、`pnpm exec tsc -b tsconfig.client.json --pretty false` 通过。`DSH_SNAPSHOT=replay` 下设置外壳 13 项、模型配置 11 项、两组引导 7 项、原生浏览器 5 项最终通过。原生下载用例曾在并行重放时等待 complete 超时，保持源码不变、单独重放后 5 项全部通过，保留此时序敏感性记录。浏览器覆盖真实字段搜索、插件标签页、尺寸切换、草稿保留、焦点隔离，以及主题/语言/偏好跨刷新和端口的持久化。
- 已打开检查实际应用的 1680×1000 桌面与 390×844 手机截图，分别位于 `.artifacts/settings-native-current-desktop.png` 与 `.artifacts/settings-native-current-mobile.png`。批准 HTML 的 SHA256 与原始记录一致，`reports` 根目录仍只保留该设置原型。

## 关键源码

- [设置导航合同](../../packages/client/ui-settings-general/src/client/shell-contract.ts)、[slot 投影与注册](../../packages/client/ui-settings-general/src/client/index.ts)、[页面 shell](../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx)。
- [设置 slot 所有权](../../packages/client/ui-settings/src/client/contract/slots.ts)、[设置域启动](../../packages/client/ui-settings/src/client/index.ts)、[SettingsScope 写入](../../packages/client/ui-settings/src/client/settings-scope.ts)、[持久设置说明](../../docs/subsystems/settings.md)。
- [快捷键设置及保存](../../packages/client/ui-keybindings/src/client/KeybindingsSection.tsx)、[语音偏好](../../packages/client/ui-voice-dictation/src/client/voice-settings.ts)。
- [工单组合](../../packages/bundle/cinlan-work-items/cordis.patch.yml)、[GitLab Provider](../../packages/work-items/work-items-gitlab/src/index.ts)、[元素捕获当前范围](../../packages/client/ui-browser-element-capture/README.md)。
