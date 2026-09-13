---
description: "用于安全工作流系统提示段落的可安装组合包。"
kind: "package-bundle"
---
# @deepseek-ai/dsh-security-workflow

[English](README.md) | 中文

## 概述
本组合包加载安全工作流 prompt 贡献。它指导模型通过既有 workflow、Finding 和漏洞工具协调扫描、记录、分类、修复、重测和报告阶段，但不会授予目标或强制阶段转换。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将组合包与 dsh-system-prompt 和安全研发工具消费者一起加载。Prompt 段落保持稳定，其顺序由 security-workflow-prompt 包负责。

<a id="model-experience"></a>
## 模型体验

间接通过 security-workflow-prompt 的 system-prompt 贡献产生影响。

#### KV Cache 影响

加载的工作流段落贡献稳定的系统前缀文本，直到 prompt 组合发生变化。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 组合包引用外部扫描器，但不安装或授权它们。
- Finding 和评估服务仍负责类型化证据与授权检查。

不发布 runtime invariant companion，因为组合包只组合 prompt 插件，不拥有独立可变状态。

<a id="dev-note"></a>
### 开发备注

保持 prompt 源文件与其模型体验 README 同步。
