# RC.2 选择性集成与手机产品方案

[English](plan.md) | 中文

## 1. 范围与固定来源

本方案将官方 dsh-v0.1.7-rc.2 行为与 Cinlan 独立的手机、账号和模型工作拆开。方案不授权整体合并上游发行树。

官方 RC.2 tag commit：477b4f420553e8a52c2fbccc464d7561b239c443。

官方 RC.1 到 RC.2 对比：<https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-rc.1...dsh-v0.1.7-rc.2>。

当前 Cinlan main：60a35aa730d30186b5d4d57b8eeb82a4d946229f。Orca reference：9c192525aaca8ab82ac751999b863ece07138676。Orca 工作树有脏修改，只能作为参考资料。

2026-09-20 三方报告见 ../../../reports/migration/official-local-orca-differences-2026-09-20.md。该报告属于更早的本地／Orca 背景，不是 RC.2 证据。

RC.2 发布说明没有手机伴侣或 Relay 项目。Mobile Companion、手机直连和云 Relay 属于 Cinlan 独立产品范围，不标记为官方 RC.2 对齐。

以下状态表根据当前源码和 dirty worktree 判断语义等效性。当前分支以 dsh-v0.1.7-alpha.2 为基础，RC.2 不是其祖先；等效行为来自预先存在或 Cinlan 自有的实现，不继承官方 RC.2 提交。

直接请求的 RC.2 行仅包括 Desktop 安装包启动、API Key 自动填入、账号模型编辑、Windows 更新提示与窗口前置、账号／API Key 生命周期和模型切换等待反馈。额度与余额属于相邻待决策项；其余 RC.2 行作为直接范围之外的 backlog 保留。手机配对和 Relay 没有对应的 RC.2 行。

## 2. 不可合并的产品边界

| 能力 | 当前或计划属主 | 边界 |
|---|---|---|
| 手机伴侣 | 新建 Cinlan 手机客户端与 remote-access 协议扩展 | 扫描配对 offer 并控制授权 Desktop Session。不是 Mobile Device ADB。 |
| 手机直连 | remote-access 与 ui-settings-pairing | 手机直接访问 Desktop HTTPS 监听器。不经过云 Relay。 |
| 手机 Relay | 新建 Cinlan Relay 服务与手机传输 | Desktop 仍是执行主机。Relay 转发加密帧，不执行 Harness 工具。 |
| Mobile Device | mobile-device、mobile-device-adb、cinlan-mobile-device | Agent 通过 ADB 控制 Android 设备。不是手机伴侣或 Session 网关。 |
| Sub2API 账号 | api/account-controller 与 ui-settings-account，使用 credentials 和 authorization | 登录和 token 刷新属于账号状态，不是模型提供方，也不得进入 Session 日志。 |
| 模型路由 | llm-pi-ai 与 Models 设置 | 显式提供方路由负责模型和协议配置。Cinlan 账户登录不会创建默认路由。 |
| DeepSeek | llm-deepseek 与 Models 设置 | 独立可选提供方和模型路由。 |

## 3. 手机配对约定

Orca 的 local-only 配对只作为手机无需云登录、直接连接 Desktop 的行为参考；其 automatic 或 Anywhere 模式不是 Cinlan wire protocol 的依据。

在服务端点、分配与 entitlement 属主、凭据签发、加密 framing、过期、撤销、重连和关闭约定得到验证前，Relay 保持延期。本方案不选定 Relay QR 字段、frame 或回退行为。

直连模式已作为可选的本地 HTTPS provider 实现，具有明确的邀请、授权、过期、撤销和失败状态。其二维码只在 URL fragment 中携带邀请 ID 和一次性验证码；手机在认证交换前清除 fragment。测试覆盖无需登录的本地运行、证书和 origin 检查、授权范围、fragment 处理、撤销、恢复和清理。

## 4. 账号与模型实现

