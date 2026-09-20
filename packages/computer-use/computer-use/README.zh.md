---
description: "桌面 Provider 注册表及观察、操作请求。"
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use

[English](README.md) | 中文

## 概述

桌面 Provider 注册表及观察、操作请求。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个 Service Definition 为本地桌面应用提供 Provider 无关的 `ctx.computerUse` 注册表与执行入口。Provider 负责平台传输、能力发现、应用与窗口身份、无障碍观察、截图字节和动作执行；Consumer 负责权限策略、模型 schema、attachment 持久化和呈现。

## Provider 选择

可选的 `provider` 配置会固定一个 Provider id。未配置时，每次调用都选择当前唯一可用的 Provider。选择失败使用结构化 `ComputerUseError`：

| 条件 | Code |
|---|---|
| 已配置的 Provider 未注册 | `COMPUTER_PROVIDER_CONFIGURED_MISSING` |
| 已配置的 Provider 不可用 | `COMPUTER_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 没有可用 Provider | `COMPUTER_PROVIDER_UNAVAILABLE` |
| 存在多个可用 Provider | `COMPUTER_PROVIDER_AMBIGUOUS` |
| Provider id 为空或重复 | `COMPUTER_PROVIDER_ID_INVALID` / `COMPUTER_PROVIDER_DUPLICATE` |

选择在每次调用时执行，因此 Provider disposal 或可用性变化不会留下缓存的后端选择。

## 独占的外部工具适配器

`register(ComputerUseProviderName)` 为发布自身工具的适配器预留电脑操作能力，`providerName` 在其关闭期间仍报告注册名称。此注册拒绝任何已注册的 `ComputerUseProvider`，包括不可用者；`registerProvider()` 也会拒绝现有独占注册。原有多 Provider 配置与逐次调用选择保持有效。`ComputerUseRegistry` 是 `ComputerUseRuntime` 的类导出别名，品牌构造函数通过 `./brand` 和包主入口导出。

[Cua Driver MCP](../../experimental/computer-use-cua-driver-mcp/README.zh.md) 和[Cua Driver native](../../experimental/computer-use-cua-driver-native/README.zh.md) 均为显式启用适配器。它们拥有自己的工具，不实现 Cinlan 的观察与动作请求。切换时应卸载 Cinlan Provider 及其专用 Consumer；适配器必须在工具移除且拥有的操作全部结束后才释放注册。

## 身份与观察

`ComputerAppId` 和 `ComputerWindowId` 是 Provider 签发的不透明选择器。`ComputerObservationId` 标识一次短生命周期无障碍观察，每个 `ComputerElementId` 只在对应的精确观察内有效。每个变更操作都必须携带应用、窗口和观察 id；成功动作会返回一份新观察，并替换此前的 element 作用域。

服务提供能力发现、应用与窗口列表、观察、点击、次级无障碍动作、滚动、拖拽、字面文本输入、按键、快捷键、粘贴和值设置。`ComputerUseProvider` 返回结构化值和可选的已验证 PNG 字节；它不决定工具 schema、审批文本、模型可见性或 attachment 保留策略。

<a id="model-experience"></a>
## 模型体验

### Consumer 拥有的桌面结果

#### 模型看到的内容

本包不直接贡献模型文本。[`@deepseek-ai/dsh-tool-computer-use`](../tool-computer-use/README.zh.md) 负责呈现 `ctx.computerUse` 结果，并通过常规 tool-result 路径保留 `ComputerUseError` 失败。

#### Token 影响

Service Definition 不增加请求或结果 token；相关成本由面向模型的 Consumer 负责。

#### KV Cache 影响

Provider 注册、选择、能力和观察状态不会改变模型请求前缀；prompt 与 schema 变化由 Consumer 配置负责。

## 已知限制与暂缓事项

- 服务没有 display 身份、Execution Host 绑定、远程 host generation 或持久桌面资源记录；当前 Provider 使用自身的 runtime generation 和短生命周期观察。
- 能力描述符是 Provider 报告的事实。当前模型 Consumer 保持六个固定 schema，不受支持的动作会通过所选 Provider 失败，而不会从工具目录消失。
- 服务不覆盖持久 Browser 页面、Mobile Device 控制、Android 或 iOS simulator、Speech/Audio、下载、网络检查或凭据输入工作流。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
