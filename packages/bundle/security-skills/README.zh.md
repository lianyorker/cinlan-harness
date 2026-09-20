---
description: "用于安全研发技能目录的可安装组合包。"
kind: "package-bundle"
---
# @deepseek-ai/dsh-security-skills-bundle

[English](README.md) | 中文

## 概述
本组合包将安全技能提供方加载到 Harness skill registry；提供方发现资源管理器当前激活的安装。它为 profile 提供应用、基础设施、移动端、二进制和供应链研发工作流的可复用指导。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
通过带有 skill registry 和[资源管理器](../../security/security-skills/README.zh.md)的 dsh profile 加载组合包。Web 组合包提供管理器；其他组合需在 Host 根部显式挂载一次 `@deepseek-ai/dsh-security-skills/resources`。通过安全研究设置安装资源后才能加载相应技能。技能内容不会授予评估目标，也不会绕过 assessment-scope 服务。

<a id="model-experience"></a>
## 模型体验

间接通过加载选定技能到模型上下文的 skill consumer 产生影响。

#### KV Cache 影响

只有选定的技能内容会影响模型请求；组合包本身不添加额外 prompt 前缀。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 随包资源是需要显式选择的安装来源。网络下载要求配置发行清单 URL；组合包不会推断公共端点。
- 指导是建议性的；授权和证据要求由其他包执行。

不发布 runtime invariant companion，因为组合包只组合提供方；安装状态与保留职责归资源管理器。

<a id="dev-note"></a>
### 开发备注

组合包的 Loader patch 使用 insert list；保持资源路径和 skill id 同步。
