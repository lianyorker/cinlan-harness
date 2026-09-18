# 设置原型字段与运行消费者账本

该账本对应用户批准的 [settings-native-preview.html](../../reports/settings-native-preview.html)，覆盖 25 页与 148 个字段。运行设置不移植原型种子数据；原型字段按真实偏好、固定行为、未暴露操作与未支持能力分类。148 项均有消费者或未支持分类；分类完成不代表功能实现或运行验收完成。当前整包状态与本轮发现见[验收记录](settings-native-acceptance-status.md)。

“已验证”保留此前对应范围的证据；“owner 证据”只引用该来源已提供的分包行为、Loader 或 API 回执；“源码消费者”表示本次审计已定位实际读取或操作路径，不表示重新运行验证。二者均不替代本批重新构建后的 Web/Electron 组合验收。既有测试数量保留为来源回执，未由本次审计重跑或汇总为整批通过。“固定行为”没有独立偏好；“未暴露”表示页面没有对应控件或动作；“未支持”表示缺少该偏好或行为；“明确不可用”表示已有禁用控件或不可用说明；“待接入”保留尚未完成消费者映射的字段。主机偏好只在当前连接可写时写入，重置移除用户覆盖；设备偏好留在所属浏览器。

桌面使用 `dsh-app://app/index.html` 和与 Web 相同的 client bundles。语音源码已通过共享 Remote 接入，桌面覆盖层已解除 Provider 禁用；既有 owner 回执记录无 HTTP 服务器的真实 Loader/Connection 组合、HTTP 认证、转写/取消/卸载共 19 项验证。浮动窗口已有 Desktop 窗口策略与终端目录消费者，Git/终端已有共享 Remote 传输。2026-09-18 最终 Windows 包完成构建，实际打包应用的设置和 Git/终端偏好跨进程重启保留；assembled sidebar Git Web 回放通过。早期 Electron 的 Git 初始化错误保留为历史问题，当前打包应用内的终端命令执行仍未验证；本地包不代表已安装发行版已更新。

## 通用

页面：[ui-settings-general](../../packages/client/ui-settings-general/README.md)。 存储/服务：多 owner 的 SettingsScope；详见各通用行包。已接入的六项使用真实 Host 偏好，作用时机见逐项说明。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `general.permission` | 默认权限 | 已验证：权限行写新会话默认权限，不改当前会话权限。 |
| `general.language` | 语言 | 已验证：locale 行写入后界面与搜索索引立即更新，刷新恢复。 |
| `general.theme` | 外观 | 已验证：主题行即时应用、启动前恢复偏好并支持跟随系统。 |
| `general.fontSize` | 字号大小 | 已验证：主题字号仅影响会话内容，刷新恢复。 |
| `general.transcript` | 对话显示 | 已验证：ui-chat 消费已完成轮次展示方式。 |
| `general.busySend` | 繁忙时的发送行为 | 已验证：ui-conversation 消费运行时 Enter/发送行为。 |
| `general.tabOrder` | 标签切换顺序 | 未支持、未暴露：没有此 SettingsScope 字段、owner 或独立存储。实际顺序由 [ui-dockkit PaneNode.tabs](../../packages/client/ui-dockkit/src/contract/types.ts) 及承载面板的状态保存；[TabPanel](../../packages/client/ui-dockkit/src/components/TabPanel.tsx) 只按当前 pane 的 tabs 处理点击和 ArrowLeft/ArrowRight/Home/End，不读取此字段。侧边栏布局由 [sidebar state](../../packages/client/ui-better-sidebar/src/client/state.ts) 按会话写入 localStorage，顺序随布局操作生效；通用页没有可改变它的消费者。 |
| `general.confirmPinned` | 关闭固定标签页前确认 | 未支持、未暴露：没有通用偏好或对应确认消费者。源码中的 pinned 属于 [open-with 配置](../../packages/client/ui-better-sidebar/src/client/open-with.ts) 的外部编辑器菜单目标，保存在 pluginSettings['editor'].openWith，由 [EditorHost](../../packages/client/ui-better-sidebar/src/client/EditorHost.tsx) 调整；它不是 tab 的 pinned 状态。[sidebar closeTab](../../packages/client/ui-better-sidebar/src/client/state.ts) 直接关闭 tab，没有此确认分支。 |
| `general.worktreeDirectory` | 工作区目录 | 未支持、未暴露：工作区 owner [WorkspaceRegistry](../../packages/workspace/workspace/src/index.ts) 把显式传入且 canonicalize 后的目录存入 workspaces storage-domain table；Git 隔离 owner 的 deployment Config.root 由 [workspace-isolation-git](../../packages/workspace/workspace-isolation-git/src/index.ts) 固定为配置值或 `<DSH_HOME>/worktrees/v1`，Worktree Task 的 defaultDirectory 则由 [worktree-task-git](../../packages/workspace/worktree-task-git/src/index.ts) 存在其 global settings 中并限制为 managed root 的相对子目录。创建时这些 owner 才消费路径，已有工作区/checkout 不随通用字段改变；没有 general.worktreeDirectory 的 SettingsScope 写入或运行读取。 |
| `general.nestWorkspaces` | 按仓库组织工作区 | 未支持、未暴露：最近的真实设置是 [ui-workspace store](../../packages/client/ui-workspace/src/client/stores.ts) 的 `groupBy=workspace` / `flat`，持久化为 dsh.workspace.view.v5；[tree](../../packages/client/ui-workspace/src/client/tree.ts) 和 WorkspaceBrowser 只把会话按 Workspace 分组或列成平面列表，不按 Git 仓库嵌套 Workspace。该字段没有 schema、存储或运行消费者，切换现有 groupBy 不能计为 nestWorkspaces。 |
| `general.confirmDelete` | 删除工作区前确认 | 固定行为、未暴露：owner 是 [WorkspaceBrowser](../../packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx)，删除入口总是先打开 Modal，只有确认按钮调用 deleteWorkspace；[WorkspaceRegistry.delete](../../packages/workspace/workspace/src/index.ts) 仅删除持久化注册记录，保留目录和会话日志。没有可关闭确认的 general 偏好，因此当前生效值固定为确认。 |
| `general.editor` | 默认编辑器 | 未支持、未暴露：没有通用默认编辑器字段。内置 editor tab 由 [better-sidebar builtins](../../packages/client/ui-better-sidebar/src/client/builtins/tabs.tsx) 固定提供；外部应用 owner [open-in-app controller](../../packages/client/ui-open-in-app/src/client/controller.ts) 只把最近选择持久化为浏览器键 dsh.open-in-app.choice，并按 Host 返回的安装列表启动当前会话 cwd。[open-with](../../packages/client/ui-better-sidebar/src/client/open-with.ts) 的 customEditors/pinned 属于 editor 插件设置，也不是默认值；通用页没有读取 general.editor。 |
| `general.restoreWorkspace` | 启动时恢复工作区 | 未暴露、固定启动恢复：没有此偏好。[Session service](../../packages/api/session-controller/src/client/sessions/service.ts) 将当前会话选择持久化为 dsh.sessions.current，并在构造时恢复；[WorkspaceRegistry](../../packages/workspace/workspace/src/index.ts) 启动时打开 storage domain、读取 workspaces table 并重建索引。运行时恢复的是当前会话选择和 durable Workspace 列表，不能通过通用页开关，亦没有 general.restoreWorkspace 消费者。 |
| `general.update` | 应用更新 | 未暴露（Desktop 行为已支持）：owner 是 [DesktopUpdateCoordinator](../../apps/desktop/src/update-coordinator.ts)，availableVersion 和 updateState 只在进程内保存；[Desktop main](../../apps/desktop/src/main.ts) 通过 shell-only updates-check/updates-install IPC、原生菜单和启动后检查触发它，[preload bridge](../../apps/desktop/src/preload.ts) 提供 renderer API。仅打包进程且存在 app-update.yml 时检查有效；autoDownload/autoInstallOnAppQuit 均关闭，安装会下载已确认版本、执行 beforeRestart 后 quitAndInstall。通用页没有更新导航或控件，Web 端不能以此字段声明已接入。 |

