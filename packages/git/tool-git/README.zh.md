---
description: "为模型提供三个有界且只读的 repository status、diff 与 log observation 工具。"
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-git

[English](README.md) | 中文

## 概述

为模型提供三个有界且只读的 repository status、diff 与 log observation 工具。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

本包是只读 [`ctx.git`](../git) capability 面向模型的 Consumer。它注册三个按操作拆分的工具，并把每一次 repository observation 委派给已配置的 provider：

| Tool | 参数 | 结果 |
|---|---|---|
| `git_status` | 无 | canonical repository root 与 `HEAD`，以及 branch、upstream divergence、staged、unstaged、untracked、conflicted 和 clean 字段 |
| `git_diff` | 可选 `max_bytes` | canonical repository root 与 `HEAD`，以及有界 diff observation 和 truncation state |
| `git_log` | 可选 `limit` | canonical repository root 与 `HEAD`，以及包含 hash、author、commit time 和 subject 的有界 commit entry |

模型不能选择路径。每次执行都要求 exact calling Agent 仍注册在 `ctx.agents` 中，并且其 Session header 包含 `cwd`；只有这个 execution-world workspace path 会传给 `ctx.git.resolveRepository()`。Agentless、unregistered、stale 或 missing-`cwd` call 会在访问 provider 前失败，因此模型不能用这些工具检查 harness process 可见的其他 repository。`max_bytes` 只映射到 `GitDiffRequest.maxBytes`，`limit` 只映射到 `GitLogRequest.limit`。省略任一字段时，由 provider 解析默认值；工具会把本次调用的 `AbortSignal` 同时转发给 repository resolution 和所选 observation。

三个定义都是 concurrency-safe 的模型读操作，并使用不含 file location 的 generic read presentation card，因为 operation 观察的是 repository，而不是单个文件。本包不会调用 shell，也不能 commit、checkout、创建 branch、push、merge、reset、clean 或创建 worktree。这些 effect 与可选 Workspace isolation 需要独立插件和 approval policy。

## Model Experience

### Tool schema

#### 模型看到的内容

模型会看到生成的 [`git_status`、`git_diff` 和 `git_log` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-git)。每个 schema 都不包含 workspace path。Status 没有参数；diff 只公开 `max_bytes`；log 只公开 `limit`。描述明确说明工具为只读，并限制在 calling Agent 的 workspace repository。

#### Token 影响

插件 scope 中的每个 request 会增加三个固定 schema。在模型调用工具前，不会注入任何 repository observation。

#### KV Cache 影响

只要插件和 tool view 不变，prefix 保持稳定。启用、停用或过滤任一定义都会改变 tool-schema prefix。

### Tool result

#### 模型看到的内容

每个成功结果都以 canonical repository root 和当前 `HEAD` 开头；没有 commit 时显示 `(unborn)`。Status 显示明确计数，并在没有 attached branch 时显示 `(detached)`。Diff 先显示 truncation flag，再显示保留的文本或 `(no diff)`。Log 每个 commit 使用一行 tab-delimited 文本，并用 JSON 引号包裹 author name 与 subject，使嵌入的 separator 不产生歧义。Canonical result value 保持为与 output schema 匹配的结构化 object。

#### Token 影响

Status 为固定大小。Diff 和 log 受 provider 与可选调用方上限约束；保留的结果在 compaction 前持续存在于模型历史中。

#### KV Cache 影响

只追加。每个 observation 位于可复用 request prefix 之后，repository 变化只影响后续 tool-result token。

## Known Limitations and Deferred Work

- Consumer 只观察包含 calling Session workspace `cwd` 的 repository；一次调用不能检查第二个 repository。
- 当前 service 没有 staged、untracked-file content、revision-range 或 path-filtered diff operation；这些 observation 需要后续增加显式 service method。
- Repository mutation、publication 与 worktree isolation 被明确排除，不能作为这些只读工具的隐藏 mode 加入。
- 不发布 runtime invariant companion，因为工具注册 metadata 不构成可独立观察的所属关系。

<a id="dev-note"></a>
### 开发备注

该 Consumer 不为只读 Git 工具增加 mutation 或路径选择 mode。
