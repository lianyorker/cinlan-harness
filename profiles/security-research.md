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

### Security Skills（22 个入口）
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

在“设置 → 安全研究”中显式安装资源后，技能才进入官方 Skill 目录。页面区分随应用附带的资源与网络发行包；网络下载需要由部署配置提供真实发行清单 URL，未配置时显示不可用。更新失败保留当前版本，移除资源不会删除正在使用的 Agent 已加载的文件。详细来源、安装与保留语义见[资源管理器](../packages/security/security-skills/README.zh.md)。

内置评估范围默认没有目标和操作。执行评估前，请在 profile 的后续 patch 中加入经过授权的目标、操作、Execution Host 身份和证据策略。资源安装页面不授予评估范围，也不导出扫描报告。将可选能力层加入非 Web profile 时，还需在 Host 根部显式挂载一次 `@deepseek-ai/dsh-security-skills/resources`；内置 Web 组合已提供该服务。