## 通知

页面：[ui-notifications](../../packages/client/ui-notifications/README.md)。存储/服务：notifications / browser Notification / Web Audio。[运行消费者](../../packages/client/ui-notifications/src/client/runtime.ts)读取完成状态、工具结果 BEL、前台静默及声音枚举；[页面](../../packages/client/ui-notifications/src/client/NotificationsSection.tsx)提供定时免打扰开关与本机时段编辑；两个端点通过同一次带 revision 的写入保存，失败恢复读取值并允许显式重试；定向测试与真实 Web 回放结果见验收记录。独立声音开关与音量仍未暴露。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `notifications.enabled` | 启用通知 | owner 证据：自动完成/BEL 提醒总开关。 |
| `notifications.completed` | Agent 完成任务 | owner 证据：running→idle 的新完成通知。 |
| `notifications.bell` | 终端铃声 | owner 证据：仅新追加 tool/result 的 BEL；不是原始 PTY 流。 |
| `notifications.focused` | 专注时静默 | owner 证据：document.hasFocus 前台静默。 |
| `notifications.test` | 测试通知 | owner 证据：由明确点击请求浏览器授权，再展示真实测试通知。 |
| `notifications.sound` | 通知提示音 | 未支持、未暴露：没有独立的声音总开关；实际页面提供 sound 枚举选择。 |
| `notifications.soundType` | 提示音 | owner 证据：sound 枚举由 runtime.ts 播放；system 不额外播放本地音效。自定义文件名可保存，音频对象仅在本次页面加载期间可用，刷新后须重新选择。 |
| `notifications.volume` | 音量 | 未支持、未暴露：没有音量偏好；现有 Web Audio 音效使用固定增益。 |
| `notifications.quiet` | 定时免打扰 | 已接入，运行证据见验收记录：quietHoursEnabled 默认 false，开启后在本机时段内抑制完成/BEL 通知和提示音，不补发；显式测试绕过前台/时段抑制，仍遵循总开关与浏览器权限。 |
| `notifications.quietStart` | 开始时间 | 已接入，运行证据见验收记录：quietHoursStart 默认 22:00，HH:mm 校验；包含开始时刻，开始晚于结束表示跨午夜。页面与结束时间原子提交；reset 移除覆盖。 |
| `notifications.quietEnd` | 结束时间 | 已接入，运行证据见验收记录：quietHoursEnd 默认 08:00，结束时刻恢复通知；起止相同表示全天。Host 保存设置，各浏览器按自己的本机时间执行；刷新与冲突回归结果见验收记录。 |

## 快捷键

页面：[ui-keybindings](../../packages/client/ui-keybindings/README.md)。存储/服务：keybindings.overrides / keyboard。owner 已交付；[Composer 命令](../../packages/client/ui-conversation/src/client/keyboard-commands.ts)、CodeMirror 保存/查找/替换、shell 侧边栏与浮动窗口已有实际注册及本地分派，保留输入法、弹层优先级与编辑器撤销。原型八项中可确认发送与浮动切换；Shift+Enter 是固定编辑器行为，其余未注册操作不能计为已接入。[快捷键页](../../packages/client/ui-keybindings/src/client/KeybindingsSection.tsx)仅允许编辑实际注册命令，缺少消费者的旧 id 保留并显示不可用；整批组合验收待完成。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `shortcuts.newSession` | 新建会话 | 未暴露：未注册此操作的可编辑快捷键；旧覆盖项保留并显示不可用。 |
| `shortcuts.send` | 发送消息 | 源码消费者：conversation.submit / submitAccelerated 由 Lexical 本地处理器读取实时绑定，分别执行普通/加速发送；保留输入法与弹层优先级。 |
| `shortcuts.newLine` | 换行 | 固定行为：Shift+Enter 由 Lexical 处理，不可重映射；保存的 conversation.newLine 旧覆盖项显示不可用。 |
| `shortcuts.stop` | 停止生成 | 未暴露：未注册停止生成的可编辑快捷键；不能用停止按钮的存在证明快捷键已接入。 |
| `shortcuts.search` | 搜索设置 | 未暴露：未注册设置搜索的可编辑快捷键；不沿用原型 Ctrl+K。 |
| `shortcuts.command` | 命令面板 | 未暴露：未注册命令面板快捷键或对应命令消费者。 |
| `shortcuts.floating` | 切换浮动工作区 | 源码消费者：floatingWorkspace.toggle 由浮动入口处理器执行；默认 Ctrl+Shift+Space，是否可用随浮动窗口能力与 enabled 变化。 |
| `shortcuts.terminal` | 切换终端 | 未暴露：未注册终端切换的可编辑快捷键。 |

## 浮动工作区

页面：[ui-floating-workspace](../../packages/client/ui-floating-workspace/README.md)。存储/服务：floating-workspace。owner 已交付；[runtime](../../packages/client/ui-floating-workspace/src/client/runtime.ts)消费 enabled、入口、下一窗口尺寸与命令；[注册入口](../../packages/client/ui-floating-workspace/src/client/index.ts)仅在真实终端消费者存在时开放目录编辑。[TerminalView](../../packages/client/ui-better-sidebar/src/client/TerminalView.tsx)传递新浮动终端的目录与窗口身份，[Host 目录解析](../../packages/client/ui-better-sidebar/src/terminal-directory.ts)检查存在性和工作区内包含关系；[Desktop 窗口策略](../../apps/desktop/src/floating-window.ts)拥有原生子窗口。窗口不自动恢复，终端最终传输组合与整批 Web/Electron 验收待完成。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `floating.enabled` | 启用浮动工作区 | 源码消费者：enabled 控制入口和命令可用性；开启本身不打开窗口，关闭会关闭所属窗口。 |
| `floating.position` | 入口位置 | 源码消费者：toggleButtonPosition 选择 header/sidebar/floating 的实际入口；header 依赖会话头部存在，不新增 statusbar 选项。 |
| `floating.directory` | 终端启动目录 | 源码消费者：实际终端消费者挂载时才允许编辑 terminalDirectory；新浮动终端捕获窗口身份和目录。留空用 Session cwd，仅允许其中已存在的目录，Host 拒绝符号链接逃逸；最终终端传输组合待交接。 |
| `floating.width` | 窗口宽度 | 源码消费者：floatDefaultWidth 为下一次打开窗口请求初始宽度，正式范围 200–800；不调整已打开窗口，实际尺寸受浏览器/操作系统限制。 |
| `floating.height` | 窗口高度 | 源码消费者：floatDefaultHeight 为下一次打开窗口请求初始高度，正式范围 150–600；不调整已打开窗口，实际尺寸受浏览器/操作系统限制。 |
| `floating.shortcut` | 切换快捷键 | 源码消费者：使用 floatingWorkspace.toggle 的实时绑定，覆盖与冲突由快捷键页管理；子窗口不再注册打开子窗口的命令。 |

