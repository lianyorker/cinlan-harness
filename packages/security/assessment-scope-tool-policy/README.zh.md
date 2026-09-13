---
description: "对 shell、网络和 Browser 模型工具执行 fail-closed 评估授权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-assessment-scope-tool-policy

[English](README.md) | 中文

## 概述

此可选 Consumer 在 shell、网络和 Browser 模型工具执行前检查评估范围，为每个匹配调用记录操作决策，并安装防止监听器绕过的单调守卫。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 assessment-scope-session 和 execution-host 之后挂载。默认集合覆盖 `bash`、`pwsh`、`web_search`、`web_fetch` 和原生 Browser 工具。无法解析目标的调用会被拒绝；URL 调用还需要目标范围网络出口。`finding_export` 由自身 Consumer 使用相同的 report-download 操作单独校验。

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
