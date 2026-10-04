---
description: "在设置中打开官方 Schedule 任务管理器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-automation

[English](README.md) | 中文

## 摘要

提供官方 Schedule 任务管理器的设置入口。设置页与侧栏及会话视图共享同一任务目录、任务详情和投递历史，不创建第二套任务存储或执行运行时。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

将浏览器入口与设置、语言和布局服务一同挂载。此包只注册设置入口；官方 `ui-schedule` 负责任务目录、任务详情和远程修改。

新草稿需要标题、提示词、工作区、智能体预设、模型、权限预设，以及每小时、每天或每周的 UTC 计划。每周计划使用星期日 = 0。可选推理强度是提供方定义的显式值，不是虚构的支持选项列表。保存失败会保留草稿和原始版本；发生冲突后，放弃草稿并重新编辑，才能采用更新的任务版本。

启用与暂停明确修改调度。任务停用时仍可运行一次，且不会因此启用任务。响应不确定后，重试同一请求会保留准入令牌；再次明确点击运行一次则创建新令牌。暂停不会取消活动工作。取消运行会针对已记录的调用发送取消请求。删除需要确认，且任务不能有活动运行。

记录为所选任务加载真实分页。正在启动、运行中、正在停止、轮次已完成、失败、已取消、重叠跳过、已中断和结果不确定等状态均来自已记录的证据。轮次完成不代表业务成功。中断或不确定结果会显示复核警告，绝不自动重试。仅当运行记录包含会话 id 时才提供打开会话操作。只读与不可用连接会禁用修改操作，但不会把缓存数据替换为空列表。

此页面不添加工具、系统指令或 Session 事件。打开或编辑页面不会调用模型；明确执行会消耗所生成 Session 使用的模型资源。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Slots 渲染器将 API 客户端的稳定数据源绑定到 useAutomation 钩子。组件只接收框架属性与普通回调。定义、活动运行、资源选项和记录分页均保留在 API 对象中；组件状态仅保存草稿、确认、待处理反馈及手动请求令牌。页面与静态本地化搜索元数据共享设置声明的生命周期，并一同释放。搜索元数据绝不包含提示词、工作区路径、任务标题或记录值。

此包不发布运行时不变量伴随入口，因为页面不拥有独立业务状态投影。组件测试检查展示和回调参数；Loader 测试覆盖真实 API 客户端数据源、渲染器绑定与注册释放。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) — 业务数据与渲染的归属。
- [Slots 参考](../../../docs/subsystems/slots.zh.md) — 数据源钩子与注册生命周期。
- [Schedule 包](../../schedule/schedule/README.zh.md) — 持久化规则与投递语义。
- [Schedule 客户端](../ui-schedule/package.json) — 此设置入口打开的官方任务管理器。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

包内测试使用确定性的主机响应，绝不启动模型或外部服务器。完整浏览器验证由上级组合维护者负责。

</details>

<a id="model-experience"></a>
## 模型体验

此页面不调用模型，也不拥有 Schedule 数据。官方 Schedule 服务与任务管理器负责提醒投递和模型可见操作。

#### KV Cache 影响

此页面不组装提供方请求或改变请求前缀；自动化运行时及所选 Agent 组合负责请求构建与对应缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 创建任务通过官方 Schedule 任务管理器或 `schedule_create` 工具完成；此设置入口只负责打开管理器。
- 设置页与任务管理器共享 Host Schedule 目录和投递历史。
- 任务创建、规则校验、Session 目标与投递均由 Schedule 包负责。