## 模型

页面：[ui-settings-models](../../packages/client/ui-settings-models/README.md)。存储/服务：agent-default-model / 提供商命名空间 / credentials。模型目录和凭据使用现有 Remote；[默认模型设置](../../packages/client/ui-model-selection/src/client/DefaultModelSettings.tsx)通过 agent-default-model 影响未来 Agent，已有会话的显式选择不被覆盖，尚未选择的会话仍读取实时默认值。[模型页](../../packages/client/ui-settings-models/src/client/ModelsSection.tsx)未暴露原型的子智能体或高级配置导航动作。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `models.default` | 默认模型 | owner 证据：provider/model/reasoning 三项原子写入 agent-default-model；保留会话切换同时保存未来默认值的现有行为。 |
| `models.effort` | 推理强度 | owner 证据：仅提供当前路由支持的推理强度，更换模型清除不兼容旧值。 |
| `models.childModels` | 子智能体模型 | 未暴露：模型页没有跳转编排的操作；子智能体模型选择开关与允许路由集合实际位于插件页。 |
| `models.advanced` | 高级模型配置 | 未暴露：没有原型的独立高级配置/文档导航动作；真实提供商字段由本页 ProviderEditor 等现有编辑器管理。 |

资源区域：`providers`。实际模型目录、提供商配置编辑与增删使用现有 owner；原型种子数据不移植。页面声明的 footer slot 没有提供原型导航动作的贡献者。

## Agent 预设

页面：[ui-agent-preset](../../packages/client/ui-agent-preset/README.md)。存储/服务：预设文件 / 默认预设设置。[AgentPresetSection](../../packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx)展示真实默认预设与内置/自定义列表；内置预设只读，复制、打开文件、删除与新会话默认值走现有 authoring API。页面未暴露前往通用权限的动作。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `presets.default` | 新会话使用 | owner 证据：默认预设影响新会话，不改已开始任务。 |
| `presets.permissions` | 新会话默认权限 | 未暴露：预设页没有前往通用设置的操作；默认权限独立归通用页，不能据此宣称导航已实现。 |

资源区域：`presets`。列表、详情、创建/复制/删除表单以真实 owner 返回的对象和操作为准；原型种子数据不得移植。

## 编排

页面：[ui-orchestration](../../packages/client/ui-orchestration/README.md)。本页存储/服务为 agent-loop 与只读预设清单；最大工具并行数按下一组工具调用采样。[OrchestrationSection](../../packages/client/ui-orchestration/src/client/OrchestrationSection.tsx)仅提供并行数与能力说明/覆盖清单。子智能体模型的 enabled/allowedModels 编辑属于插件页 [SubagentModelSelectionCard](../../packages/client/ui-settings-plugins/src/client/SubagentModelSelectionCard.tsx)，由 [tool-subagent](../../packages/subagent/tool-subagent/src/index.ts)读取，不存在子智能体默认模型偏好。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `orchestration.parallel` | 并行工具调用上限 | owner 证据：agent-loop.maxParallelToolCalls，经 SettingsScope 写入及 unset。 |
| `orchestration.delegateModel` | 允许为子智能体选择模型 | 源码消费者、入口位于插件页：subagent-model-selection.enabled 和 allowedModels 由 SubagentModelSelectionCard 编辑；tool-subagent 在新顶层 Session 采样，子 Session 沿用已记录的父策略。编排页未暴露此开关。 |
| `orchestration.childModel` | 子智能体默认模型 | 未支持、未暴露：没有子智能体默认模型偏好；现有 allowedModels 是可显式选择的 provider/model 集合，不是默认模型或继承下拉框。 |

资源区域：`orchestration`、`coverage`。实际只读能力状态来自 pluginInventory；协作示例是说明，不提供原型资源的创建/复制/删除动作。

## 语音

页面：[ui-voice-dictation](../../packages/client/ui-voice-dictation/README.md)。存储/服务：浏览器 voice settings store / 主机模型目录。[浏览器偏好](../../packages/client/ui-voice-dictation/src/client/voice-settings.ts)仅含启用、模式、模型与麦克风；转录与模型资源归 Host，[听写消费者](../../packages/client/ui-voice-dictation/src/client/dictation-controller.ts)将识别结果写入发起会话的最新草稿。自动标点和提供方特有高级选项不列为已支持偏好；设置页未暴露替代输入位置或体验结果动作。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `voice.enabled` | 启用语音输入 | owner 证据：浏览器偏好决定听写入口。 |
| `voice.input` | 输入设备 | owner 证据：getUserMedia/enumerateDevices；设备 id 留在当前浏览器。 |
| `voice.punctuation` | 自动添加标点 | 未支持、未暴露：浏览器偏好仅含启用、模式、模型和麦克风，没有自动标点选项或消费者。 |
| `voice.permission` | 麦克风权限 | owner 证据：用户点击申请真实麦克风权限并刷新设备。 |
| `voice.destination` | 输入位置 | 固定真实行为：转录结果追加到发起会话的最新草稿；不自动发送，不新增无效下拉选择。 |
| `voice.try` | 体验听写结果 | 未暴露：设置页没有体验结果动作；真实听写从会话输入区麦克风发起，转录进入发起会话草稿，失败保留原稿。 |

资源区域：`voiceModels`。实际提供 Host 模型列表、状态、下载与移除；不移植示例模型或伪造创建/复制动作。

## Git

页面：[ui-git-settings](../../packages/client/ui-git-settings/README.md)。存储/服务：git-source-control。六项现有偏好保留；[worktree-task-git](../../packages/workspace/worktree-task-git/src/index.ts)消费分支前缀，[sidebar-git](../../packages/git/sidebar-git/src/index.ts)消费分组、比较与 attribution，[GitView](../../packages/client/ui-better-sidebar/src/client/GitView.tsx)展示排序、比较基准和待确认提交。源码消费者已定位，Git 最终传输接入与整批 Web/Electron 验收待交接；refreshLocalBaseRefOnWorktreeCreate 明确禁用，不承诺运行消费。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `git.prefixType` | 分支前缀 | 源码消费者：worktree-task-git 创建分支时读取 branchPrefix；git-username 只使用仓库本地 github.user / user.username。现有任务不改名，最终 Git 接入待交接。 |
| `git.prefix` | 自定义前缀 | 源码消费者：worktree-task-git 读取 branchPrefixCustom，拼接 `dsh/task/<id>` 并检查合法分支名；无效前缀明确失败，最终 Git 接入待交接。 |
| `git.autoName` | 根据任务自动命名 | 未支持、未暴露：没有按任务内容自动命名偏好；现有任务分支使用 `dsh/task/<id>` 后缀。 |
| `git.updateBase` | 创建前更新基准分支 | 明确不可用：refreshLocalBaseRefOnWorktreeCreate 的已有值保留、可重置，开关禁用；没有更新基准分支消费者，不承诺 fetch 或失败恢复。 |
| `git.upstream` | 与上游分支对比 | 源码消费者：sidebar-git.compare 读取 compareAgainstUpstream，优先已配置上游，缺失时选默认基准并在 GitView 明示回退；不触发 fetch，最终传输接入待交接。 |
| `git.signoff` | 为提交添加签署信息 | 未支持、未暴露：没有 Signed-off-by 偏好；现有 enableGitHubAttribution 不等于 Git signoff。 |
| `git.aiCommit` | AI 提交说明 | 未支持、未暴露：没有 AI 提交说明开关或生成消费者；现有提交流程使用用户输入并明确审阅。 |
| `git.commitLanguage` | 提交说明语言 | 未支持、未暴露：没有生成提交说明的语言偏好。 |

