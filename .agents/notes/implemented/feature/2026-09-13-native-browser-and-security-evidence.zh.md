# Agent Note：原生浏览器偏好与持久安全证据

Status: implemented

[English](2026-09-13-native-browser-and-security-evidence.md) | 中文

## 问题

外部应用 CLI 适配器不等于 Harness 原生能力。Loader 激活也不证明浏览器可以启动或评估效果已经授权。进程内 Artifact 存储无法在 Host 退出后保留持久 Findings 引用的证据。

## 决策

可选 cinlan-browser 组合包选择已有的 Harness 自有 Playwright Provider。其 Settings 命名空间在部署默认值之上保存浏览器通道、无窗口模式与视口偏好。写入复用 Settings 服务与修订号校验。偏好在 Provider 重新挂载时应用，此前保留活动页面与观察。路径、Provider 身份及权限策略不属于此偏好表单。

安全研究使用已有本地 Artifact Provider。引用保持不透明、带范围且可校验完整性；字节与元数据独立于 Provider 实例持久化。空 JSON 和 Markdown 报告使用 Unix epoch 而不是当前时钟，相同数据的重复导出产生相同字节。

NodeNext 消费方检查在 Windows 使用目录 junction，在其他系统使用目录 symlink。设置阶段错误保留原始诊断，并与编译器失败区分。主机缺少 symlink 权限时不会跳过包或缩小声明检查范围。

四个独立安全小组合包发布真实 insert patch 和从源码构建的空命名空间入口。Findings 片段挂载 Session Provider，不会同时在同一个服务键下挂载抽象 Service Definition。构建包含这些载体，不需要手工编写 lib 占位文件。

## 考虑过的替代方案

继续调用 Orca 会把另一个应用的安装与运行环境作为产品前提。修改按钮名称无法消除该依赖。复制 Orca settings store 会重复已有 Harness Settings 与 Cordis 插件生命周期。

每次字段编辑后重启浏览器会使活动页面与观察失效。明确的重启要求区分成功持久化与实际应用。

把报告留在内存会在重启后留下缺少证据字节的引用。复用本地存储，而不是增加另一套报告数据库。

## 结果

浏览器操作保持可选且默认请求审批。保存偏好既不启动浏览器，也不授予权限。Settings 表单分别报告缺失、只读、拒绝与保存状态。当前命名空间支持每个 Host 配置一个 Playwright Provider。

Computer Use 与 Mobile Device 仍使用历史 CLI 适配器。安全范围配置尚未被全部 shell 与网络消费者执行；此组合包不是评估隔离机制。本决策不交付 Cookie 导入、原生桌面/手机 Provider 或其余暂存能力族。本地 Artifact 保留标签不实现到期清理或加密，原内存 Provider 丢失的字节不可重建。

## 验证

真实 Web Loader 场景通过 Remote 保存偏好、重启 Host、通过浏览器工具打开本地 Chromium 页面、点击已观察元素，并按照保存的视口检查 PNG 尺寸。安全场景验证全部 Finding 状态、无证据晋级拒绝、三种报告格式、Provider 重建和跨范围读取拒绝。这些测试不调用模型，也不操作系统桌面或手机设备。

聚焦 NodeNext fixture 验证真实链接创建、暂存清理、编译器拒绝与设置阶段诊断。构建声明消费方检查覆盖完整配置工作区。

## 相关决策

[迁移组合记录](2026-09-10-worktree-sidebar-security-integration.zh.md)继续负责 Worktree、Sidebar 与可选预设。本决策替代其中进程内证据存储的选择。[设备就绪记录](2026-09-12-device-profile-and-provider-readiness.zh.md)继续负责现有设备接口，不作为原生桌面或手机执行的证据。
