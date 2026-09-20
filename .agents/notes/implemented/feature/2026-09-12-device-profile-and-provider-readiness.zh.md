# Agent Note: Device profile 与 Provider 就绪状态

Status: implemented

[English](2026-09-12-device-profile-and-provider-readiness.md) | 中文

## Problem

设备设置必须区分插件加载、Provider 可连接和操作权限。当前 CLI 没有对应实现时，复制安装命令会误导用户。桌面与移动设备源码还必须接入当前构建、工具目录、profile 组合和 Remote 类型，不能只作为孤立的源码副本存在。

## Decision

Computer Use 和 Mobile Device 保留独立的 Service Definition、Provider、策略 Consumer 和可选 bundle。原生 CUA 拥有桌面工具 schema；移动设备 CLI Provider 保留其工具 Consumer。device-control profile 在现有 base 和 Web 层之上组合它们；通用 web 和 headless profile 不获得设备输入能力。当前 ToolCallId、Attachment 限制、subprocess handle 和 compiler reference 仍是准则。不迁入空 invariant installer。

deviceCapabilities/check Remote 调用电脑就绪查询或移动设备列表，返回脱敏的 not-configured、available 或 unavailable 结果。Loader 状态不是安装探测，探测成功也不授权输入。Settings 复制受支持的 dsh profile 命令，并保留[呈现决策](2026-09-12-computer-use-settings-presentation.zh.md)中的卡片布局。[原生 CUA 决策](../architecture/2026-09-20-native-cua-readiness-and-policy.zh.md)负责桌面组合、生命周期就绪状态和原生策略。桌面操作系统权限保持 unknown；移动设备 CLI Provider 保留其外部运行时前置条件。

仅缓存成功的 executable 查询。安装或修复 PATH 后允许重新查询；取消与卸载会在生成进程前中断正在进行的解析。

顶层构建直接调用 native、Host、Client 和 Web 构建步骤，全部成功后才记录 Client 产物 hash。任一阶段失败都会停止后续步骤，避免把嵌套 package-script 外壳返回成功误当作子构建已执行的证据。

安全研究通过独立的只读 Remote 读取现有 Host 服务、Loader 激活状态和 Skill 发现结果。configured 仅表示配置完整；未激活条目、无效预设、不完整目录和空执行主机授权不能表示运行就绪。运行时读取的预设目录、技能资源和侧栏查看器分块显式包含在发布规则中。

## Alternatives considered

在所有 Web profile 中启用设备输入会静默扩大已有部署的能力。独立可选 profile 保留原有组合和显式 ask 策略。

用 Loader 激活状态显示已安装会隐藏可执行文件缺失和移动设备不可用。只读 Provider 探测提供运行证据，不暴露应用内容或设备身份。

恢复旧 Client runtime 或备用应用启动器会替换当前所有权。现有 Cordis 服务、Typert Remote、Settings slot 和 dsh 启动器已提供所需扩展点。

## Consequences

此 profile 暴露带有新鲜度校验和审批的真实设备工具。它不安装外部软件、不授予原生权限，也不证明每种设备操作都可用。Provider 缺失或失败时 Settings 仍可使用。原先仅基于卡片的安装声明由 Provider 就绪状态取代，布局和本地化控件保留。

## Verification

Provider、parser、工具、策略和 Loader 组合测试覆盖允许与拒绝观察、过期标识、截图、取消、卸载以及 CLI 修复后重试。源码 CLI profile 测试验证两组 bundle 及默认 ask 策略。组件测试和真实 Web Host/Chromium 场景验证本地化状态、命令复制、经生成 Remote 刷新以及不再显示安装声明。这些 fixture 未执行真实桌面输入或真实模拟器控制。
