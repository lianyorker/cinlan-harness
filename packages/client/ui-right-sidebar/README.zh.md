---
description: "为 review、worktree 任务、browser、端口转发与行评论提供右侧栏贡献。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-right-sidebar

[English](README.md) | 中文

## 概述
本插件向生产右侧栏贡献 Review、Tasks、Browser 与端口发现与转发页面，并向通用设置注册「编辑器与 Diff 偏好」项。规范的 Files 页面由 ui-sidebar-files 拥有，Terminal 已解耦至 ui-sidebar-terminal。Review 页面提供工作区隔离 Diff 审查（支持行内与双栏并排视图、自动换行与空白符显示切换）、结构化行级评论编辑以及向 Session Agent 提示词队列的直接注入。Ports 页面负责发现远程工作区目标上的监听 TCP 端口，并管理具备冲突检测与断线清理能力的环回端口转发规则。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将插件与 ui-sidebar-right、ui-sidebar-files、locale、官方 Remote 组合和相关 Host 控制器一起挂载。贡献 slot 使用按 session 注入，并返回类型化的加载、错误、空结果和变更状态。

<a id="model-experience"></a>
## 模型体验

Review 贡献允许用户通过 remote.session.prompt 将结构化行审查评论分发至当前活跃的 Session Agent 提示词队列；其他 tab 不注册 prompt、tool 或 Session event。

#### KV Cache 影响

分发至 Agent 队列的评论将作为文本上下文追加到后续模型 turn 中。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 浏览器内容受限于已挂载的 Host Remote namespace，不创建任意进程或文件系统权限。
- 受限 Browser 页面只接受经过验证的 HTTP(S) URL，不提供跨源 DOM 访问。

不发布 runtime invariant companion，因为本包拥有浏览器组件状态，而 sidebar 所有权和生命周期由 ui-sidebar-right 执行。

<a id="dev-note"></a>
### 开发备注

不要注册第二个 conversation.session.header.corner 贡献者；添加右上角工具时扩展现有 ExpandButton owner。