| 工作项 | 精确属主方向 | 状态与验收 |
|---|---|---|
| Sub2API 登录 | api/account-controller 和 ui-settings-account 使用 credentials 与 authorization；Provider 路由消费当前账号凭据 | 已实现。Account Settings 可发起、回答、取消并观察固定的 Cinlan 邮箱／密码流程，并按需请求 TOTP；流程复用活动密钥，限制补偿清理，并且不把账户 token 写入设置、React 状态或 Session 日志。 |
| CinlanAPI 默认路由 | llm-pi-ai 与 ui-settings-models | 延期。账户流程不会创建模型路由；在添加 CinlanAPI 路由或默认值前，仍需要经过验证的公开模型目录、base URL 和凭据契约。 |
| DeepSeek 选项 | llm-deepseek 与 ui-settings-models | 已实现。原生 `deepseek-official` / `deepseek-flash` 仍可选择，并且与任何 CinlanAPI 路由独立。 |
| 账号资费与 API Key 任务 | 待确定的 Session／任务生命周期属主；ui-model-selection 只负责选择，不负责取消任务 | 待决策。先定义身份、模型入口、退出取消、过期恢复和额度属主。 |

## 5. Settings UI 约定

参考 Orca 的分组和任务流程，不复制其单体应用组件结构。Cinlan 保持 feature-owned Settings 注册和 locale-owned 文案。

Account 管理 Sub2API 状态和本地凭据删除；签发方撤销仍由外部负责。Models 管理显式配置的 LLM 路由和 DeepSeek 路由。Phone Pairing 管理直连或 Relay、QR 生命周期、设备授权和撤销。Mobile Device 管理 ADB 状态与设备操作。

每行显示来源、状态、失败原因和下一步。凭据值不得进入 React props、日志、settings.yaml、模型可见文本或 Session 事件。

## 6. RC.2 新增功能

| 发布项目 | 决定 | 属主与验收 | 状态 |
|---|---|---|---|
| 定时提醒与运行记录 | 补全已采纳行为 | 持久化定义、重叠处理、取消、历史和默认关闭组合已存在；补充每分钟重复和完整管理能力。 | 部分实现 |
| 可恢复的 Desktop 首次引导 | 采纳 | 当前引导只覆盖提供方／模型设置；补充持久化 Desktop 首次步骤、恢复、跳过和账号／模型属主。 | 计划中 |
| 快捷键查看、搜索、修改、恢复和侧栏显示 | 补全已采纳行为 | 快捷键查看、搜索、编辑、重置、冲突和平台绑定已存在；侧栏提示仍未投影用户覆盖值。 | 部分实现 |
| 进行中对话使用新工具 | 保留当前等效实现 | 工具变化时，agent loop 会重新组装工具 schema，并在日志中重新建立模型输入基线；保留请求重建覆盖。 | 等效实现（非 RC.2 移植） |
| Auto review 拒绝后的人工继续 | 延后稳定晋级决策 | 原型会在审查拒绝时直接拒绝；稳定属主必须定义人工继续，并区分拒绝、执行失败和审查失败。 | 待决策 |
| Desktop 窗口关闭后任务继续并提示退出 | 设计生命周期后采纳 | 非 macOS 窗口关闭会请求退出；补充后台执行和任务感知退出确认，并覆盖重开与清理。 | 计划中 |

## 7. RC.2 修复项

