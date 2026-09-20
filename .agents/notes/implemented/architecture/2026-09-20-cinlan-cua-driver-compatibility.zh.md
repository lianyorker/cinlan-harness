# Agent Note: Cinlan and Cua Driver Computer Use compatibility

Status: implemented

[English](2026-09-20-cinlan-cua-driver-compatibility.md) | 中文

## 问题

Cinlan Consumer 依赖应用与窗口 id、受 observation 限定的动作、逐次调用的 Provider 选择和专用权限检查。Cua Driver 通过独占桌面注册暴露自己的工具。若以仅保存名称的注册表替换 Cinlan 服务，便会删除这些 API；若允许两个栈同时运行，则可能在启动或卸载期间产生竞争的桌面输入。

## 决策

[Provider 注册决策](2026-09-12-computer-use-provider-registration.zh.md)负责两种 Cua Driver 传输与上游工具语义。本记录负责与 Cinlan Provider 及本地 MCP 生命周期的兼容。

[Computer Use 运行时](../../../../packages/computer-use/computer-use/README.zh.md)保留 Provider 执行入口，并增加官方独占注册 API。Cua Driver 注册会拒绝所有现有 facade Provider，包括不可用者；facade 注册也会拒绝现有独占占用者。Cinlan API 内的多 Provider 选择仍有效。两个[实验性](../../../../packages/experimental/computer-use-cua-driver-mcp/README.zh.md)[适配器](../../../../packages/experimental/computer-use-cua-driver-native/README.zh.md)仍须显式组合启用，并通过共享 MCP 结果适配器发布上游工具 schema。

每个 Provider 都保留注册，直到其拥有的操作结束。直接 yield Cordis effect disposer 确保清理有序。Cinlan 等待 CLI 调用结束后才注销；原生 Cua 移除工具、中止工作、等待调用并关闭 SDK 后才释放注册。MCP 适配器在关闭后读取本地连接快照；关闭超时会保留桌面占用，与 MCP 客户端保留命名空间的行为一致。原生关闭失败也会保留占用。无法确认关闭时，恢复方式是重启 Host。

Cinlan 权限 Consumer 仍只处理 Cinlan 请求。选择 Cua Driver 需要显式组合与上游权限；不会启用 Cinlan 的六个模型 schema，也不会修改出厂默认组合。[设备就绪决策](../feature/2026-09-12-device-profile-and-provider-readiness.zh.md)仍负责 Cinlan profile 与 Settings 行为。

## 考虑过的替代方案

**用官方注册表替换共享服务。** 这样会删除现有 Cinlan 公开方法、请求类型、Provider 选择和 Consumer 行为。增加 API 可以保留这些 Consumer，无需在不兼容的动作模型之间编造映射。

**让两个栈独立注册。** 独立注册无法阻止原生输入与正在卸载的 Cinlan 操作重叠。两个服务注册方法都执行互斥，Provider 完全结束后才释放占用。

**原样复制官方 MCP 生命周期。** 本地 MCP 客户端可能在 disposal 完成时报告 `close-timeout`。若把这一完成状态当作已确认关闭，就会在传输命名空间仍被保留时释放电脑操作占用。

## 影响

调用方可以选择任一 Cua Driver 传输，而不改变 Cinlan 公开 API。激活 Cua Driver 前必须卸载 Cinlan Provider 及其专用 Consumer。共享注册不会串行化所选驱动内的不同 Session、预留窗口、授予操作系统权限或回滚已发送的输入。

## 验证

无密钥 Provider 和 Loader 测试使用模拟原生 SDK 或返回固定 PNG 字节的本地 stdio fixture，覆盖工具目录校验、激活回滚、持久化图像投影、取消、依赖重启、重复注册、关闭失败与 Cinlan 卸载顺序。两个拥有自身记录的场景使用相同的合成外部驱动。真实桌面输入、主机窗口截图、操作系统授权和真实平台兼容性不在本次验证范围内。