## 集成

页面：[ui-integrations](../../packages/client/ui-integrations/README.md)。服务：integration-preflight Remote / gh、glab 与凭据引用。[IntegrationsSection](../../packages/client/ui-integrations/src/client/IntegrationsSection.tsx)在挂载/重试时检查 GitHub/GitLab/Gitee；没有独立连接偏好或原型导航动作。工单 Provider 为 GitHub/GitLab/Linear，CLI 预检与 REST Provider 可用性不能混为同一结论。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `integrations.verifyOnStart` | 启动时检查连接 | 固定行为、未暴露偏好：IntegrationsSection 在页面挂载和重试时检查，不是应用启动检查，也没有可保存的启动开关。 |
| `integrations.issues` | 工单来源 | 未暴露：集成页没有前往工单的操作；工单页独立管理 GitHub/GitLab/Linear 来源可见性。 |
| `integrations.credentials` | 凭据保存方式 | 未暴露：没有原型的凭据说明/管理动作。实际预检复用凭据引用及 gh/glab 认证状态，不保存令牌副本。 |

资源区域：`integrations`。展示真实预检、认证状态及安装/认证指引；没有原型的添加连接或连接对象增删表单，不读取或复制用户令牌。

## 工单

页面：[ui-work-items](../../packages/client/ui-work-items/README.md)。存储/服务：work-items Provider / 工作区与会话关联。[WorkItemsSection](../../packages/client/ui-work-items/src/client/WorkItemsSection.tsx)提供实际查询、分页和关联，Host 偏好仅控制来源可见性；来源选择是页面状态，关联信息固定显示。[WorkItemWritePanel](../../packages/client/ui-work-items/src/client/WorkItemWritePanel.tsx)提供逐次预览确认写入，没有默认来源、显示关联或外部写入模式偏好。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `issues.github` | GitHub Issues | owner 证据：work-items.githubVisible 控制本页 GitHub 来源可见性，不停用 Provider；查询、分页、关联与批准写入使用 Provider。 |
| `issues.linear` | Linear | owner 证据：work-items.linearVisible 控制本页 Linear 来源可见性，不停用 Provider；REST 查询可用性与 CLI 预检分别显示。 |
| `issues.defaultSource` | 默认来源 | 固定行为、未暴露偏好：preferredSource 是本次页面挂载的状态，初始为 GitHub，不可见时取首个可见来源；没有持久默认来源。 |
| `issues.showLinked` | 显示已关联的工作区 | 固定行为、未暴露开关：工单详情直接显示现有关联的工作区与 Session，没有显示关联的独立偏好。 |
| `issues.writePolicy` | 外部写入 | 固定行为、未暴露偏好：外部修改使用 prepare、预览、逐次 confirm/cancel 及真实收据；没有可保存的只读/确认模式选择。 |
| `issues.connections` | 服务连接 | owner 证据：本页分别显示 CLI 预检与 REST Provider 可用性；既有 Loader 回执覆盖 GitLab 用户名解析、批准收据及重启不重发。未暴露原型的管理集成导航动作。 |

资源区域：`issueSample`。正式页面显示 Provider 返回的真实工单与关联，外部修改经过 prepare/confirm/cancel；不显示原型示例工单。

## Worktree 任务

页面：[ui-worktree-task](../../packages/client/ui-worktree-task/README.md)。owner 为 worktree-task-git；[storageDomain 定义](../../packages/workspace/worktree-task-git/src/spec.ts)的 worktree_tasks_git.global 保存带 revision 的 defaultDirectory/baseRef/setup/cleanup，tasks 表保存路径、分支、状态、Session 绑定及创建时 launch 快照，cleanup_receipts 表保留执行 claim 与结算。介质由 storageDomain 路由决定，不属于通用 Settings 命名空间。[Controller](../../packages/api/worktree-task-controller/src/index.ts)与[页面登记](../../packages/client/ui-worktree-task/src/client/index.ts)已接通 settings/updateSettings/review 和显式生命周期动作，保存要求匹配 expectedRevision；可选组合未默认挂载，页面仍限本机连接。以下为源码状态，生成声明、类型与运行验收尚未通过。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `worktree.baseBranch` | 默认基准分支 | 已接入，运行证据见验收记录：[默认值表单](../../packages/client/ui-worktree-task/src/client/WorktreeDefaultsForm.tsx)保存 global.baseRef，初始 HEAD；[create](../../packages/workspace/worktree-task-git/src/index.ts)优先使用本次 request.baseRef，再取持久默认值并解析为 commit，写入任务 baseRef/baseHead。本次创建留空使用默认值；不修改旧任务、不自动 fetch。revision 冲突保留草稿，显式重新读取后再保存。 |
| `worktree.directory` | 工作树目录 | 已接入，运行证据见验收记录：表单保存 global.defaultDirectory，初始空串；[create/checkoutParent](../../packages/workspace/worktree-task-git/src/index.ts)在 Provider managedRoot 下选择相对子目录并追加任务 UUID，受管根由部署配置拥有。默认目录拒绝绝对路径、父级跳转及链接路径；保存不迁移旧 checkout，sourcePath 仍是源仓库路径。基线子目录、重新激活祖先目录和其他任务预留根的重叠有对应源码检查及回归，Provider 测试结果见验收记录。 |
| `worktree.branchNaming` | 分支命名 | 固定规则、未暴露独立偏好：[resolveCreateBranch](../../packages/workspace/worktree-task-git/src/index.ts)创建时使用 `dsh/task/<UUID>` 后缀，可叠加 Git 设置中的前缀；任务 name 只存记录，不参与命名。没有模板、按标题或 AI 命名消费者；既有分支不随设置改名。 |
| `worktree.git` | 分支前缀 | 原型导航动作未暴露：[页面登记](../../packages/client/ui-worktree-task/src/client/index.ts)没有前往 Git 设置的回调。实际创建读取 git-source-control.branchPrefix/branchPrefixCustom，由 Git 设置页读写；[resolveCreateBranch](../../packages/workspace/worktree-task-git/src/index.ts)解析 none/custom/git-username，用户名只取仓库本地 github.user/user.username，并校验分支名。本页不保存第二份前缀。 |
| `worktree.setup` | 初始化命令 | 已接入，运行证据见验收记录：表单分开编辑 executable 与逐项 argv，global.setup 保存程序或 null；创建时解析并捕获到 launch.setup。[create/runHook/command](../../packages/workspace/worktree-task-git/src/index.ts)在 checkout 创建后、任务发布前执行，约束超时/逐流输出并等待进程树退出。已结算失败回滚 checkout 与分支，退出未知时保留；外部副作用不可回滚。保存和 activate 不执行 setup。 |
| `worktree.cleanup` | 清理命令 | 已接入，运行证据见验收记录：表单保存 global.cleanup，创建时解析并捕获到 launch.cleanup。显式 archive/delete 在回收前执行，hibernate/容量回收/重启不执行；先持久化 running claim，成功后保存收据。成功不重复执行，已结算失败保留 checkout 并允许显式重试，未知退出/成功收据写入失败阻止重跑；失败与未结算任务不参与自动回收。收据跨任务删除保留，任意外部效果不承诺恰好一次。 |
| `worktree.afterComplete` | 完成任务后 | 未支持、未暴露自动策略：没有完成后保留/休眠/删除偏好或完成事件消费者。[Provider 生命周期](../../packages/workspace/worktree-task-git/src/index.ts)提供显式休眠、归档和安全删除；绑定任意 Session 时拒绝这些操作，未合并分支保留为已归档记录。容量回收与启动恢复不等于任务完成后自动清理。 |

