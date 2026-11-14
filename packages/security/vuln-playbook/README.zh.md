---
description: "离线 CVE/PoC playbook 语料与指纹匹配（ctx.vulnPlaybook、playbook_* 工具）"
kind: "package-reference"
---
# @cinlan/vuln-playbook

[English](README.md) | 中文

## 概述

本包附带一份离线漏洞 playbook 语料（`assets/knowledge` 下 176 个 Markdown 条目），并挂载 `ctx.vulnPlaybook` 服务和 `playbook_*` 工具集。`playbook_match` 把观察到的指纹——端口、banner、产品名、响应头或响应文本——与语料打分排序，返回候选条目和命中理由；`playbook_read` 返回单条完整正文；`playbook_list` 报告各分类条目数。匹配完全在本地进行：不联网、不起子进程、不执行任何代码。

## 使用本包

在任何提供了 `tools` 服务的组合里挂载。语料随包提供，安装和运行时都不下载；索引每次查询重建，语料改动无需重启即可生效。

条目是公开漏洞资料的整理（NVD、厂商公告、公开分析），在目标上复现前一律标记 `verified: false`。匹配结果只是候选指引，不是已确认漏洞——确认结论应经由 `finding_*` 工具和复现证据落地。

## 来源与排除项

语料导入自一份已审计的第三方 playbook 归档，来源哈希、各分类数量与许可说明见 `assets/resource-provenance.json`。playbook 正文中的回连端点均为占位符（`attacker`、`dnslog.cn`），无真实回连域、无面向模型的注入指令。原归档中的提示词替换配置、客户端 UI、HTTP 路由、运行时下载器和自动续跑均按设计排除，由原生 Cinlan 能力重写或取代。

## 模型体验

经由 `playbook_*` 工具间接生效，只有模型主动调用时结果才进入上下文。

#### KV Cache 影响

无直接影响；playbook 自身不向模型上下文注入任何文本。

## 已知限制与延期工作

- 匹配是关键词/指纹启发式排序，不是语义检索；指纹缺失可能漏掉相关条目。
- 语料是公开资料在某个时间点的整理，不随上游订阅源自动刷新。