| 发布项目 | 决定 | 属主与验收 | 状态 |
|---|---|---|---|
| Windows 文件菜单图标与关联应用打开 | 补全已采纳行为 | 已支持操作系统默认打开；补充关联应用发现、菜单图标和回退覆盖。 | 部分实现 |
| Desktop 安装包启动失败 | 在现有打包流水线中采纳 | Windows 发布产物只使用 NSIS，在解压前检查运行中的应用，并通过本地化文案拒绝继续；聚焦打包测试固定了早期检查和显式 unsigned 验证路径。 | 选择性实现 |
| 插件详情／设置资料与启动诊断 | 保留当前等效实现 | 当前 manifest 解析、插件清单和启动诊断通过 app-boot 架构覆盖插件缺失与失败。 | 等效实现（非 RC.2 移植） |
| 凭据自动填入 API Key 字段 | 采纳并做安全审查 | API Key 输入使用 opaque password-field 语义、`autocomplete=new-password`，并关闭自动大写和拼写检查，已有聚焦属性覆盖。 | 选择性实现 |
| 本地 Markdown 图片预览和放大 | 保留当前等效实现 | 对话 Markdown 会解析受限本地图片，并在现有放大流程中打开受支持图片，已有客户端和 Web 覆盖。 | 等效实现（非 RC.2 移植） |
| GitHub 插件安装回退 | 采纳 | 当前安装仅支持注册表；补充镜像身份、回退和备用方法恢复覆盖。 | 计划中 |
| 账号模型编辑 | 补全已采纳行为 | 通用提供方／模型编辑和 Sub2API 路由已存在；账号专用模型目录和编辑行为仍不完整。 | 部分实现 |
| Desktop 内嵌 Platform 提示记忆 | 待确定属主 | 当前没有内嵌 Platform 属主；实现前先定义范围、过期、持久化和退出清理。 | 待决策 |
| 与任务身份匹配的额度提示 | 待确定属主 | 账号／任务／额度属主和资费身份仍未定义；Models 设置不得推断计费属主。 | 待决策 |
| Windows 更新提示与窗口前置 | 保留当前等效实现 | 更新器会显示重启文案、检查运行中工作、通过 Desktop 生命周期安装，并将重启后的窗口前置。 | 等效实现（非 RC.2 移植） |
| 本地化工作区文件夹显示名 | 保留当前等效实现 | 工作区路径和稳定 id 与 locale 无关；显示标题来自路径或用户显式选择。 | 等效实现（非 RC.2 移植） |
| macOS 标题栏拖动 | 保留当前等效实现 | Desktop 使用原生带边框 BrowserWindow，因此不存在自定义隐藏标题栏的拖动缺陷。 | 等效实现（非 RC.2 移植） |
| Agent 启用插件和功能的指引 | 保留当前等效实现 | plugin-manager 指引会给出准确标识符和 profile 效果；发行的 Cordis 开发 skill 负责扩展指引。 | 等效实现（非 RC.2 移植） |
| 语音输入未就绪指引 | 采纳 | 语音输入就绪前会隐藏麦克风控件；补充未就绪时前往语音设置的入口。 | 计划中 |
| 工作区内 Windows 目录链接 | 采纳 | workspace-files 会拒绝最终 symlink；补充受限 Windows 目录链接导航和路径覆盖。 | 计划中 |
| 崩溃或中断后的插件安装恢复 | 采纳 | atomic-write 超时后不会回收已退出属主的锁；为保存和安装补充已验证的失效属主接管。 | 计划中 |
| 长工具输出字符损坏 | 补全已采纳行为 | 按字节保留输出可保证 Unicode 安全，但按字符限制的工具路径仍会切分 UTF-16 字符串；覆盖所有输出保留路径。 | 部分实现 |
| 账号余额刷新较慢 | 待确定属主 | 当前没有账号余额服务或 UI 属主；将其保留为账号 UX，而不是提供方路由。 | 待决策 |
| 长对话持续无法发送 | 先验证再改 | 当前没有请求扩展大小上限或降级路径；修改共享请求行为前先复现传输限制。 | 计划中 |

## 8. RC.2 调整项

| 发布项目 | 决定 | 属主与验收 | 状态 |
|---|---|---|---|
| Plugins 页面启用 Auto review；Inspector 不再默认提供 | 采纳并决定可发布性 | 插件文案提供 Auto review，Inspector 也未默认发行，但 Auto review 仍是没有稳定发行属主的私有实验包。 | 待决策 |
| 账号与 API Key 模型入口分离；退出停止账号任务；登录过期提示 | 先确定账号任务属主 | Sub2API 凭据换取密钥已存在；持久账号入口、退出时取消任务和登录过期恢复仍不存在。 | 待决策 |
| Coding Tools 控制轨迹、代码变更和新任务模式 | 延后并拆分属主 | 当前没有统一 Coding Tools 控件；实现前先分配保存默认值、活动视图和工具卡片属主。 | 待决策 |
| 启用 time context 时默认每十分钟刷新，保留自定义间隔 | 补全已采纳行为 | 显式自定义间隔有效，但省略间隔或设为零时会在每次符合条件的尝试中注入，而不是每十分钟。 | 部分实现 |
| Web/Desktop 默认关闭定时任务和 time context | 保留当前等效实现 | 发行 Web 和 Desktop 组合不会启用 schedule 或 time context，除非 profile 显式选择。 | 等效实现（非 RC.2 移植） |
| 降低 Standard 模式固定提示 token 开销 | 用 snapshot 验证 | 工具和 system-prompt 描述仍保留较大的固定指令集；减少测量所得 snapshot 时必须保留必需指引。 | 计划中 |

