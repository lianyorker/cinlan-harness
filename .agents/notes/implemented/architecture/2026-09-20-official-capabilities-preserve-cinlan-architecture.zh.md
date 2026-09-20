# Agent Note: 集成官方能力时保留 Cinlan 架构

Status: implemented

[English](2026-09-20-official-capabilities-preserve-cinlan-architecture.md) | 中文

## 问题

官方 0.1.6-alpha.2 的功能涉及运行时服务、模型能力、文件交付与应用界面。只对齐包版本，或用相邻的本地功能代替，会留下可观察的缺口。整体替换应用组合还会改变 Cinlan 的 Settings、侧栏消费方和 Desktop 包所有权，无法独立解决这些缺口。

## 决策

通过当前属主集成能力，分别记录源码支持、运行时验证与成品验收。[功能核对报告](../../../../reports/migration/official-0.1.6-alpha.2-feature-parity.md)拥有发行清单、已执行证据、平台限制与待验证项。包版本标识集成目标，不能证明提供方已配置，也不能证明安装包包含当前源码。

[产品所有权决策](2026-09-19-selective-upstream-integration-preserves-product-ownership.zh.md)继续拥有 Settings 持久化、侧栏消费方、模型协议选择和本地委派默认值。[功能导航决策](2026-09-19-feature-settings-navigation.zh.md)保留独立功能入口及原生保存、重置属主。Linear.app 仍属于未来设计背景；本次集成不采用其视觉设计。

### 侧栏与 Desktop 所有权

Office 预览通过既有文件预览器 API 和已授权的 [Office 转换器](../../../../packages/document/office-to-pdf/README.zh.md)注册。计划、改动和已声明交付物使用既有 better-sidebar API。终端 Shell 选择器扩展现有的 Session 所有 PTY 服务：每个标签保存自己的启动选择，不修改 Settings；重连复用仍存活的进程。Host 重启不能恢复已退出的进程或其中运行的命令。这些集成保留扩展 API，避免同一面板或进程出现竞争属主。嵌入子会话标签使用普通 Conversation 渲染器，保留 Session 引用而不改变主选择；关闭标签释放对应引用。文件预览区分可见布局 Session 与拥有 cwd、读取授权的源 Session，避免即时跨会话预览继承错误读取器。

[Session控制器](../../../../packages/api/session-controller/README.zh.md)可编辑和删除已授权冷可继续子会话的持久排队输入，无需激活Agent。[AgentLoop](../../../../packages/core/agent-loop/README.zh.md)在服务生命周期内持有标准inbox投影，并保留既有每Agent引用，使零活动Agent时仍可读取已保存队列。冷修改使用现有独占持久化写入锁及子会话自身日志后缀中的当前身份。标准中断回合恢复记录先于既有inbox splice写入；成功flush后，才以高于冷读取方已观察状态的序号发布既有inbox投影帧。这样可保持队列修改持久且可见，无需启动模型工作、引入另一事件类型或绕过子会话所有权检查。既有Remote响应、实时传输和Session格式保持不变。

Desktop 保留私有 npm 项目、分阶段包事务、恢复机制、私有 pnpm store 和[分帧管道传输](2026-08-25-electron-desktop-packaging-and-updates.zh.md)。显式 Host 适配器允许通过 profile 管理器修改配置行，包与组合修改仍由外壳拥有。缺少该适配器时，管理器拒绝 Desktop 修改。[Host 启动流程](../../../../apps/desktop-host/src/index.ts)在插件之前安装通用代理策略，并在卸载时释放；这不会配置所有传输。OTLP、模型编写的工作线程和 Electron 更新流量具有独立限制，详见核对报告。打包流程将独立发布的 `@deepseek-ai/libreoffice-kit` 识别为离线 seed 的 registry 依赖。必需的本地 dsh 与 vendored 包缺少 tarball 时仍拒绝准备；仅共享 npm scope 不能证明属于本地包。

