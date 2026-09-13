# Security Research Profile

启用完整的安全研发能力集。

## 包含的功能

### Assessment Scope
- 评估范围管理
- Session 和静态范围绑定

### Findings Management
- 安全发现记录和跟踪
- 状态管理（observation → hypothesis → reproduced-vulnerability → remediation）
- SARIF / Markdown / JSON 导出

### Vulnerability Knowledge Base
- NVD 漏洞数据库集成
- CVE 查询和详情获取

### Security Skills (24 个)
专业安全研发技能，包括：
- API 安全测试
- 移动应用逆向
- 二进制分析
- 恶意软件分析
- 固件渗透测试
- 攻击链构建
- ... 等

### Security Workflow
安全工作流系统提示，指导模型完成：
1. Recon & Attack-Surface Mapping
2. Record Findings
3. Triage & PoC Validation
4. Fix & Retest
5. Report

## 启用方式

首次使用会自动创建内置 profile：

```bash
dsh --profile security-research
```

将能力层加入其他 profile：

```bash
dsh plugin --profile <name> add @deepseek-ai/dsh-security-research
```

内置评估范围默认没有目标和操作。执行评估前，请在 profile 的后续 patch 中加入经过授权的目标、操作、Execution Host 身份和证据策略。
