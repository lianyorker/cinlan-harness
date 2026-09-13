---
id: 'general/ai-security/01-agentic-risk-taxonomy'
title: 'Agentic AI 风险路由：五域生命周期与六阶段杀伤链'
title_en: 'Agentic AI Risk Routing: Five Domains, Three Lifecycles, and Six Attack Stages'
summary: >
  使用五个安全域、训练/部署/应用三个生命周期阶段和六阶段 Agent 杀伤链，为 LLM、RAG、MCP、记忆、身份与沙箱风险建立可验证路由。
summary_en: >
  Route LLM, RAG, MCP, memory, identity, and sandbox risks into verifiable tests using five security domains, three lifecycle stages, and a six-stage agent attack chain.
board: 'general'
category: 'ai-security'
signals:
  - 'agentic ai'
  - 'multi-agent'
  - 'mcp security'
  - 'tool abuse'
  - 'memory poisoning'
  - 'rag poisoning'
  - 'sandbox escape'
mcp_tools:
  - 'kb_router'
  - 'kb_read_file'
  - 'browser_snapshot'
  - 'pwsh'
  - 'finding_record'
keywords:
  - 'agentic security'
  - 'AI lifecycle'
  - 'attack chain'
  - 'GAARM'
  - 'AISS'
difficulty: 'intermediate'
tags:
  - 'ai-security'
  - 'agent-security'
  - 'risk-taxonomy'
language: 'zh-CN'
last_updated: '2026-08-23'
related_articles: []
---

# Agentic AI 风险路由：五域生命周期与六阶段杀伤链

本页用于把 Agent、LLM、RAG、MCP 和沙箱信号路由到测试面。它是分类索引，不是漏洞确认清单，也不使用上游冲突的旧编号作为稳定标识。

## 适用场景

- 面对新 Agent 架构，需要快速建立测试清单
- 现象只表现为工具乱调、RAG 污染、记忆异常或沙箱隔离失效
- 需要把 OWASP、AISS/GAARM 和攻击链视角放到同一资产图
- 需要判断风险属于训练、部署还是应用阶段

## 五个安全域与三个阶段

| 安全域 | 训练阶段 | 部署阶段 | 应用阶段 |
| --- | --- | --- | --- |
| AI 应用 | 框架、组件、输出处理和开发插件 | API 暴露、源代码/配置污染 | Prompt/MCP/工具链、多模态输入、循环与自治 |
| AI 模型 | 后门、投毒、对齐和评测缺口 | 模型文件窃取、篡改和加载风险 | 越狱、提取、反演、对抗样本和资源耗尽 |
| AI 数据 | 数据来源、投毒、隐私和偏差 | 向量库/对象存储、传输、日志和缓存 | Prompt 泄露、成员推断、RAG/记忆投毒和跨租户检索 |
| AI 身份 | 训练环境认证、角色和最小权限 | 服务账号、云凭据、模型/向量库访问 | 角色逃逸、会话劫持、多 Agent 身份和逐工具授权 |
| AI 基座 | 开发工具、依赖和环境隔离 | 容器、云平台、镜像和供应链 | 沙箱逃逸、代码执行、拒绝服务和横向访问 |

先确定资产和生命周期，再选择专项 skill。不能因为一个条目属于“AI 模型”就忽略其 API、身份或容器 owner。

## 六阶段 Agent 杀伤链

| 阶段 | 观察对象 | 典型控制 |
| --- | --- | --- |
| Infrastructure | 模型服务、网关、依赖、资源配额 | 最小暴露、强身份、签名与限额 |
| Perception | 用户输入、网页、文件、RAG、多模态 | 来源标记、内容与指令分离、输入隔离 |
| Planning | 目标、系统指令、计划和工具选择 | 目标约束、策略验证、执行前授权 |
| Memory | 上下文、长期记忆、摘要、向量记忆 | 命名空间、来源、撤销和跨会话清理 |
| Action | 工具、MCP、文件、API、shell、浏览器 | 最小权限、参数验证、沙箱和出口策略 |
| Impact | 数据、系统控制、持久化、业务中断 | 检测、回滚、取证、业务与资金限额 |