## 9. RC.2 优化项

| 发布项目 | 决定 | 属主方向与证据 | 状态 |
|---|---|---|---|
| 归档筛选与隐藏无归档工作区 | 补全已采纳行为 | 普通树会隐藏已归档会话；补充全部／活动／归档筛选和无归档内容的工作区处理。 | 部分实现 |
| 工具、预览和差异的语法高亮一致 | 补全已采纳行为 | 共享 Shiki 高亮已覆盖常用代码块，但工具、预览和差异的语言属主尚未统一。 | 部分实现 |
| 文档预览加载、间距与浅色背景 | 补全已采纳行为 | Cinlan Office/PDF 预览具有本地化加载和错误状态；RC.2 占位、间距和浅色背景对齐仍不完整。 | 部分实现 |
| 圆角、菜单、悬停、紧凑差异和焦点提示统一 | 补全已采纳行为 | 共享 token 和键盘 focus-visible 行为已存在；完整的跨功能视觉和紧凑差异集合仍不完整。 | 部分实现 |
| 模型切换等待反馈 | 补全已采纳行为 | 选择期间固定宽度的 trigger 区域显示进行中指示和本地化 live status，并禁用冲突控件；聚焦测试覆盖等待成功和失败恢复。 | 选择性实现 |
| 每次启动只提示一次不兼容插件 | 采纳 | 当前没有每次启动一次的 skipped-bundle 通知生命周期；补充去重和生命周期覆盖。 | 计划中 |
| 官方源／镜像标签和重复选项合并 | 采纳 | 当前 manager 没有镜像来源模型或重复来源选项合并。 | 计划中 |
| 本地化审批说明和模型语言指引 | 补全已采纳行为 | 审批界面文案已本地化，但说明文本没有用户语言指引或等效的可见文案 snapshot。 | 部分实现 |
| 折叠工具卡片直接打开抓取 URL | 采纳 | 折叠状态下的抓取摘要是纯文本；外部链接仅在展开后可用。 | 计划中 |
| 插件管理和设置统一使用中文“子智能体”术语 | 在直接范围之外采纳 | 尚未实现：受影响的中文插件和设置文案仍使用“子代理”；统一替换为“子智能体”。 | 计划中 |

## 10. 交付与清理

1. 固定发布矩阵、上游 commit、当前 main commit 和 Orca reference commit。
2. 保持可达的 Sub2API Account 流程不泄露秘密，并验证其 provider 凭据交接。
3. 保留显式 OpenAI Responses adapter 覆盖；只在 base URL、凭据属主和模型目录得到验证后添加 CinlanAPI 路由。
4. 验证手机直连二维码配对；在传输、授权和 entitlement 契约得到验证前继续延期 Relay。
5. 保持 Account、Models、Phone Pairing 和 Mobile Device 为独立的 feature-owned Settings 分区。
6. 以独立属主变更移植 RC.2 行；每项非机械行为同步更新 README、JSDoc、Agent Note、locale pair 和 snapshot。
7. 运行 focused tests、严格类型检查、Loader/profile 组合、无密钥回放、clean build、package-set 检查、每个变更 pair 的 verify-translation-pairing --write、test:docs、doc-sync 和 Windows x64 打包。未经请求不运行 test:e2e。

本方案不删除已注册或用户所有的 worktree。集成流程创建的空临时目录和过期的生成目标输出可以移除。任何 worktree 移除都必须通过提交可达性、独有源码／测试清单、证据保留和用户文件审查，并获得属主明确授权。dirty 的 merge-final、overlay-check、rebase-check 和 Orca 目录不是删除候选。

## 11. 待决策

- 生产 Sub2API base URL 和支持的登录响应变体。
- CinlanAPI 生产 base URL、凭据来源和初始模型目录。
- Relay 是默认启用还是显式选装。
- 配对后手机默认允许哪些操作。
- Auto review、Inspector、账号任务生命周期、额度和 Coding Tools 的稳定属主及可发布性。
- 清单门禁通过后允许删除哪些干净 worktree。
