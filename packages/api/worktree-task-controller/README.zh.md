---
description: "用于本地 Worktree Task 生命周期操作的 Host Remote 控制器。"
kind: "package-reference"
---
# @deepseek-ai/dsh-api-worktree-task-controller

[English](README.md) | 中文

## 概述
通过类型化 `worktreeTasks` Remote 命名空间创建和管理 Worktree Task。读取与保存默认值、审查任务变更，并请求激活、休眠、归档或安全删除。创建接受来源仓库，默认值接受结构化程序/参数配置；生命周期调用使用 Provider 签发的 task id。Provider 拥有文件系统策略和执行。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将控制器与 Typert Gateway 和 `ctx.worktreeTask` 提供方一起挂载，再挂载 `dsh-api-remotes` 提供浏览器命名空间。生成的 Remote 暴露 `settings`、`updateSettings`、`review` 和生命周期方法。保存默认值要求当前版本；审查只读且有界；清理收据区分未结算执行、成功和失败。控制器将取消信号转发给提供方，并把提供方失败映射为稳定的 Remote 错误码。

<a id="model-experience"></a>
## 模型体验

无，因为 Worktree Task Remote 控制器不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；task 管理不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 受管根与活动 checkout 配额属于 Provider 部署配置，Remote 默认值不能修改它们。
- Remote 不流式传输 Git 子进程输出；调用方收到操作结果或类型化错误。

不发布 runtime invariant companion，因为控制器只是 Worktree Task 服务的无状态 Remote 投影。

<a id="dev-note"></a>
### 开发备注

Typert 会生成 Host 和 Remote 声明；请编辑 `src/index.ts` 和 `src/types.ts`，不要编辑生成文件。当前验收证据与剩余验证记录在[验收状态](../../../.agents/plans/settings-native-acceptance-status.md)。