分类法与杀伤链是正交视角：前者回答“谁在什么阶段负责”，后者回答“攻击如何推进”。一个问题通常映射到多个格子，但只应有一个主 owner。

## 快速路由流程

1. 画出模型、数据、身份、工具、MCP、记忆和运行环境资产。
2. 标记每条输入、凭据、数据和动作的 owner 与信任转换点。
3. 选择一个主安全域和生命周期阶段。
4. 用六阶段链检查上游入口、推进条件和最终影响。
5. 为每个假设定义基线、单变量攻击、对照和证据。
6. 只把通过复现的结果标记为漏洞，未覆盖项单独记录。

## 可运行的最小映射

以下示例读取一个简化资产清单并输出需要覆盖的杀伤链阶段。它只生成测试计划，不执行攻击。

~~~json
{
  "components": [
    {
      "name": "mail-agent",
      "inputs": ["email", "rag"],
      "tools": ["read_document", "send_email"],
      "memory": "persistent",
      "sandbox": true
    }
  ]
}
~~~

~~~python
# map_agent_surface.py
import json
import sys

surface = json.load(open(sys.argv[1], encoding="utf-8"))
for component in surface["components"]:
    stages = {"Infrastructure", "Perception", "Planning", "Action", "Impact"}
    if component.get("memory") not in (None, "none"):
        stages.add("Memory")
    print(component["name"] + ": " + ", ".join(sorted(stages)))
~~~

~~~text
python map_agent_surface.py agent-assets.json
~~~

输出只是 coverage seed。后续必须补充角色、租户、网络、版本、数据流和具体控制。

## 证据与验证

- 资产图和 source commit
- system prompt/tool/MCP/Skill 的版本与 hash
- 角色/租户/凭据矩阵
- RAG 与记忆的写入者、检索权限和来源
- 沙箱、挂载、网络出口和资源限额
- 基线、攻击、对照的原始请求、工具结果和副作用
- 覆盖项、未覆盖项和 finding 状态

## 常见误判

- 把分类条目数量当成安全覆盖率
- 把旧 GAARM 编号当成稳定主键
- 把工具存在或模型回答异常直接当成越权
- 只测应用 Prompt，不测部署凭据、数据 owner 和基座隔离
- 只看单次会话，不测恢复、压缩和多 Agent 委派

## MCP/工具映射

| 任务 | 能力 |
| --- | --- |
| 枚举文件和配置 | glob、grep、read |
| 捕获页面与请求 | browser、HTTP fetch、代理 |
| 运行最小 probe | terminal/subprocess、容器 |
| 记录复现事实 | finding + artifact |
| 形成资产/攻击图 | diagram-generator |
| 输出正式报告 | docs-generator |

## 来源与编号说明

AISS 站点在 2026-08-23 的 sitemap 中包含 173 个五域风险页面；同日 api/v1/matrix 返回 72 个父项和 90 个子项，共 162 个枚举节点。两者统计口径不同。Pa55w0rd/secknowledge-skill 的 2026-06-17 快照按页面数整理出 173 行，但保留的旧 GAARM 编号存在重复和格式冲突。因此本页使用域、阶段、标题/slug 和来源快照定位条目，不发布旧编号。

- AISS 绿盟大模型安全智链社区：https://aiss.nsfocus.com/
- OWASP Top 10 for LLM Applications：https://owasp.org/www-project-top-10-for-large-language-model-applications/
- OWASP Agentic AI Security Initiative：https://owasp.org/www-project-agentic-ai-security-initiative/
- secknowledge-skill 审计 commit：078de3baa6b325f5acc5338c62169532e8f922b4（README 声称 MIT，但仓库无 LICENSE；本页未复制其正文）
