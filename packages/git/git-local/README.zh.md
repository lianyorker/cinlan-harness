---
description: "通过配置的 subprocess execution world 运行有界且只读的 Git repository observation。"
kind: "package-reference"
---
# @deepseek-ai/dsh-git-local

[English](README.md) | 中文

## 概述

通过配置的 subprocess execution world 运行有界且只读的 Git repository observation。

## 目录

- [使用本包](#use-this-package)
- [Config](#config)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

`LocalGitRuntime` 是 [`@deepseek-ai/dsh-git`](../git) 的 local Service Provider。它通过 `ctx.subprocess` 执行一个配置的 `git` executable，因此 command 与 repository 使用 composition 选定的同一个 execution world。

该 provider 只提供 repository resolution、结构化 status、有界 diff 和有界 log。不 commit、push、创建 branch，也不创建 worktree。Mutation 与 isolation 仍属于独立 Consumer 和 provider。

## Config

| Key | 作用 |
|---|---|
| `executable` | 由 subprocess provider 解析的 Git executable name 或 absolute path |
| `maxOutputBytes` | status、diff、log 与 diagnostic 的最大收集 output |
| `maxLogEntries` | 一次 log 返回的最大 commit 数 |
| `graceMs` | 进程 termination grace period |

所有字段都是显式 deployment configuration。Provider 绝不启动 shell，也不把 user input 插入 command string。

Repository resolution 会验证请求路径确实位于 Git 报告的 work tree 内；如果 `.git` indirection 配置的 work tree 指向其他位置，则拒绝该路径。当 stdout 超过调用方上限时，`diff` 返回保留的有界文本并设置 `truncated: true`。Repository resolution、status 与 log 需要完整结构化输出；任一收集 stream 不完整时以 `OUTPUT_TOO_LARGE` 失败。每条命令同时等待 direct outcome 与整个 process tree 退出；spawn 和 lifecycle failure 会转换为 `COMMAND_FAILED`，而调用方取消会在 settlement 后再次检查并保留原始 abort reason。

Status 使用 NUL-framed porcelain v1 record；对于 unborn repository 返回 branch name，对于 detached HEAD 返回 `undefined`，并拒绝 empty、malformed、truncated 或 unterminated output。Rename 与 copy record 会消费其独立 origin path，不会把 path byte 解释成另一条 status。Log output 同样使用 NUL-delimited field，因此包含其他 control separator 的 commit subject 会保持完整，不会被错误拆分为多条 record。

每次 observation 都会清除 ambient `GIT_*` entry、禁用 global 与 system Git configuration、禁用 system attribute、设置 `GIT_OPTIONAL_LOCKS=0`，并把 `LANG` 与 `LC_ALL` 固定为 `C`。兼容 Git 2.25 的 command-scope `-c` argument 会禁用 `core.fsmonitor`。执行 status 或 diff 前，provider 会枚举 repository 中所有有效的 `filter.*.clean` 与 `filter.*.process` entry，并用不执行 identity command 的禁用配置替换对应 driver；如果 filter name 无法由 `-c` 表达，observation 会失败，而不会执行 repository configuration。Diff 还会传入 `--no-ext-diff` 和 `--no-textconv`。因此 repository configuration 不能重定向 observation、通过 optional lock 刷新 index、运行 fsmonitor hook，或执行 clean、process、external diff／textconv command。

## Model Experience

### Request context and condition

#### 模型看到的内容

Git Consumer 可以展示结构化 `ctx.git` status、diff 或 log observation。该 provider 自身不贡献 model-visible text。

#### Token 影响

由 Consumer 负责；只有它选择的有界 observation 会进入 request。

#### KV Cache 影响

无直接影响；Consumer 负责记录 observation 以及由此产生的 request suffix 变化。

## Known Limitations and Deferred Work

- Provider 每次 request 只观察一个 repository，不负责列举 repository。
- Provider 要求选定 execution world 中存在 Git executable；libgit 或 remote provider 保持独立。
- Commit、push、checkout、branch creation、merge 和 worktree mutation 被明确排除。
- 不发布 runtime invariant companion，因为每个 Git observation 都会在 provider operation 内校验 repository 与 command result。

<a id="dev-note"></a>
### 开发备注

Provider 对 Git command 与 repository path 都使用配置的 subprocess world。
