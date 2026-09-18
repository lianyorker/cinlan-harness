---
description: "通过 Remote 管理本地 UTC 自动化任务，并跟踪已提交的定义、调用历史和可用选项。"
kind: "package-reference"
---
# 自动化控制器

[English](README.md) | 中文

## 摘要

使用本包可通过 API 网关创建、编辑、暂停、删除、运行和取消本地自动化任务。客户端可以读取已提交的定义，分页浏览调用回执，并发现 Host 当前的工作区、预设、模型和权限选项。操作失败时保留最近已提交的视图，并提供稳定错误码。调度、持久存储和 agent（智能体）执行仍由自动化运行时拥有。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将 Host 包与自动化运行时及其选项服务组合。将本包的 `/client` 入口与 Gateway、Connection 及本包生成的 Remote 贡献组合。本包没有配置字段；部署调度策略属于运行时。

Host 在生成的 `automation` 命名空间下提供 `ctx.automationController`。Client 提供独立的 `ctx.automationClient` 服务。通过渲染器的 hook 绑定提供其稳定的 `source`；展示组件接收快照数据和普通命令回调，而不是手动订阅。

Client 区分加载中、就绪和不可用状态。可为空的运行时与目录值区分尚未答复的请求和成功返回的空列表。修改方法执行 Connection 的本地 Host 权限判断，并通过 `writable` 暴露同一判断结果。冲突会保留已提交的视图和错误；再次提交带版本检查的编辑之前先刷新。重试手动调用准入时必须保留原请求令牌。

目录名称和描述是来源数据，不是本地化产品文案。可用性使用稳定代码。缺失的默认值仍作为明确选项保留；模型未列出仅表示目录信息，不能证明路由无效。加载选项时不执行模型调用或凭据测试。即使当前目录没有对应选项，已保存的选择仍保留在定义数据中。

-----

控制器不注册提示词、工具或 Session 事件。目录读取、计划预览和 Client 订阅不增加模型 token。获准调用产生运行时所选 Agent 的常规请求开销。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[Host 控制器](src/index.ts) 将命令委托给运行时，并将错误映射为 `automation/operation-failed`，附带运行时错误码和长度受限的公开消息。底层提供方和存储诊断不通过 Remote 传输。[目录适配器](src/catalog.ts) 读取当前服务元数据；它不解析或持久保存草稿。

每条[跟踪流](src/feed.ts) 都以完整的已提交快照开始，并为每个慢读取方将更新合并为一个待发送的替换值。取消和 Host 释放会唤醒等待中的读取方。[Client](src/client/index.ts) 使用 Gateway 流监督和 Connection 代次来拒绝过期响应，在失败期间保留已提交值，并拥有一个选中的分页调用历史查询。订阅回调异常会被隔离，释放后不会再发布状态。

本包不发布运行时不变量配套插件：控制器没有可与运行时比较的独立持久数据，Client 传输状态在断连期间允许滞后。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [自动化运行时](../../automation/automation/README.zh.md) — 调度、准入和持久回执。
- [API 网关](../gateway/README.zh.md) — 生成的 Remote 传输与流监督。
- [工作区控制器](../workspace-controller/README.zh.md) — 工作区导航和注册。

<a id="model-experience"></a>
## 模型体验

间接通过[自动化运行时](../../automation/automation/README.zh.md)，由其负责获准请求的 Agent 输入与 Session 证据。

#### KV Cache 影响

控制器不改变模型请求前缀或缓存设置；这些影响由运行时所选的 Agent 组合和模型负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 跟踪流重连会替换完整已提交视图；该流没有持久重放游标。
- 目录读取反映读取时可用的服务，不会为未来调用预留资源。
- 不从参考性模型列表合成推理强度选项；明确保存的选择和默认选择保留其值，交由运行时验证。
- 一个 Client 实例保留一个选中的调用历史查询；选择其他定义会替换该查询，已提交的运行时版本变化会刷新所选查询的第一页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
