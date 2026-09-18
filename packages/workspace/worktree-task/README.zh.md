---
description: "隔离 checkout 生命周期管理的 Worktree Task 服务契约。"
kind: "package-reference"
---
# @deepseek-ai/dsh-worktree-task

[English](README.md) | 中文

## 概述
本包定义用于创建和管理隔离 repository checkout 的 Worktree Task 服务。Task 使用不透明 id，具有明确的 active、hibernated 或 archived 生命周期状态、有界操作和由提供方拥有的记录。Remote 控制器、Settings 页面和执行消费者使用此契约，不依赖 Git 实现细节。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 dsh-worktree-task-git 等提供方作为 ctx.worktreeTask。跨服务和 Remote 调用传递带品牌的 task id，并使用生命周期方法，而不是直接操作 checkout 路径。

带 revision 的设置应用于未来任务；每个任务保留其捕获的起始位置和程序。只读审查返回有界的已跟踪文件变更、未跟踪文件名与捕获的程序，不激活 checkout。归档与删除可能返回清理收据；已结算失败允许显式重试，未结算 claim 则阻止重试。成功的 cleanup 不会重复。安全删除会保留未合并分支及已归档记录；收据在任务删除后仍保留。休眠不执行 cleanup。

[Git 提供方](../worktree-task-git/README.zh.md)拥有命令执行、checkout 路径约束、结算与持久化。

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

`WorktreeTaskId` 是不透明的带品牌标识符。生命周期调用使用提供方签发的 id，不从 id 推导 checkout 路径。当前验收证据与剩余验证记录在[验收状态](../../../.agents/plans/settings-native-acceptance-status.md)。
