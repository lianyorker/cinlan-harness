---
description: "类型化侧边栏 Git Remote 调用、Session 权限范围、取消和稳定的操作错误。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-sidebar-git-controller

[English](README.md) | 中文

## 概述

通过 `sidebarGit` Remote 命名空间，从 Web 与桌面客户端使用相同的显式 Git 操作。读取变更、历史和比较，再提交绑定仓库的操作或已审阅的提交意图。控制器转发取消信号，并保留可据以采取行动的操作错误。全部仓库权限来源均由[侧边栏 Git 服务](../../git/sidebar-git/README.zh.md)提供。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将控制器与 Typert 和[侧边栏 Git 服务](../../git/sidebar-git/README.zh.md)一起挂载。本包没有配置字段。生成的 `./remote` 导出提供客户端调用；`./types` 提供浏览器安全的请求、结果和错误声明。

每个请求标识一个已附加的 Session。变更请求携带向用户显示的仓库；提交请求携带准备操作返回的完整预览。控制器转发这些事实，不接受客户端工作目录回退，也不运行自己的 Git 子进程。服务拥有路径验证、比较选择、提交预检、钩子、签名和进程限制。

错误使用稳定的 `sidebar-git/*` 代码，并包含操作名。服务缺失或执行租约丢失时返回 `sidebar-git/unavailable`；即使另一个失败同时结束，显式调用方取消仍返回 `sidebar-git/cancelled`。服务拒绝保留对应的错误码和消息。意外错误转换为 `sidebar-git/git-error`。重试已被拒绝的意图前，客户端必须刷新过时的仓库事实或准备新的提交预览。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

[控制器](src/index.ts)通过 Typert 发布类型化方法，为每次调用解析当前 `sidebarGit` 服务，并转发相同请求和取消信号。它负责转换为 [Remote 错误码](src/types.ts)，不增加仓库状态或另一套变更策略。HTTP 调用方通过自己的传输层调用同一个具体服务。

不发布不变量伴随插件，因为控制器只执行类型化转发和错误转换。它不拥有需要协调的持久化缓存或独立 Git 投影。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [侧边栏 Git 服务](../../git/sidebar-git/README.zh.md)——操作、进程限制和提交审阅。
- [Git settings](../../git/git-settings/README.zh.md)——偏好所有权。
- [API Gateway](../../../docs/api-gateway.zh.md)——生成的 Remote 传输。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验

无，因为控制器只转发显式 UI 请求，不添加面向模型的变更工具、回合结束行为或模型输入。

#### KV Cache 影响

无；控制器不组装模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

控制器继承服务的操作限制：

- 要求已附加的 Session 具有权威工作目录；客户端目录不能补充缺失的权限来源。
- 现有 DiffTab 未跟踪内容 HTTP 路由独立于这些 Git Remote 方法。
- 不提供本地基线刷新或网络 Git 操作。比较使用本地缓存引用。
- 变更准入与外部 Git 进程不构成原子事务；服务只串行化自身变更，并在准入时拒绝过时事实。
