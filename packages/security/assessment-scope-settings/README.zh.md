---
description: "由 Settings 文档驱动的可变评估范围 Provider，用于操作员授权范围。"
kind: "package-reference"
---

# @deepseek-ai/dsh-assessment-scope-settings

[English](README.md) | 中文

## 概述

此 Provider 将操作员持有的评估根授权存入 Harness Settings 文档，并通过 `ctx.assessmentScope` 暴露规范化授权范围。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

挂载 `dsh-settings` 与可写 Settings Provider 后再使用此包。`assessment-scope` 命名空间只接受授权范围元数据和凭证引用，不存储密钥值。每次更新都会先进行 schema 校验和规范化，然后才更新 live 根授权范围。

根授权读取直接解析已提交的 Settings 值，不会因异步 watcher 延迟撤销。既有 Session 授权不会获得扩展权限。收紧范围、更改目标定义或更改 grant/engagement 身份可能使已有绑定失效；变更评估授权后应新建 Session。不保留独立策略状态或 invariant companion。

<a id="model-experience"></a>
## 模型体验

### 评估策略输入

#### 模型看到的内容

此处不注册 prompt 或模型工具。Consumer 可以在暴露效果前读取规范化的 `ctx.assessmentScope` 策略。

#### Token 影响

此 Provider 不增加 token；任何模型可见的决策文本都由负责效果的 Consumer 负责。

#### KV Cache 影响

评估范围设置不会改变缓存前缀。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 本包只保存根授权范围，不提供 Settings UI、授权文件工作流或任意 Consumer 的效果守卫。
- 已绑定的 Session 仍遵循 assessment-scope-session 的恢复和重新校验规则。

不发布 runtime invariant companion，因为根授权直接读取已提交 Settings，不保留独立策略投影。

<a id="dev-note"></a>
### 开发备注

脱敏配置界面编辑单个字段时应使用按路径的 Settings mutation，不要从脱敏视图重建并替换整个 section。
