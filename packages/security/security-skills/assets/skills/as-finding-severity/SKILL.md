---
name: as-finding-severity
description: Finding 严重度评分纪律：severity 与 confidence 的证据门槛、状态约束与降级规则。当记录 finding（finding_record / campaign 台账）、需要把观察结果定级、或复核已有 finding 的定级是否成立时使用。
---

# Finding 严重度评分纪律

severity 与 confidence 是两个独立轴：severity 回答"如果成立，伤害多大"，confidence 回答"证据支持它成立的把握"。两者填写的依据完全不同，禁止互相借用。

## 状态对 severity 的硬约束

`finding_record` 的 `status` 与 `severity` 组合遵循以下矩阵；违反组合的记录视为定级错误：

| status | severity 上限 | 说明 |
|--------|--------------|------|
| `reproduced-vulnerability` | `critical`（不设限） | 有复现证据，按实际影响定级 |
| `hypothesis` | `medium` | 未经复现的推测封顶 medium |
| `observation` | `low` | 单纯观察（信息收集产物）封顶 low |
| `remediation` | 沿用原 finding | 修复记录继承原定级 |
| `unresolved` | `high` | 已确认存在但未复现利用路径的，封顶 high |

`critical` 仅在同时满足以下条件时使用：`reproduced-vulnerability` 状态 + 影响满足"远程未授权代码执行 / 域管级权限获取 / 敏感数据实际外带 / 核心业务破坏"之一 + 有复现证据（reproduction 类 evidence）。

## severity 定级标准

| severity | 判据 |
|----------|------|
| `informational` | 无伤害的信息（banner、指纹、暴露面清单） |
| `low` | 需要特殊条件才可利用、影响限于非敏感信息或资源耗用 |
| `medium` | 常规条件下可利用但不影响核心权限/数据（反射型 XSS、配置错误的信息泄露） |
| `high` | 直接获得应用层权限、敏感数据访问、或业务逻辑破坏（认证绕过、垂直越权、SSRF 打进内网管理面） |
| `critical` | 见上方 critical 三条件 |

## confidence 定级标准

| confidence | 判据 |
|-----------|------|
| `low` | 只有外部特征或工具告警，无验证 |
| `medium` | 有间接证据（版本指纹 + 已知 CVE 匹配、错误回显），未复现 |
| `high` | 有直接复现证据（请求/响应、命令输出、截图），且已在授权范围内确认 |

confidence 与工具输出解耦：nuclei/nmap 报出的条目默认 confidence `low`，只有人工验证后才升级——工具的 "critical" 标签不构成 confidence 依据。

## 复核与改口

- 定级错误的 finding 用 `finding_transition` 修正并说明依据，不删除重建
- 复现成功后：`hypothesis` → `reproduced-vulnerability`，同时按证据重新评估 severity
- 修复验证后：状态转 `remediation`，severity 不因修复而改写（记录的是发现时的事实）
