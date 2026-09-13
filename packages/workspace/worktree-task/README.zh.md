---
description: "隔离 checkout 生命周期管理的 Worktree Task 服务契约。"
kind: "package-reference"
---
# @deepseek-ai/dsh-worktree-task

[English](README.md) | 中文

## 概述
本包定义用于创建和管理隔离 repository checkout 的 Worktree Task 服务。Task 使用不透明 id，具有明确的 active 或 hibernated 生命周期状态、有界操作和由提供方拥有的记录。Remote 控制器、Settings 页面和执行消费者使用此契约，不依赖 Git 实现细节。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 dsh-worktree-task-git 等提供方作为 ctx.worktreeTask。跨服务和 Remote 调用传递带品牌的 task id，并使用生命周期方法，而不是直接操作 checkout 路径。

<a id="model-experience"></a>
## 模型体验

间接通过 Worktree Task Remote 和 Settings 消费者产生影响。

#### KV Cache 影响

无直接影响；只有选择纳入它的消费者才会把 Worktree Task 状态传给模型。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 服务契约不规定存储后端或 Git 可执行文件。
- checkout 配额、持久性和子进程限制由提供方决定。

不发布 runtime invariant companion，因为本包定义服务契约且不拥有提供方状态。

<a id="dev-note"></a>
### 开发备注

WorktreeTaskId 是不透明的带品牌标识符；文件系统路径应留在提供方和 Host 控制器内部。
