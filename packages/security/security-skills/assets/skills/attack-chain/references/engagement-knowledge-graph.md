# 渗透作战知识建模规范

> 多阶段渗透作战中如何结构化记录"发现了什么、做了什么、什么有效"。用于 field-journal、findings 记录和任何需要跨阶段追踪作战状态的场景。

---

## 实体标签（node labels）

记录作战实体时使用以下固定标签（PascalCase 单数），禁止自造标签：

| 标签 | 含义 |
| --- | --- |
| `Host` | 主机/目标系统 |
| `Port` | 开放端口 |
| `Service` | 端口上运行的服务 |
| `WebApp` | Web 应用 |
| `Endpoint` | API/URL 端点 |
| `Account` | 账户身份 |
| `Vulnerability` | 漏洞 |
| `Misconfiguration` | 错误配置 |
| `Capability` | 已获得的能力（如命令执行） |
| `Credential` | 凭据（密码/hash/token） |
| `ValidAccess` | 已验证的访问权限 |
| `PrivChange` | 权限变更事件 |
| `Tool` | 使用的工具 |
| `ToolExecution` | 一次具体工具执行 |
| `Artifact` | 产出的文件/数据 |
| `Evidence` | 证据（截图/日志/响应） |
| `Attempt` | 一次攻击尝试（含失败） |
| `AttackTechnique` | 攻击技术（可映射 ATT&CK） |

## 关系类型（edge types）

| 边 | 含义 |
| --- | --- |
| `HAS_PORT` | Host → Port |
| `RUNS_SERVICE` | Port → Service |
| `HOSTS_APP` | Host/Service → WebApp |
| `HAS_ENDPOINT` | WebApp → Endpoint |
| `DETECTED_VULNERABILITY` | 扫描命中，**未验证** |
| `CONFIRMED_VULNERABILITY` | 已验证存在，**未利用** |
| `HAS_VULNERABILITY` | 已成功利用 |
| `HAS_MISCONFIGURATION` | 实体 → Misconfiguration |
| `AUTHENTICATES_TO` | Credential → Account/Service |
| `YIELDED_ACCESS` | 利用 → ValidAccess |
| `ESCALATED_VIA` | ValidAccess → PrivChange |
| `PIVOTED_TO` | ValidAccess → 新 Host |
| `ATTEMPTED_ON` | Attempt → 目标实体 |

### 漏洞确认三级递进

```text
DETECTED_VULNERABILITY（扫描器命中，未验证）
  → CONFIRMED_VULNERABILITY（手工验证存在）
    → HAS_VULNERABILITY（已成功利用，拿到实际效果）
```

与 finding 生命周期映射：`DETECTED` ≈ `observation`，`CONFIRMED` ≈ `hypothesis` 验证后，`HAS_VULNERABILITY` ≈ `reproduced-vulnerability`。记录时 MUST 区分三级——扫描器命中不等于可利用。

## 两类记忆的分工

| 类型 | 回答的问题 | 内容 |
| --- | --- | --- |
| 情景记忆（episodic） | "我们做过什么？" | 本次作战的实际行动、工具执行记录、发现时序 |
| 可复用知识（reusable） | "应该怎么做？" | 方法论、指南、成功技术——脱敏后可跨作战复用 |

查询顺序：先查情景记忆避免重复劳动，再查可复用知识找方法。

## 检索模式

| 模式 | 何时用 | 示例查询 |
| --- | --- | --- |
| `recent_context` | 默认起点，了解当前状态 | "recent nmap scan results for {target_ip}" |
| `successful_tools` | 找已验证有效的命令/技术 | "successful sqlmap commands against MySQL" |
| `episode_context` | 需要完整推理过程 | "pentester analysis of SSH vulnerability" |
| `entity_relationships` | 追踪实体关联（需已有实体 ID） | "services and vulnerabilities related to this host" |
| `entity_by_label` | 按类型盘点，用于报告 | "all discovered vulnerabilities" |
| `temporal_window` | 限定时间段 | "reconnaissance activities between T1 and T2" |
| `diverse_results` | 当前方法失败，找替代方案 | "privilege escalation techniques on Linux" |

### 查询构造

有效查询 MUST 具体且技术化：

- 好：`"nmap -sV scan results showing open ports on {target_ip}"`、`"privilege escalation using sudo misconfiguration on Ubuntu 22.04"`
- 坏：`"vulnerabilities"`、`"attacks"`、`"findings"`（太泛，检索不到）

包含：具体工具名与版本、目标标识、CVE/错误码/配置细节、成功/失败上下文。

---

## 可复用记录

```markdown
## 作战建模经验

- 实体/关系建模中漏记的高价值项：
- 三级确认被跳过的案例及后果：
- 检索模式的有效组合：
```