资源区域：`tasks`。[正式页面](../../packages/client/ui-worktree-task/src/client/WorktreeTaskSection.tsx)显示真实任务、分支、路径和绑定 Session，支持创建、刷新、激活及确认后休眠/归档/删除。[审查面板](../../packages/client/ui-worktree-task/src/client/WorktreeReviewPanel.tsx)显示有界 tracked patch、未跟踪文件名、捕获的程序和清理收据；不读取未跟踪内容、不激活任务、不执行程序。页面/Controller/Provider 回归及[真实 Web 场景](../../apps/web/tests/settings-worktree-tasks.e2e.ts)已有源码，尚无本轮运行回执；原型种子数据不移植。

## 工作区隔离

页面：[ui-workspace-isolation](../../packages/client/ui-workspace-isolation/README.md)。owner 为 workspace-isolation-git；[storageDomain 定义](../../packages/workspace/workspace-isolation-git/src/spec.ts)在 workspace_isolation_git.leases 中按 Session id 保存租约、路径、分支及 active/hibernated 状态，介质由部署的 storageDomain 路由决定。[页面登记](../../packages/client/ui-workspace-isolation/src/client/index.ts)仅在本机连接注入 workspaceIsolation Remote 的租约操作，不绑定 Settings 偏好；[Controller](../../packages/api/workspace-isolation-controller/src/index.ts)向 Provider 读写真实租约，未挂载时返回 unavailable。以下区分每次执行请求、部署配置、固定行为与未支持能力，仅为源码审计。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `isolation.mode` | 隔离方式 | 请求参数已有、默认偏好未支持：页面无隔离方式读写；[Session create](../../packages/api/session-controller/src/commands.ts)仅在本次 request.isolate 为真时调用 ensure 并将 checkoutPath 交给 Session，缺少 Provider 时拒绝，与 taskId 互斥。该请求不保存全局模式，也不改变既有 Session。 |
| `isolation.execution` | 执行环境 | 固定当前 Host 行为、未暴露选择器：[Git Provider](../../packages/workspace/workspace-isolation-git/src/index.ts)使用本机文件系统和当前 subprocess 服务创建 worktree；租约/请求没有远端目标、容器或 VM 路由字段。本页没有执行环境偏好、写入或切换消费者。 |
| `isolation.sharedDependencies` | 复用依赖缓存 | 未支持、未暴露：[Git Provider](../../packages/workspace/workspace-isolation-git/src/index.ts)只管理 Git checkout，不保存依赖缓存策略，也无复制、链接或挂载 node_modules/依赖缓存的消费者。Git worktree 共享仓库数据不代表复用依赖目录。 |
| `isolation.protectMain` | 保护主工作区 | 固定部分行为、没有保护开关：[Session create](../../packages/api/session-controller/src/commands.ts)把 cwd 指向独立 checkout；[Git Provider](../../packages/workspace/workspace-isolation-git/src/index.ts)在创建前拒绝脏源仓库，整合前要求源目录干净且仍在记录的基准分支。显式 merge/cherryPick 会写回源分支；没有把主工作区设为只读的偏好或执行器，worktree 本身不提供文件权限隔离。 |
| `isolation.maxActive` | 同时活跃的工作区 | 部署配置已有、页面未暴露偏好：[Provider Config/makeCapacity](../../packages/workspace/workspace-isolation-git/src/index.ts)读取 maxActiveCheckouts，默认 4、须为正整数；创建/重新激活需要容量时，按 updatedAt 回收最旧且无 Agent/无 reservation 的活动 checkout，全部在用则返回 CAPACITY。值来自插件配置，不写 leases 或 Settings；限制的是物化 checkout 数。 |
| `isolation.idle` | 闲置工作区 | 固定回收行为、闲置时长偏好未支持：[Provider](../../packages/workspace/workspace-isolation-git/src/index.ts)支持显式 hibernate、容量不足回收，以及启动时处理无活动 Agent 的遗留 checkout；休眠在有改动时提交 checkpoint，移除 checkout 并保留分支/租约，在用租约拒绝休眠。没有按分钟/天数计时的后台清理、闲置超时存储或定时消费者。 |
| `isolation.leases` | 隔离工作区记录 | 真实列表与动作已有，不是偏好：[页面](../../packages/client/ui-workspace-isolation/src/client/WorkspaceIsolationSection.tsx)经 Remote list 读取 leases，提供刷新、激活、休眠、检查、差异、补丁导出、合并、cherry-pick、拆除及孤儿回收；写操作由 Provider 更新持久记录。合并/cherry-pick/拆除/回收要求界面确认，拆除仅删除已安全整合的分支；没有原型租约种子、任意删除路径或独立“打开记录”导航。 |

## 安全研究

页面：[ui-settings-security](../../packages/client/ui-settings-security/README.md)。存储/服务：assessment-scope / readiness / securityResearch Remote。[CapabilitySection](../../packages/client/ui-settings-security/src/client/CapabilitySection.tsx)展示真实 readiness、编辑授权研究范围，并在能力可用时提供 [手动报告导出](../../packages/client/ui-settings-security/src/client/SecurityReportExport.tsx)。原型运行位置、自动产物保存、目录与通用权限导航均未暴露。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `security.environment` | 默认运行位置 | 未支持、未暴露：没有研究工具默认运行位置偏好；实际授权范围与就绪状态由 assessment-scope/readiness 提供。 |
| `security.report` | 保存研究产物 | 未支持、未暴露自动保存开关：现有 SecurityReportExport 通过 securityResearch Remote 手动导出活动 Session 的 Findings，不代表自动保存报告、日志和导出文件。 |
| `security.output` | 产物目录 | 未支持、未暴露：没有研究产物默认目录或自动写入该目录的消费者。 |
| `security.permissions` | 执行权限 | 未暴露：没有前往通用默认权限的操作；本页实际编辑授权研究范围，不新增独立执行权限偏好。 |

资源区域：`securityTools`。实际能力、预设与授权范围决定就绪状态；手动导出活动 Session 的 Findings 不等于所有研究产物自动保存，也不是工具安装或增删表单。

## 浏览器

