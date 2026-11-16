---
description: "持久化任务台账（ctx.engagementLedger、campaign_* 工具），按评估授权范围校验资产"
kind: "package-reference"
---
# @cinlan/engagement-ledger

[English](README.md) | 中文

## 概述

本包挂载 `ctx.engagementLedger` 服务和 `campaign_*` 工具集：给已授权的安全评估做持久化台账——资产、指纹、步骤、PoC 尝试记录，以及 `recon → fingerprint → match → verify → exploit → lateral → report` 阶段推进。台账写在 `<clh home>/security/engagement-ledger/campaigns.json`（临时文件 + 改名落盘），完全被动：不触发续跑、不起 agent、不产生网络行为。资产携带评估的关联面：finding id 与凭据引用名跨多次 upsert 按并集累积；云作用域资产以账户 id 作为 host 记录其 `{ provider, accountId }` 身份。

## 使用本包

挂在同时提供 `tools`、`assessmentScope`、`vulnPlaybook` 的组合里。`campaign_create` 会把**当前** root grant 的目标快照进任务，空授权直接拒绝；每次 `campaign_upsert` 写资产都会拿 host 重新对**活的** `ctx.assessmentScope` root grant 校验（精确匹配、`*.` 后缀、`url-prefix` 主机名、IPv4 CIDR，并尊重 `excludedTargetIds`）。改 profile 的授权即改变台账可接受的范围——快照只是留痕，不是旁路。

`campaign_next` 返回阶段指引、待处理资产、按指纹给出的 playbook 候选（经 `ctx.vulnPlaybook`），以及连续两轮无进展时的停滞提示——每调一次算一轮。

## 来源

移植自已审计第三方插件（`dsh-prompt-custom`）的任务台账。移植时移除：自动续跑引擎（`agent.followup`）、插件自建的 scope 字段、HTTP/UI 面。新增：作用域校验改为对接原生 assessment grant 而非重复实现，attempt 参数扁平化，`campaign_create` 以非空 grant 为准入条件。

## 模型体验

经由 `campaign_*` 工具间接生效；台账自身不往模型上下文注入任何文本。

#### KV Cache 影响

无直接影响；任务状态只通过模型主动调用的 `campaign_*` 工具结果进入上下文。

## 已知限制与延期工作

- 台账只记录不授权——真实效果仍由 `assessment-scope-tool-policy` 在工具调用时把关。
- `rounds`/`lastProgress` 只产生提示，没有任何自治循环消费它们。
