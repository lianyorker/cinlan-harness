---
description: "通过经过身份验证的 Remote 流连接侧边栏终端、发送输入并确认已渲染的输出。"
kind: "package-reference"
---
# 侧边栏终端控制器

[English](README.md) | 中文

## 摘要

Web 和 Desktop 客户端可以通过同一个 Remote 命名空间连接侧边栏终端、发送输入、调整显示尺寸并确认已渲染的输出。客户端还可以订阅代理终端列表并关闭选中的代理终端。Web 请求必须通过 Connection 身份验证；本包不创建终端专用服务器或传输机制。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将控制器与 `typert` 和 `ctx.sidebarTerminals` 的提供方一起挂载。应用提供 [Gateway](../gateway/README.zh.md) 和 [Connection](../../client/connection/README.zh.md)；现有 Desktop 载体可以在没有 Web 服务器的情况下调用相同的 Remote 方法。控制器没有配置字段。

```yaml
- name: '@deepseek-ai/dsh-api-sidebar-terminal-controller'
```

`sidebarTerminals` Remote 命名空间公开[服务操作](../../terminal/sidebar-terminals/src/index.ts)。渲染终端时保持 `open` 流存活，并在输入、尺寸调整、确认和释放请求中携带其连接标识。确认值表示已渲染的输出序列号，而不是已接收的字节数。提供方负责进程代次和释放方式。`inspectUi` 返回已有界面进程身份，不创建进程或延长生命周期；`closeUi` 比较已观察到的身份，拒绝关闭替代进程。

`listUi(sessionId)` 返回保留的存活 UI 终端，不创建进程。`renameUi` 必须携带 Session、标签、进程身份，以及最多 120 个字符、非空且不含控制字符的标题。提供方去除已接受标题的首尾空白；进程已被替换时以 `sidebarTerminals/stale-attachment` 拒绝请求。Client 回调返回已提交的快照，且在传输拆除期间继续被跟踪。

`shells` 和客户端回调 `terminalShells()` 返回本地主机已安装的可执行文件路径与名称，不创建进程。界面目标可以包含 `shellPath`，其值必须是非空、不含控制字符且最多 4096 个字符的字符串。提供方仅在创建进程时接受当前发现的选项；省略时保留设置默认值，重新连接时保留存活进程。代理目标拒绝 Shell 选择。显式选择不可用时报告 `sidebarTerminals/invalid-shell`。

线上尺寸必须是 1 到 1024 的整数。Session 标识必须是非空、不含控制字符且最多 256 个字符的字符串。主窗口标签保留不透明的 `terminal:<id>` 标识，前缀后允许 1–128 个 ASCII 字母、数字、下划线或连字符；浮动窗口标签必须使用与所传窗口一致的 `terminal:<windowUUID>:<counter>`。浮动窗口计数器必须是规范表示的非负安全整数。连接、窗口和代理标识使用小写 UUID 格式。浮动目录字符串最多 4096 个字符且不能包含 NUL；提供方负责解析并授权对应的文件系统目标。

完整的 JSON 输入请求对象（包括连接元数据和转义字符）以 UTF-8 编码后最多 64 KiB。客户端必须拆分超限请求。ACK 序列号必须是非负安全整数；释放方式仅接受 `disconnect`、`park` 或 `close`。未声明的请求字段会被拒绝，不会转发。

操作失败使用带类型的 `sidebarTerminals/*` 错误码和稳定消息，不包含提供方的私有诊断信息。目录失败报告 “Choose an existing directory inside the session workspace”。未分类失败使用 `sidebarTerminals/operation-failed`。取消仍属于载体失败，不归类为终端操作失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[SidebarTerminalController](src/index.ts) 验证 Remote 参数并委托给唯一注入的提供方。它不拥有 PTY 注册表，也不缓存输出。[验证](src/validation.ts) 仅用于入站 Remote 调用；同进程内的带类型提供方调用遵循服务定义的要求。[错误转换](src/errors.ts) 为一元调用和流迭代提供相同的公共诊断信息。

客户端入口通过 `ctx.sidebarTerminalClient()` 提供 React 无关的回调作用域。每次侧边栏激活拥有一个作用域，并在卸载时等待其释放；提供方先撤销工厂，再等待所有剩余作用域完成。适配器使用现有 `RemoteStream` 监督 Connection 代际、确认已渲染输出，并在关闭未重新打开的持久化标签时只读查询进程身份。

控制器将流取消信号与 Cordis 生命周期合并，在进入提供方之前检查取消状态，并在释放时等待提供方迭代器清理，即使客户端已暂停迭代。移除 Loader 条目会撤销 Remote 发现。控制器不发布 invariant 配套入口，因为它没有可独立观测并与提供方比较的终端状态；迭代器清理是由组合测试覆盖的生命周期义务。

[组合测试](tests/controller.host.spec.ts) 通过真实 Loader 加载生产 Gateway、Connection、凭据服务和控制器。测试使用外部终端提供方夹具，验证源码发现、经过身份验证的 HTTP 和 WebSocket 多路复用调用、参数验证、取消以及释放。提供方的进程集成由侧边栏提供方测试负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [服务定义](../../terminal/sidebar-terminals/src/index.ts)——提供方操作和连接生命周期。
- [Gateway](../gateway/README.zh.md)——Remote 分派和共享流多路复用。
- [Connection](../../client/connection/README.zh.md)——Web 身份验证和一元调用载体。

-----

<a id="model-experience"></a>
## 模型体验

无，因为终端 Remote 调用仅返回客户端数据，不会增加工具、消息或模型上下文。

#### KV Cache 影响

没有影响：此控制器不增加提示词 token，也不改变模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

以下行为依赖提供方和载体各自的职责。

- 目录存在性、工作区范围限制、PTY 可用性以及过期连接拒绝均由提供方负责。
- 提供方迭代器必须响应取消信号并完成清理；控制器释放会等待这些工作，不会将其遗弃。
- 客户端必须使输入请求满足 JSON 字节限制，并确认已渲染输出；控制器不会自动拆分输入或发放输出额度。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