页面：[ui-settings-security](../../packages/client/ui-settings-security/src/client/index.ts)。Host 的 browser-playwright 命名空间保存七项启动偏好，SettingsScope/Remote 读取与带 revision 的 set/unset 只允许可写 Host 连接；[Provider](../../packages/browser/browser-playwright/src/index.ts)在 apply 时取值，标记 applies=restart，因此保存后须重启该 Provider。链接接管另归 dsh-better-sidebar 命名空间并由界面实时读取。以下为源码消费者核对，不表示本轮重新运行验收。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `browser.homepage` | 主页 | 已有偏好 homePage；Provider 重启后由 resolveNavigation(home) 读取，Remote open 打开对应页面。保存不改已启动实例或现有页面，也不是侧栏 iframe 的独立主页。 |
| `browser.engine` | 搜索引擎 | 已有偏好 searchEngine，允许 google/bing/duckduckgo；Provider 重启后 resolveNavigation(search) 使用对应搜索地址与 query。 |
| `browser.zoom` | 默认缩放 | 未支持、未暴露：七项 [BROWSER_FIELDS](../../packages/client/ui-settings-security/src/client/settings-fields.ts)及 Provider schema 均无缩放字段；viewportWidth/Height 是新上下文的视口尺寸，不是页面 zoom 偏好。 |
| `browser.links` | 链接打开方式 | 真实偏好：浏览器页读写 dsh-better-sidebar.browserInterceptLinks/browserInterceptHttp/browserInterceptHttps，带 revision 保存、unset 重置；[侧栏入口](../../packages/client/ui-better-sidebar/src/client/index.tsx)在点击时读取当前 prefs，决定在已启用的侧栏 tab 接管链接。[链接消费者](../../packages/client/ui-better-sidebar/src/client/link-intercept.ts)保留同源与修饰键规则；不等同于 Playwright 页面导航或全局操作系统默认浏览器。 |
| `browser.localhost` | 突出显示本地服务 | 未支持、未暴露：设置 schema/页面没有 localhost 高亮字段，链接接管只按来源、协议和目标 tab 判断，未发现对应本地服务强调消费者。 |
| `browser.persist` | 保留登录状态 | 固定持久配置行为、无开关：Provider 的 launchPersistentContext 使用配置的 storageDir 或命名 profile 子目录保存浏览器数据。是否保留某网站的登录态还受网站 cookie/会话策略影响；没有独立 persist 偏好或关闭后自动清除登录数据的消费者。 |
| `browser.profile` | 默认浏览配置 | 已有偏好 profileName、browserChannel、headless、viewportWidth/Height，与 homePage/searchEngine 共七项。Provider 重启后创建持久上下文，default 使用 storageDir，其他 profile 使用其 harness-profiles 子目录；保存不迁移或即时切换现有上下文。 |
| `browser.data` | 浏览数据 | [Browser Controller](../../packages/api/browser-controller/src/index.ts)提供当前 Provider 的 cookie 导入、页面历史、网络与文件传输操作，页面有真实控件；历史/网络只包含受限元数据，不读取其他 profile 的登录凭据，也无原型通用清除全部浏览数据动作。 |

## 元素捕获

页面：[组件](../../packages/client/ui-browser-element-capture/src/client/BrowserElementCaptureSection.tsx)与[注册入口](../../packages/client/ui-browser-element-capture/src/client/index.ts)接入 pages/select/capture/attach，入口显式等待 remote.browser，通过发起 Session scope 的 conversation 服务写入普通草稿。可选 [Browser bundle](../../packages/bundle/cinlan-browser/cordis.patch.yml)挂载页面；通用 Web 不自动启用 Browser。[Browser Controller](../../packages/api/browser-controller/src/index.ts)提供页面枚举、一次性元素选择与 PNG 捕获，经过 attachments 保存/回读校验。[真实页面验收](../../apps/web/tests/settings-element-capture.e2e.ts)已通过取消、预览解码、原 Session 草稿附件、另一草稿不变及无自动发送检查；实际生成 attached expected，最终 replay 和修正后安装产物仍按[验收记录](settings-native-acceptance-status.md)跟踪。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `capture.target` | 默认捕获目标 | 一次操作的 pageId 选择已接入 pages Remote，刷新保留仍存在的页面否则选第一项；用户看到标题与 URL。无持久默认目标设置；真实 Web 已验证页面列表与选择。 |
| `capture.screenshot` | 元素截图 | 源码已接入 selectElement/captureElement Remote，固定请求 PNG 并返回校验过的附件和 base64；没有截图内容开关。真实 Browser 截图与 Web 预览用例已通过。 |
| `capture.dom` | DOM 结构 | 未支持捕获内容偏好：BrowserElementCaptureCommand 只有 pageId/selectionId，返回值只有图片与标识；没有将 DOM 树加入该捕获结果的字段或消费。 |
| `capture.styles` | 计算样式 | 未支持、未暴露：捕获请求/响应和页面没有 CSS 样式收集选项或附加路径。浏览器其他观察能力不等于这个偏好已实现。 |
| `capture.accessibility` | 可访问性信息 | 未支持独立开关：元素选择可使用 Provider 自身的观察身份，当前捕获响应不包含可访问性树，也没有将其附加到草稿的消费者。 |
| `capture.selector` | 选择器 | 固定一次性 selectionId 身份：Host selectElement 供人工选择，captureElement 消耗同一页面的选择；设置页回调已挂接，没有 CSS 选择器生成偏好或字符串选择器输入。取消会传递 AbortSignal；实际覆盖层取消和注册生命周期测试已通过。 |
| `capture.attach` | 附加方式 | 源码已接入：预览加载成功后显式调用 attach(发起Session,结果)，通过该 Session 的 conversation.addImageDraft 接收图片。目标已删除或草稿拒收时保留预览，不改投当前 Session，不自动发送；后续发送沿用普通附件与 Session 记录流程。真实草稿交接用例已通过，没有自动发送/插入模式偏好。 |
| `capture.context` | 包含页面地址 | 未支持：页面列表可显示页面 URL，但 BrowserElementCaptureValue 仅携带 pageId/selectionId/verified/image/data，没有页面地址附加偏好或写入上下文的路径。 |
| `capture.preview` | 捕获结果预览 | 源码已接入校验图片、尺寸/字节数、目标Session、取消及失败状态；等待真实图片 onload 后启用附加。页面卸载与取消忽略迟到结果。真实 Web 预览、截图与明确附加动作已通过。 |

## 计算机控制

页面：[ComputerCapabilityBody](../../packages/client/ui-settings-security/src/client/CapabilitySection.tsx)提供 Provider 可达性、刷新检查、安装命令复制和使用说明；[登记](../../packages/client/ui-settings-security/src/client/index.ts)没有 computer SettingsScope 或保存回调。[DeviceCapabilitiesController](../../packages/api/device-capabilities-controller/src/index.ts)调用当前 Host 的 computerUse.capabilities，返回平台/Provider/支持项，permissions 固定为 unknown，不执行输入、截屏或系统授权。以下为源码核对。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `computer.enabled` | 启用计算机控制 | 未支持、未暴露偏好：能力是否存在由 Host 插件组合决定，检查调用不切换 Provider，也不授予系统权限。页面没有 enabled 写入或执行总开关消费者。 |
| `computer.display` | 默认屏幕 | 未支持、未暴露：[ComputerObserveRequest](../../packages/computer-use/computer-use/src/types.ts)按 appId/可选 windowId 定位应用窗口；窗口结果可报告 screenIndex，但没有持久默认屏幕输入或读取者。 |
| `computer.cursor` | 在截图中显示指针 | 未支持、未暴露：观察请求只有是否截图等参数，没有指针显示偏好；平台 Provider 的实际截图行为不受本设置页控制。 |
| `computer.scale` | 截图缩放 | 未支持、未暴露：ComputerScreenshot.scale 是观察结果的实际比例，不能作为默认缩放偏好；设置注册和 ComputerObserveRequest 均无缩放写入。 |
| `computer.host` | 设备所在主机 | 固定当前连接 Host，未提供目标主机选择或跳转：deviceCapabilities.check 使用该 Host 的 computerUse 服务，页面没有 executionHostId 或远端配置写入。 |

