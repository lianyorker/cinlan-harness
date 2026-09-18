---
description: "用于评估授权、证据、Finding、技能、工作流和漏洞知识的安全研发包族。"
kind: "package-group"
---
# security/ — 安全研发能力

[English](README.md) | 中文

## 概述

security/ 包族提供评估授权范围、证据元数据、Finding 生命周期状态、可复用研发技能、工作流指导和漏洞知识。核心包定义接口；提供方与工具包提供本地存储、面向模型的操作和 profile 组合。security-research profile 使用这些包，并将默认 grant 设为空以拒绝所有操作。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 作用 |
|---|---|
| [`assessment-scope`](assessment-scope/README.zh.md) | 定义目标、操作、主机、时间范围、egress、凭据和证据策略。 |
| [`assessment-scope-static`](assessment-scope-static/README.zh.md) | 从静态 profile 配置提供经过校验的 grant。 |
| [`assessment-scope-settings`](assessment-scope-settings/README.zh.md) | 从已提交的 Settings 发布校验后的根授权。 |
| [`finding-export`](finding-export/README.zh.md) | 工具与人工 Consumer 共享的确定性报告字节导出库。 |
| [`assessment-scope-tool-policy`](assessment-scope-tool-policy/README.zh.md) | 在 shell、网络和 Browser 模型工具前执行范围授权。 |
| [`assessment-scope-tool-policy`](assessment-scope-tool-policy/README.zh.md) | 在 shell、网络和 Browser 模型工具前执行范围授权。 |
| [`assessment-scope-session`](assessment-scope-session/README.zh.md) | 将 grant 绑定到活动 Session，并记录操作决策。 |
| [`finding`](finding/README.zh.md) | 定义持久 Finding 的身份、证据、生命周期和投影接口。 |
| [`finding-session`](finding-session/README.zh.md) | 将 Finding 存入所属 Session 事件流。 |
| [`tool-finding`](tool-finding/README.zh.md) | 注册面向模型的 Finding 记录、查询、转移和导出工具。 |
| [`security-skills`](security-skills/README.zh.md) | 发布随包提供的安全研发技能目录和参考资料。 |
| [`security-workflow-prompt`](security-workflow-prompt/README.zh.md) | 为安全研发工作流添加面向模型的指导。 |
| [`tool-vuln-kb`](tool-vuln-kb/README.zh.md) | 注册面向模型的漏洞知识查询工具。 |
| [`vuln-kb-service`](vuln-kb-service/README.zh.md) | 定义与提供方无关的漏洞知识查询接口。 |
| [`vuln-kb-nvd`](vuln-kb-nvd/README.zh.md) | 提供本地 NVD 漏洞记录和刷新行为。 |

<a id="related-documentation"></a>
## 相关文档

- [Security Research profile](../../profiles/security-research.md) — 随附的组合及默认授权。
- [Security Research 子系统参考](../../docs/subsystems/security-research.zh.md) — 评估授权、操作决策、Finding 记录与漏洞查询。
- [Scope 子系统参考](../../docs/subsystems/scope.zh.md) — 共享范围和授权语义。
- [Skills 子系统参考](../../docs/subsystems/skills.zh.md) — 技能注册和加载语义。
- [Workflow 子系统参考](../../docs/subsystems/workflow.zh.md) — 工作流执行和结果语义。

<a id="dev-note"></a>
## 开发备注

授权、provenance、证据和面向模型的工具变更应留在所属包中。组合或 schema 变化时，同时更新 profile 和生成的工具目录。
