---
description: "带有研发指导和参考资料的安全技能目录提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-security-skills

[English](README.md) | 中文

## 概述
本提供方将随包提供的安全研发技能及其参考资源注册到 Harness skill registry。它覆盖 API、移动端、二进制、固件、恶意软件、供应链和 LLM 安全工作流，但不会把这些文档嵌入每个 prompt。Skill consumer 在模型请求时加载选定条目。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 skill registry 一起挂载，并加载 security-research profile 或独立安全组合包。保持随包资源不可变，通过标准 skill consumer 调用技能，不要直接导入资源。

<a id="model-experience"></a>
## 模型体验

间接通过拥有面向模型技能加载行为的 skill consumer 产生影响。

#### KV Cache 影响

无直接影响；只有选定的技能会向模型请求贡献文本。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 目录随包发布，不通过 Web UI 编辑。
- Skill 内容是指导；评估授权仍由 assessment-scope 服务负责。

不发布 runtime invariant companion，因为 registry 负责技能注册的唯一性和生命周期，本提供方只贡献不可变条目。

<a id="dev-note"></a>
### 开发备注

包中包含较大的资源树；保持资源路径相对于包，并保留技能调用元数据。