资源区域：`computerStatus`。真实检查只证明 Provider 可达及其声明能力；权限仍未知，不宣称设备输入授权已通过，没有创建/复制/删除设备表单。
## 移动设备

页面：[ui-settings-security](../../packages/client/ui-settings-security/README.md)。存储/服务：mobile-device / mobile runtime。[MobilePreferences](../../packages/client/ui-settings-security/src/client/MobilePreferences.tsx)编辑 Host 偏好；[SDK probe](../../packages/api/device-capabilities-controller/src/sdk-probes.ts)只消费 androidSdkPath 进行本机只读检测，[mobile-device.observe](../../packages/mobile-device/mobile-device/src/index.ts)消费省略设备 id 时的默认设备。没有外部 Cinlan SDK 执行环境配置或设备执行总开关。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `mobile.enabled` | 启用移动设备能力 | owner 证据：现有值只控制本设置页自动检查，正式标签已纠正；不是设备执行总开关。 |
| `mobile.sdk` | Android SDK 路径 | 源码消费者：Host SDK probe 读取 androidSdkPath 并对其 adb 执行只读 version 检查；不配置外部 Cinlan 运行时，不改变设备执行路径。 |
| `mobile.detect` | 工具链检测 | owner 证据保留 SDK/设备检测独立加载、失败、重试与取消；源码消费者现等待 adb version / xcrun simctl help 结束后清理，并应用超时、取消和输出字节界限。 |
| `mobile.preferred` | 首选设备 | 源码消费者：mobile_observe 未指定 device_id 时解析 defaultDeviceId；显式设备优先，保存的设备缺失、离线或不唯一时失败，不回退到其他设备。 |

资源区域：`devices`。展示 Provider 返回的真实设备及可用性；不提供添加演示设备或安装工具链动作。

## 设计

页面：[ui-settings-security](../../packages/client/ui-settings-security/README.md)。当前仅显示匹配插件的清单状态与静态工具指引：[页面](../../packages/client/ui-settings-security/src/client/CapabilitySection.tsx)不执行设计就绪探测或创建/导出操作，[登记](../../packages/client/ui-settings-security/src/client/index.ts)没有设计设置命名空间或输出回调。当前工作区不存在可消费这些偏好的设计产物 owner；依 P3 方案保持说明页，不保存原型值。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `design.directory` | 资源目录 | 不支持可写偏好：当前设计页未绑定设计设置命名空间，也没有读取该目录的设计产物输出 owner；不保存原型路径。 |
| `design.format` | 默认导出格式 | 不支持可写偏好：导出项仅为能力说明，没有设计导出操作或读取默认格式的输出消费者。 |
| `design.scale` | 导出倍率 | 不支持可写偏好：没有接入设计导出调用、倍率参数或运行消费者，不保存原型倍率。 |
| `design.source` | 保留可编辑源文件 | 不支持可写偏好：没有消费源文件保留策略的输出流程，不提供该策略的保存/重置。 |
| `design.manifest` | 附带资源清单 | 不支持可写偏好：没有附带资源清单的生成/打包输出消费者，不提供该偏好开关。 |
| `design.tools` | 设计工具清单 | owner 证据：显示实际已挂载能力和只读工具指引；不是伪造安装动作。 |
| `design.plugins` | 扩展来源 | owner 证据：来源依实际插件清单；新导出格式/目录策略尚无输出消费者。 |

## 插件

页面：[ui-settings-plugins](../../packages/client/ui-settings-plugins/README.md)。 存储/服务：插件命名空间 / pluginInventory。现有配置卡和 Host/预设只读清单；安装事务属于桌面插件管理。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `plugins.config` | 插件配置 | 已验证：命名空间配置卡，复杂配置走真实文档入口。 |
| `plugins.future` | 安装与生命周期 | 复用桌面既有插件事务；普通 Web 不能显示假安装/开关。 |

资源区域：`plugins`。列表、详情、创建/复制/删除表单以真实 owner 返回的对象和操作为准；原型种子数据不得移植。

## MCP 服务

页面：[ui-settings-mcp](../../packages/client/ui-settings-mcp/README.md)。服务：mcp-client/registry、mcp-management、mcp-controller。当前 profile 根连接的保存记录、凭据引用、实际连接状态、Tools 与重连已有源码路径和 owner 回执；本次只定位消费者，不重跑回执。外部根组合条目只读，Agent 作用域连接由其组合管理。[McpForm](../../packages/client/ui-settings-mcp/src/client/McpForm.tsx)不编辑超时与重连覆盖；[mcp-management](../../packages/mcp/mcp-management/src/index.ts)保留并传给现有桥接。保存成功与连接就绪分开显示，整批 Web/Electron 验收 PENDING。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `mcp.showSource` | 显示工具来源 | 固定展示、未暴露开关：管理页显示服务器、Tools 和实际 owner；没有控制工具名称旁来源显示的偏好。 |
| `mcp.timeout` | 工具请求超时 | 源码消费者：保存记录的 toolCallTimeoutMs 经 mcp-management 传入现有 tools/call 超时；表单只保留已有覆盖，不提供编辑控件，缺省使用桥接默认值。 |
| `mcp.preset` | 分配给 Agent | 未暴露：没有按 Agent 分配或前往预设的操作；管理记录属于当前 profile 的根连接。Agent 作用域连接由各自组合管理，不属于本页分配范围。 |

资源区域：`mcp`。真实管理动作包括保存、启用/停用、移除、重连与 tools/list 刷新；刷新不调用工具或启动禁用服务器。原型服务种子数据不移植，也不提供按 Agent 分配动作。

## 自动化

页面：[ui-settings-automation](../../packages/client/ui-settings-automation/README.md)；服务：automation-controller、automation。现有源码与 owner 回执覆盖 profile 状态目录、排他 SQLite 所有权及先保存 occurrence claim 再启动公开 Agent。[调度消费者](../../packages/automation/automation/src/index.ts)仅在当前 Host 运行时执行 UTC 小时/日/周计划；新建禁用、手动请求去重、重启不补跑、不自动重放，不确定运行暂停复核。完成状态仅表示对应轮次的已记录结果，不证明业务目标成功；没有 OS daemon。schedule 保持会话内提醒职责，整批 Web/Electron 验收 PENDING。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `automation.timezone` | 默认时区 | 固定行为：仅支持明确 UTC 的每小时/每天/每周计划与时间展示，没有本机时区或任意时区偏好。 |
| `automation.overlap` | 上一次任务仍在运行 | 固定行为：同计划已有活动运行时，定时触发记录 skipped-overlap，手动触发返回 busy；没有排队选项。 |
| `automation.notify` | 运行完成后通知 | 未支持、未暴露：没有自动化完成通知偏好或专属通知消费者；一般 Session 通知不证明此原型开关已实现。 |
| `automation.history` | 运行记录保留 | 未支持、未暴露保留期偏好：真实运行日志分页查询，删除任务后仍保留已有记录；没有 7/30/90 天清理选项。 |

资源区域：`automations`。实际任务支持禁用草稿、编辑、明确启用/暂停、运行一次、取消、删除和分页日志；使用已有工作区、预设、模型与权限选择。任务暂停不停止活动运行，删除任务保留日志。

