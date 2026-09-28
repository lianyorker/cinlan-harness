# Agent Note: Gateway 完整输出上限终止载体

Status: implemented

[English](2026-09-25-gateway-complete-output-limit-teardown.md) | 中文

## 问题

委托一元响应与 Remote stream frame 可能包含由对端控制或意外变大的 JSON 值。只测量业务值会让过大的序列化 envelope 仍被发出，而优雅关闭 WebSocket 在对端不完成关闭握手时可能让活动 iterator 一直等待。

## 决策

Connection 在发送前序列化完整的一元响应 envelope，并用 Buffer.byteLength(text, 'utf8') 计算 UTF-8 字节数。超过 maxResponseBytes 的委托响应会被有界的 413 响应替代；恰好达到上限的响应仍然有效。该上限覆盖成功与错误 envelope，也覆盖 handler-failure 文本。

Gateway 在发送前序列化每个完整的 Remote frame，包括 type、stream id 以及 value 或 error 字段。超过 maxOutputBytes 的 frame 会在调用 send 前被拒绝；mux 会终止物理 WebSocket 并中止所有活动 logical stream，而不会等待对端完成关闭握手。恰好达到 UTF-8 上限的 frame 仍然有效。

Remote Access 将校验后的 maxResponseBodyBytes 设置同时提供给委托一元载体与 WebSocket mux。就绪生命周期保持独立：Gateway 通过 effect 所有的 route 注册并释放载体，详见[就绪 note](2026-09-23-gateway-waits-for-application-readiness.zh.md)。

## 考虑过的替代方案

**只计算返回值或 frame payload。** 这样会把 wrapper 与 metadata 排除在上限外，传输中的响应仍可能超过配置上限。

**截断超大的 JSON 结果。** 截断会产生无效或语义不同的协议数据，并隐藏所属操作的失败；发送前拒绝可以保持协议消息完整。

**输出超限时使用优雅关闭。** 对端可能停止响应关闭握手，而活动 iterator 仍在等待；终止可以提供有界的物理清理，abort signal 则释放流拥有的工作。

## 后果

委托调用方收到有界的传输错误，而不是超大的响应；WebSocket 对端在超限时观察到物理终止，不能保证收到 1009 close frame。输出上限终止载体后，生产方必须遵守 abort signal。完整序列化输出、UTF-8 编码和 wrapper 字段都属于强制上限的范围。

## 测试

Gateway 测试覆盖多字节超大 frame、精确上限 frame、写入失败，以及另一个 iterator 活动时无响应对端的终止。Connection 测试覆盖多字节超大的成功与错误响应，以及精确上限的完整 envelope。聚焦的 Loader 组合测试通过真实 Connection 注册路径运行。
