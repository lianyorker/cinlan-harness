# Agent Note: 原生设置保留功能与操作所有权

Status: implemented

[English](2026-09-17-native-settings-runtime-consumers.md) | 中文

## Problem

为独立插件应用统一设置布局可能暗示运行时并不支持的行为。原型默认值可能覆盖现有偏好，成功结束的 Promise 可能掩盖写入拒绝，而依赖 HTTP 的操作可能在没有 HTTP 服务器的 Desktop Host 中看似可用。资源列表、能力指引和持久偏好也需要不同操作。

## Decision

设置外壳拥有尺寸、分组与导航。各功能拥有持久字段、默认值、运行消费者、可用性与操作生命周期。原生设置行使用语义主题 token 和本地化公开文案。尚不支持的原型字段明确记为缺口，不成为没有消费者的可写值。[元数据决策](2026-09-17-settings-navigation-metadata.zh.md) 拥有搜索与锚点；[Host 偏好决策](../bug-fix/2026-08-06-host-backed-web-preferences.zh.md) 拥有共享镜像与写入队列。两者都不被取代。

报告已保存状态的表单必须收到 Host 接受，并确认目标生效值与原始覆盖。重置移除所属覆盖字段。`SettingsScope.mutate` 在保留原有 revision 栅栏、串行队列、恢复与拆除等待的同时返回真实接受结果。拒绝后重新加载到相同值仍是拒绝。特定设备的麦克风选择与音频字节归浏览器所有，不因视觉原型而移入 Host schema。

语音状态、模型操作与转写归与 Provider 无关的 `voice` 执行面。经过身份验证的 Controller 与可选回环 HTTP 适配器共用请求解析和 Provider 操作。Sherpa Provider 在没有 `webServer` 时仍激活；Desktop 使用已有 Connection 通道。UI 组件从插件登记处接收普通回调。听写归发起 Session 所有，追加到其最新草稿，拆除时中止等待调用，并且从不提交草稿。[语音能力决策](../feature/2026-08-30-local-voice-dictation-vertical-slice.zh.md) 保留模型、原生引擎与缓存所有权；此传输扩展不替代这些决策。

免打扰时段是由 Host 保存、在每个接收通知的浏览器本机时间中解释的偏好。自动完成通知和终端响铃通知（包括声音）在每日半开区间内被抑制；起止时间相同表示全天静默。显式测试操作绕过前台和定时抑制。表单通过一次带 revision 检查的 mutation 同时保存两个端点，避免其他客户端的编辑产生混合时段；重置会移除所有所属覆盖。

GUI 链接拦截仍由 `dsh-better-sidebar` 命名空间拥有。Browser 页面通过该 scope 只编辑三个路由开关，不依赖 Browser Provider 是否就绪。表单保留首次编辑的 revision，重置只移除这三个覆盖；浏览器启动偏好保留独立的所有者和重启要求。

元素捕获使用经过身份验证的 Browser controller 和现有会话草稿注册表。捕获操作在选择和预览期间保留发起 Session 的 id；附加时重新解析该 Session，并拒绝已移除或正忙的目标。用户先检查已解码图片再附加，附加从不提交消息。可变的当前 Session 指针可能让迟到的捕获进入错误草稿。提交时的模型输入和图片持久化仍归普通会话流程所有。

HTTP Connection bridge 在等待 handler 之后和流写入前后检查响应关闭。稍后返回的未读响应体会被取消；即使关闭先于监听器注册，背压等待也会结束；关闭后不再写入其他 chunk 或结束响应。取消因此允许操作及其拆除完成。

Launcher 在 Loader 求值配置前提供实际 `dshProfileName`。CLI 使用已加载名称；Electron 在暂存安装之间保留 `desktop` 标识。可变状态的所有者使用 Harness home 与显式 profile 标识，独立于可替换的安装目录。Desktop 开发通过显式开发选项允许工作区链接的 profile；打开调试器不等于此授权。

移动设备偏好的解析归 Mobile Device 服务所有。只有观察操作可以省略设备 id，并将保存的默认值解析为可用的精确设备；显式 id 优先，不可用的默认值没有回退。每次修改仍必须给出显式目标和当前 observation。解析后的目标进入模型可见结果与持久化展示元数据；偏好变化不改变静态工具指导或 schema。

独立操作决策分别拥有[经审阅的 Git 操作](2026-09-17-reviewed-sidebar-git-actions.zh.md)、[终端生命周期](2026-09-17-sidebar-terminal-lifetimes.zh.md)、[浮动工作区命令](2026-09-17-floating-workspace-command-ownership.zh.md)、[托管 MCP 连接](2026-09-17-managed-mcp-ownership.zh.md)、[持久自动化](2026-09-17-durable-automation-ownership.zh.md)以及 [SSH 目标检查](2026-09-17-ssh-inspection-authority.zh.md)。共用设置行不会合并它们的权限或成功条件。

## Alternatives considered

**将原型值复制到新设置 schema。** 这会产生重复默认值和无法改变实际操作的控件。现有字段 owner 与 scope 已提供页面需要的持久化和执行事实。

**从 Promise 结算或恢复值推断已保存。** Controller 可以在写入被拒后恢复并正常返回。接受必须来自真实应答；值检查仍是额外验证。

**仅为 Desktop 功能调用启动 HTTP 监听。** Desktop 已有经过身份验证的通道。操作保留在 Provider 并增加 Controller 即可支持两种应用，无需第二套绑定特定传输的实现。

**用 profile 安装目录标识可变状态。** Electron 会替换暂存安装树。稳定的 home/profile 标识能跨更新保留状态，并隔离不同 home。

## Consequences

统一外观不意味着相同存储或执行语义。仅有能力信息的页面仍有用途并可搜索，但不制造操作。每个新运行 owner 仍需自身真实组合证据和明确限制；字段账本分别记录未支持的原型字段与已实现操作。

测试覆盖相同值下的接受与拒绝、被后续写入取代的操作、执行中拆除、排队取消和传输恢复。语音组合测试通过无 HTTP 的 Desktop Fetch、经过身份验证的 Web 调用、旧路由一致性、取消与卸载重载验证真实 Provider。三个 HTTP bridge 回归用例复现响应晚到、关闭后写入与背压竞态，并验证等待能结束。浏览器和 Electron 验收消费组合后的产物，因此只有源码测试不能证明应用集成。
