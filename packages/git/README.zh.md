---
description: "用于有界 repository observation 的只读 Git 能力家族。"
kind: "package-group"
---
# git/ - 只读 Git capability family

[English](README.md) | 中文

## 概述

通过有界 Git observation 读取 repository identity、status、diff 与 log，同时不把 mutation 或 isolation policy 固定到 Consumer。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

Git capability 拆分为 provider-neutral Service Definition、provider 和可选 Consumer。它为 tool 和 workflow 提供有界的 repository observation，不把 branch、worktree 或 mutation policy 固定到 capability 中。

| Package | 作用 | `ctx` key |
|---|---|---|
| [`git/`](git/README.zh.md) | repository identity、结构化 status、有界 diff 和 log | `ctx.git` |
| [`git-local/`](git-local/README.zh.md) | 通过 `ctx.subprocess` 执行配置的 Git binary | 注册 `ctx.git` |
| [`tool-git/`](tool-git/README.zh.md) | 面向模型的 `git_status`、`git_diff` 和 `git_log` Consumer | 注册到 `ctx.tools` |

Commit、push、branch creation 和 worktree isolation 保持为独立 Consumer 或 provider seam，因此 composition 可以只使用 Git observation，而不为每个 task 创建 branch。

<a id="dev-note"></a>
## 开发备注

Git mutation 与 workspace isolation 仍属于独立能力，不在该包组内。