## 执行主机

页面：[ui-settings-hosts](../../packages/client/ui-settings-hosts/README.md)。服务：execution-host-targets / execution-host-controller；current() 保持当前进程来源记录。[HostsSection](../../packages/client/ui-settings-hosts/src/client/HostsSection.tsx)管理带版本的标签与已有 OpenSSH 别名，提供明确连接/断开操作，连接就绪后可检查 worker 导出的根内目录；认证与主机密钥信任沿用 Host 的现有 SSH 配置。源码与 owner 回执仅支持保存目标、握手和有界只读检查，不提供远程 Session/Workspace 执行路由；整批 Web/Electron 验收 PENDING。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `hosts.default` | 默认执行主机 | 明确不可用：页面显示不可用说明，不保存偏好；SSH 连接与检查不提供新 Session 的远程执行路由。 |
| `hosts.confirmSwitch` | 切换主机时提示 | 明确不可用：页面显示不可用说明，不保存偏好；没有 Session/Workspace 主机切换流程可消费此开关。 |
| `hosts.isolation` | 任务隔离 | 明确不可用：页面显示不可用说明，不保存隔离默认值，也未暴露原型的隔离页导航动作。 |

资源区域：`hosts`。实际显示当前 Host 来源、持久 SSH 目标与连接/检查状态；保存目标不代表已连接，连接就绪不代表新任务会在远端执行。

## 终端

页面：[ui-settings-terminal](../../packages/client/ui-settings-terminal/README.md)。存储为 dsh-better-sidebar，消费为 sidebar PtyManager/AgentPtyRegistry 与 xterm；不改变核心工具 Shell。[共享 Remote 传输](../../packages/api/sidebar-terminal-controller/src/client/terminal-client.ts)归 API Controller Client 编译面，UI 通过注入工厂获得普通回调。只读 inspectUi 与带 processId 校验的 closeUi 已接入真实关闭钩子；原始终端 WebSocket 和未校验的 pty.close 路径已移除。owner 证据覆盖原生进程、Controller、Client 流、真实 Loader 工厂及 UI 关闭路径，工厂卸载等待各 scope 拆除；默认通道已完整传输含 1048576 个 NUL 字符的保留记录，并通过真实 ACK、退出和拆除检查；整批 Web/Electron 验收 PENDING。Desktop 已恢复唯一侧栏组合，实际传输可用性仍以最终产物连接为准。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `terminal.shell` | 默认 Shell | owner 证据：terminalShell/terminalShellArgs 在下一次 UI 或 Agent sidebar PTY 创建时读取；参数按空白分隔，不支持带空格的引号参数；不改变核心 Shell 工具。最终 Web/Electron 产物验收待完成。 |
| `terminal.directory` | 启动目录 | 固定行为、没有通用偏好：主窗口和 Agent 终端使用 Session cwd；新浮动终端可消费工作区内的已存在目录，已运行进程保留原目录。最终 Web/Electron 产物验收待完成。 |
| `terminal.scrollback` | 回滚行数 | owner 证据：terminalScrollback（默认4000，0–100000）实时更新当前 xterm。 |
| `terminal.bell` | 终端铃声通知 | 未支持、未暴露：没有 xterm/原始 PTY BEL 通知开关或消费者；通知页 terminalBell 仅处理新追加 tool/result 中的 BEL。 |
| `terminal.font` | 字体 | owner 证据：terminalFontFamily 实时更新当前 xterm。 |
| `terminal.fontSize` | 字号 | owner 证据：terminalFontSize（9–32）实时更新当前 xterm。 |
| `terminal.cursor` | 光标样式 | owner 证据：terminalCursorStyle（block/underline/bar）与 terminalCursorBlink 实时更新当前 xterm。 |
| `terminal.reconnect` | 重新连接时恢复终端 | 固定行为、没有恢复开关：既有 owner 证据覆盖同一存活 PTY 重新附加保持 PID；Host 重启无法恢复已死亡进程。显式关闭已接入带原生 processId 校验的 closeUi，最终产物验收待完成。 |
| `terminal.confirmClose` | 关闭运行中的终端前确认 | 未支持、未暴露：没有运行命令识别后的确认偏好或提示；closeUi 负责显式关闭匹配的原生进程，不等于此确认开关。 |

资源区域：`terminal`。设置页只编辑七项启动/显示偏好；真实 PTY 创建、附加和关闭属于侧边栏终端。原型演示输出不移植，不把存活进程重附加称为 Host 重启恢复。

## 使用统计

页面：[ui-settings-usage](../../packages/client/ui-settings-usage/README.md)。服务：usage-query + usage-controller，读取实际 Session 日志，以 token-meter 已有规则计算已完成轮次、重试与自身 fork 后缀。既有 owner 回执记录 20 个查询、15 个真实 API、39 个 UI 用例及 3 个包的类型、lint、文档通过；本次未重跑，整批 Web/Electron 验收 PENDING。[UsageSection](../../packages/client/ui-settings-usage/src/client/UsageSection.tsx)只提供 UTC 查询过滤与当前报告导出；既有冷日志准备只能协作取消，不承诺解码前硬上限。

| 原型字段 | 界面名称 | 真实消费者与实施状态 |
|---|---|---|
| `usage.period` | 统计周期 | owner 证据：明确 UTC 的 from 包含/to 不包含范围，统计真实已完成轮次；部分结果明确标识。 |
| `usage.model` | 模型 | owner 证据：精确 provider/model 过滤，自身 fork 后缀、重试及无法归属轮次分别处理。 |
| `usage.track` | 记录用量 | 未支持、未暴露：统计读取已有 Session 日志；没有独立用量记录开关，不改变 Session 记录策略。 |
| `usage.retention` | 用量记录保留 | 未支持、未暴露：没有统计保留期或清理设置；查询范围不改变底层 Session 日志保留。 |
| `usage.export` | 导出统计 | owner 证据：CSV 精确导出当前展示结果并转义公式；未知值与零分开，过期查询不覆盖新结果。 |

资源区域：`usage`。实际报告包含已知用量、未知/不完整值、来源与覆盖范围；CSV 导出当前展示结果。没有统计资源增删表单，也没有独立记录或保留期配置。

## 写入和验收约束

- 自动保存必须确认真实结果；SettingsScope.mutate 通过统一串行队列返回 Host 是否接受（boolean），拒绝后恢复读取、传输失败仍拒绝。set/unset 保持 void 便利接口；需要成功反馈的表单使用 mutate 结果并确认 raw/effective，重置确认覆盖字段消失。
- 索引只包含本地化标签和静态说明；不包含值、账户、路径、令牌、录音设备标识或用户模型 ID。
- 正常写入、拒绝/冲突、恢复继承、刷新/重连、未加载能力分别验证；每个新增运行消费都验证动作结果，而不只检查配置文件。
- Git 的六项现有偏好还包括原型未列出的 sourceControlGroupOrder 和 enableGitHubAttribution；源码分别由 sidebar-git.status / prepareCommit 读取，GitView 展示分组顺序和含 attribution 的待确认提交说明。共享 Remote 与 Fetch 已调用同一 Git owner，真实 Controller/Session/Hook 组合已通过；整包验收待完成。attribution 不等于 signoff，refreshLocalBaseRefOnWorktreeCreate 继续保存、可重置但禁用。
