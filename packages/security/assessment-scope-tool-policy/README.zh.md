---
description: "对 shell、网络和 Browser 模型工具执行 fail-closed 评估授权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-assessment-scope-tool-policy

[English](README.md) | 中文

## 概述

此可选 Consumer 在 shell、网络和 Browser 模型工具执行前检查评估范围，支持显式配置的工作区命令例外，并安装防止监听器绕过的单调守卫。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 assessment-scope-session 和 execution-host 之后挂载。默认集合覆盖 `bash`、`pwsh`、`web_search`、`web_fetch` 和原生 Browser 工具。无法解析目标的调用会被拒绝；URL 调用还需要目标范围网络出口。`finding_export` 由自身 Consumer 使用相同的 report-download 操作单独校验。

`workspaceCommands` 默认为空列表。每项指定已配置的 shell `tool` 和精确 `command`；空值、首尾空白、重复项或非 shell 项会在加载时失败。匹配调用必须具有绝对路径的 Session 工作区，且实际工作目录存在、解析后的路径位于工作区内。显式目标或 URL 参数、sandbox 权限覆盖及后台执行不适用此例外。未匹配的调用继续检查评估范围；获准的工作区命令仍经过下游守卫和 sandbox policy。

这些配置项信任工作区及其命令环境，包括包管理器执行的脚本。它们不会把任意 shell 文本判定为安全，也不会把子进程影响限制在工作目录内；此隔离由部署 sandbox 负责。

<a id="model-experience"></a>
## 模型体验

### 授权决策

#### 模型看到的内容

拒绝或需要审批的调用返回普通工具错误或审批提示，每个匹配的 `tools/pre-execute` 决策都会记录到 Session 日志。

#### Token 影响

Consumer 不增加 prompt 文本或 schema。

#### KV Cache 影响

授权不会改变模型缓存前缀。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- Shell 命令不能从任意命令文本推断目标；请使用显式 `target_id` 或唯一授权目标。
- Browser 页面操作需要 HTTP 页面 URL 才能解析目标。
- `finding_export` 使用独立的完整报告授权，不在此处重复记录。

不发布 runtime invariant companion，因为 Consumer 不拥有独立投影。

<a id="dev-note"></a>
### 开发备注

没有评估范围服务时，不要在通用 Web profile 挂载此可选层。