[Connection 类型入口](../../../../packages/client/connection/README.zh.md#use-this-package)公开共享 RPC 和 Fetch 接口，不引入 Host 或 Client 任一侧的 Context 服务声明。侧栏传输 helper 通过 `/types` 导入这些接口，避免 Client 编译器仅为描述路由而引入 Host 服务。Host 与 Client 插件入口分别保留自己的服务，现有 HTTP 和 Desktop 分帧管道载体保持原有运行时行为。

### MCP 与持久交付

[MCP 资源](../../../../packages/mcp/mcp-resources/README.zh.md)增加调用方作用域内共享的列表、模板列表与读取工具，同时保留本地 v1 MCP 客户端及其托管监督器。资源列表返回一页和不透明续传游标。请求使用已初始化的连接世代，合并调用方、连接世代和生命周期取消信号。连接失败不移除已配置提供方的共享工具。纯展示转换器保留服务器归属；程序化规范结果保留二进制载荷，模型文本只描述载荷。外部提示词文本按整段设置 `interpolate: false`，避免把字面花括号当作提示词变量查询。

[既有 MCP 决策](../feature/2026-07-07-mcp-client-plugin.zh.md)继续拥有稳定工具名、传输隔离、规范输出和图像准入。仅为匹配官方 SDK 版本而替换监督器，会丢失托管所有权、凭据脱敏、重复游标保护及未确认关闭时的占用保留。资源服务扩展现有生命周期。

[present 工具](../../../../packages/deliverables/tool-present/src/index.ts)只在工具成功结算后记录已声明且存在的文件。其 `deliverables/presented` 事件要求读取方识别：不认识该事件的读取方拒绝日志。文件预览、默认应用打开及定位操作通过授权解析已记录的 Session、事件和文件坐标。交付引用打开当前源文件，不是不可变副本。新增事件支持遵循[已发布会话规则](2026-08-31-released-session-format-migrations.zh.md)，不改写已提交的 JSONL 代际。

反馈分类仍是反馈领域拥有的可选元数据。提交才追加记录，草稿编辑和关闭对话框不追加记录。分类变化参与 compare-and-swap，不改写历史，也不放宽历史读取校验。现有原生 v3 元数据支持承载这些记录，模型消息保持原语义。[持久化测试](../../../../packages/session/session-log-deepseek/tests/feedback-composition.spec.ts)覆盖真实 JSONL 重开；浏览器、SDK 和 Win32 行为需要各自验证。

### 可选提供方

[Browser Use](2026-09-12-browser-use-provider-registration.zh.md) 与 [Cua Driver](2026-09-20-cinlan-cua-driver-compatibility.zh.md)保持显式提供方选择，并要求外部浏览器、驱动、模型或操作系统条件。Auto review 要求安装集成并显式选择 Session 权限。提供方注册与 mock 测试不能证明真实桌面控制可用。[SSH](2026-09-11-posix-ssh-runtime.zh.md)要求自定义 Linux/macOS 组合及匹配的远端 helper；已保存目标元数据不会重定向文件系统、命令或 PTC 执行。Windows 端点仍不受支持。

## 曾考虑的替代方案

**把版本对齐或部分等效实现视为完整覆盖。** 插件目录条目不会激活 Office 预览器，子会话状态面板不会在父会话旁显示子会话正文，保存 SSH 别名不会挂载远端执行提供方。报告分别记录这些行为。

**用官方组合替换 Cinlan 的 Settings、侧栏或 Desktop。** 这会改变独立拥有的产品行为和包事务。新增消费方在保留这些属主的同时提供所需能力。

**默认启用所有实验性提供方。** 外部凭据、浏览器连接、桌面权限和相互竞争的提供方生命周期都需要明确配置。源码移植不能替用户满足这些前提。

## 后果

集成承担适配器与定向回归验证成本，以保留 Cinlan 产品 API 和持久数据规则。所需证据覆盖作用域资源卸载及取消、原生终端复用、已授权 Office 转换、声明文件授权、profile 修改所有权及既有 Settings 持久化。完整界面、真实外部提供方与 Windows 安装包验收在报告中属于不同证据层级。Settings、Desktop、MCP、Browser、Cua、SSH 和归档会话笔记仍保留独立依据；本决策没有完全取代或归档其中任何一份。
