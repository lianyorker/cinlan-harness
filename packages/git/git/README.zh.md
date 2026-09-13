---
description: "为需要 Git 状态、但不需要 mutation 或 workspace isolation 的 Consumer 定义只读 repository observation。"
kind: "package-reference"
---
# @deepseek-ai/dsh-git

[English](README.md) | 中文

## 概述

为需要 Git 状态、但不需要 mutation 或 workspace isolation 的 Consumer 定义只读 repository observation。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

该包定义只读 Git capability seam（`ctx.git`）。它负责 repository identity、结构化 status、有界 diff 和有界 log observation，但不选择 Git 实现，也不决定 Workspace isolation policy。

Service Definition 与 mutation 和 isolation 分离：

| Package 或 Consumer | 作用 |
|---|---|
| `@deepseek-ai/dsh-git` | Service Definition 与 provider-neutral vocabulary |
| `@deepseek-ai/dsh-git-local` | 使用所选 execution world 的 `git` executable 的 local provider |
| Git mutation Consumer | 后续受 approval 控制的 commit、branch、checkout、push 与 publication action |
| Workspace isolation provider | 可选 worktree 或 runtime lease；`ctx.git` read 不会隐含隔离 |

`resolveRepository()` 返回 canonical root 与 opaque repository id。`status()`、`diff()` 和 `log()` 返回结构化且有界的 observation。Provider 必须拒绝非 repository、command failure 和超出配置限制的 output。Consumer 不得解析 provider-specific path，也不得推断某个 task 需要 branch。

## Model Experience

### Request context and condition

#### 模型看到的内容

Consumer 可以展示 `ctx.git` status、diff 和 log observation。Git output 只有在 tool 或 workflow Consumer 通过普通 tool path 记录后，才会进入模型可见内容。

#### Token 影响

由 Consumer 负责；只有它选择的有界 observation 会进入 request。

#### KV Cache effect

由 Consumer 负责；变化的 status 或 diff observation 只会改变包含它的 request suffix。

## Known Limitations and Deferred Work

- 该 seam 不修改 repository、不创建 branch、不 push、不 merge，也不创建 worktree。
- Repository identity 由 provider 负责，不承诺特定 Git object database 表示。
- Remote provider 与 structured libgit implementation 保留为后续 provider。
- 不发布 runtime invariant companion，因为该 Service Definition 不拥有可独立观察的 provider relation。

<a id="dev-note"></a>
### 开发备注

Provider 与 Consumer 包负责可执行的 Git 行为；该包负责共享的 service vocabulary。
