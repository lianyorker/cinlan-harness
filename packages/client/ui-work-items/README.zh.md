---
description: "通过官方 Remote 查看工单并管理本地关联。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-work-items

[English](README.md) | 中文

## 概述

此插件在 Cinlan Settings 中提供 GitHub、GitLab 和 Linear 工单列表、详情，以及本地 Workspace/Session 关联操作。外部写入需要 Provider 显式启用，并单独确认预览。

## 目录

- [使用此包](#use-this-package)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

可选的 `work-items` profile 挂载此包。打开 Settings → 工作项，选择来源与状态；分页经由 Host 读取 Provider 数据，搜索筛选当前 Provider 页。工作区范围筛选本地关联投影，不改变外部 Provider 的项目或团队。Provider scope 和凭据由 [Host Provider](../../work-items/README.zh.md) 配置；浏览器不接收凭据。

Provider 可见性是 `work-items.githubVisible`、`gitlabVisible` 和 `linearVisible` 中的 Host 偏好，控制本页面可选的来源。恢复继承值会移除覆盖，不可用或只读设置会禁用写入。GitHub 和 GitLab CLI 状态来自 Integration Preflight，不证明 REST 凭据可用。Linear 可用性通过真实查询检查。刷新失败保留所选详情和写入草稿。

选择一个工作区和工单，可将其关联到工作区或其中一个已有 Session。取消关联只删除本地链接，不删除工单、Session 或 Git 分支。分支与租约状态仅在 Host 能验证 Session 的受管 worktree 时显示，不从工单名称推测。

展开“修改外部工单”，填写创建、评论、状态或指派后点击预览，再单独确认服务器保存的精确内容。修改表单不会更改既有预览，必须重新预览。历史可恢复待确认、取消、过期、成功、失败或不确定回执；终态回执不提供执行按钮。搜索切换目标时，状态和指派输入分别保留草稿。GitLab 用户名在写入工单前解析为数字用户 id；空指派列表明确表示清除指派。

<a id="implementation"></a>
## 实现

组件通过注入回调调用生成的 workItems Remote，并通过框架 useWorkspaces 读取实时工作区投影。已删除的工作区和已归档的 Session 不能成为新关联目标。切换来源、筛选、页码或详情会取消过期请求；只有成功的持久化回执才能更新关联显示，写入失败保留原显示并允许重试。

页面沿用 Settings 父级内容宽度和响应式原生行。本地化公共描述符覆盖可见性、查询、关联和写入控件，使用稳定字段锚点；搜索不包含当前值、凭据、工单内容或路径。搜索会先展开折叠的写入控件再定位字段。描述符随分区槽位一起注册和释放。

不发布 runtime invariant companion，因为持久关联由 Host controller 所有，槽位生命周期由 renderer 所有；本包只保存页面局部交互状态。

<a id="model-experience"></a>
## 模型体验

无，因为工单浏览与本地关联不注册 prompt、tool 或模型请求修改。

#### KV Cache 影响

不改变模型请求前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 不提供外部删除或未知结果自动重试。来源平台若返回不确定结果，需要人工核实。
- 此界面不创建 Session 或 worktree；只关联已有对象。外部工单与关联详情通过刷新重新读取，不提供推送订阅。
- 此处不提供默认来源、自动显示已关联项或外部写入策略偏好。Provider 部署配置控制范围及写入可用性。

<a id="dev-note"></a>
### 开发备注

Remote 与持久化语义由 [controller](../../api/work-items-controller/README.zh.md) 定义。UI 不调用旧 ApiProxy，也不维护第二套工作区数据。
