---
description: "具备有界 checkout 生命周期操作的 Git Worktree Task 提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-worktree-task-git

[English](README.md) | 中文

## 概述
本提供方使用 Git worktree 和 Harness 存储域实现 Worktree Task 生命周期操作。它串行化变更、限制 active checkout 数量、跨提供方重启保留 task 记录，并且只清理由自身拥有的路径。Session 绑定让 Remote 和 task 消费者使用 task id 定位任务，而不会获得任意文件系统权限。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
使用 repository root 和可写的 DSH home 将提供方挂载为 ctx.worktreeTask。为部署配置 active checkout 上限和子进程限制，然后通过服务或生成的 Remote 控制器执行生命周期操作。

<a id="model-experience"></a>
## 模型体验

间接通过 Worktree Task Remote 和 Settings 消费者产生影响。

#### KV Cache 影响

无直接影响；只有选择纳入它的消费者才会把 Git checkout 状态传给模型。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 提供方需要 Git 可执行文件和可写的 task storage root。
- 提供方记录和 checkout 清理只在配置的 Host 上有效，不是分布式 lease 服务。

不发布 runtime invariant companion，因为提供方的权威 task 状态通过服务方法观察，而不是通过独立 invariant 流。

<a id="dev-note"></a>
### 开发备注

提供方拥有子进程取消和清理；调用方必须使用 task id 和生命周期方法，不要重建路径。
