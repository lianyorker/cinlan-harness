---
description: "通过 executionHosts Remote 命名空间提供经过认证的 SSH 目标管理和目录检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-execution-host-controller

[English](README.md) | 中文

## 概述

此控制器通过经过认证的 `executionHosts` Remote 命名空间，向原生设置提供已保存 SSH 目标和受限目录检查。HTTP、WebSocket 流和桌面共享 Fetch 使用相同的 Connection 承载方式。目标服务拥有持久化、SSH 认证、连接代次和远程操作结算。

## 目录

- [使用本包](#use-this-package)
- [观察目标变化](#observe-target-changes)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将此控制器与 Typert 和[已保存目标服务](../../execution-host/execution-host-targets/README.zh.md)一同挂载，由所属应用配置 Connection 认证。生成的 `executionHosts` 客户端提供目标列表、带修订号的记录修改、显式连接控制和根目录相对路径检查。通过 `executionHosts.removeTarget` 按当前修订号删除已保存记录。[原生主机设置](../../client/ui-settings-hosts/README.zh.md)通过注入的回调消费 API。运行时方法要求显式可信本地 Gateway 权限以及可选的[运行时安装器](../../execution-host/execution-runtime/README.zh.md)。它们接受固定指纹的 SSH 端点字段、Host 上的密钥文件引用和远程绝对路径，但不接受凭据内容、浏览器选择的产物或任意命令。

一元调用返回生成的 `RemoteResult` 值。预期目标失败使用带有清理后消息的类型化 `execution-host/` 错误码。持久化修改在接纳前检查取消，并完成已接纳的提交；连接和检查将取消传播到目标服务。该服务决定远程结算是否已确认。

<a id="observe-target-changes"></a>
## 观察目标变化

`follow` 返回完整管理快照的原始异步序列。它先订阅再生成初始快照，在消费者暂停时合并变化，并在取消或控制器销毁时释放监听器。快照将管理进程的来源信息、已保存目标身份和远程 worker 进程身份分开。传输丢失会对客户端可见，不会留下仍可使用的过期就绪观察值。

载体关闭或控制器销毁时，`followRuntimeTask` 会脱离观察。控制器销毁会等待迭代器清理后正常结束流，不会取消 Host 持有的任务。重新加载的控制器可以再次观察保留的任务。真正的观察失败仍保留类型化 Remote 错误。

`./types` 入口仅包含 DTO 导出，可由 Client 程序导入。不发布 invariant companion：控制器适配权威目标服务，不维护独立的数据投影。

<a id="model-experience"></a>
## 模型体验

无，因为此控制器不提供 Agent 工具、提示词或 Session 事件。

#### KV Cache 影响

无；Remote 管理流量不会改变模型请求或可复用前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

运行时安装使用立即返回的 `startRuntime` 凭据、受限的 `listRuntimeTasks` 恢复、`getRuntimeTask`/`followRuntimeTask` 观察和显式 `cancelRuntimeTask`。请求或观察取消不会取消已接纳任务。安装器缺失返回 `execution-host/runtime-unavailable`，不影响目标 CRUD 可用性。全局默认路由、运行中切换和任务隔离设置不可用。部署要求和未确认的取消结果由[目标服务](../../execution-host/execution-host-targets/README.zh.md#connection-ownership)说明。

<a id="dev-note"></a>
### 开发备注

[组合测试](tests/composition.spec.ts)启动真实 Loader 配置行，使用独立持久化存储、认证以及 HTTP/共享 Fetch 承载方式。[Follow 测试](tests/follow.spec.ts)覆盖实际 WebSocket 流和 Gateway 拉取迭代，包括基线顺序、合并、取消、路由销毁和重新加载。

[SSH 集成测试](tests/ssh-integration.spec.ts)通过认证 Remote 保存目标，经真实 OpenSSH 运行固定 worker 命令，检查其独立进程，并验证重连隔离、HTTP 取消确认和传输丢失时不回退本机。Fixture 使用回环 SSH 服务器和临时凭据；无需个人 SSH 配置或远程部署。
