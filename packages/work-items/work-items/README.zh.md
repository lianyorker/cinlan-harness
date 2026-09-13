---
description: "Work Items package reference."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items

[English](README.md) | 中文

## 概述

本包实现 provider-neutral Work Items Service Definition，详细 runtime contract 见下方章节。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

WorkItemsRuntime 是标准化外部 Work Item 与持久化审批写入的 Service Definition。它注册 GitHub 和 Linear Provider，选择显式 source 或唯一可用的 Provider，转发有界读取并拥有 prepare/confirm/cancel write ledger。它不执行 HTTP、不解析凭据；持久化字节由 storageDomain 所有。

## Service API

| 成员 | 行为 |
|---|---|
| registerProvider(provider) | 为调用方 plugin lifetime 注册一个 github 或 linear Provider，并返回 disposer。 |
| list(request, signal?) | 按 request source 选择 Provider，返回有界的标准化 page。 |
| get(request, signal?) | 按配置 source 或 opaque id 前缀选择 Provider，返回一个 item。 |

详情响应必须保留请求的精确 item id；Provider 返回不同身份时以 invalid-response 失败。

Provider 选择在缺失、不可用或歧义时显式失败。每个返回 item 和 page 都会在 source、branded id、HTTPS URL、text、timestamp、collection、cursor 与 100-item 上限通过 runtime validation 后重建，因此 Provider-only 字段不能透传。Provider error 保留 authentication-required、forbidden、not-found、rate-limited、invalid-response 和 aborted 等安全分类。

## 外部写入与持久化

Provider 默认只读，allowWrites 显式启用创建、评论、状态和指派。prepareWrite 只验证并持久化不可变预览；confirmWrite 仅接受 operationId，重新验证 scope 与目标内容版本，不能用新参数替换获批内容。writeApprovalTtlMs 控制确认有效期，默认 300000 ms。cancelWrite 只取消未发送的预览。

写入需要 storageDomain；独立的 work_item_writes v1 保存操作与回执。网络副作用前先写 running；同一 Host 中并发或重复确认只分派一次，后续调用复用回执。顺序重启后，遗留 running 转为 unknown，不重发。若外部成功但本地回执落盘失败，也不能重新发送。未知结果必须去来源平台核实；确定失败需创建新预览，不自动重试。历史只返回指定来源最近 1–100 条，默认 UI 请求 20 条；记录不会自动删除。

状态完整集为 prepared、running、succeeded、failed、unknown、canceled、expired。版本预检不能代替外部平台的原子 compare-and-swap；预检后其他客户端仍可能修改工单。请勿用多个活跃 Host 同时写同一数据库。

## 模型体验

间接通过 tool-work-items Consumer，由它将标准化记录和写入回执呈现给模型。

#### 对 KV Cache 的影响

没有；Provider 注册和读取操作不会改变 model request prefix。

## 已知限制与暂缓事项

- 本 Service 不提供 external deletion；写入、评论、状态转换和分配通过 service-owned 的审批 ledger 执行，Workspace link 仍由 Host Consumer 投影。
- workspace link 是由 Host Consumer 提供的可选 projection；service 不解析 checkout 状态。


<a id="开发备注"></a>
### 开发备注

Provider credential 与 response normalization 保持在所属层。

No runtime invariant companion is published because Provider 响应在公共读取返回前校验并重建，注册释放由 Cordis effect 所有；服务不保留另一份权威数据。
