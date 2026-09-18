---
description: "带版本的 MCP 管理 Remote 与可取消的实时快照。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-controller

[English](README.md) | 中文

## 概述

`mcp` Remote 命名空间向设置页面提供[当前配置档的 MCP 管理服务](../../mcp/mcp-management/README.zh.md)。它返回带凭据引用的期望定义、观测到的生命周期状态和发现的工具。它不会改写外部组合、返回凭据值或调用 MCP 工具。

## 目录

- [使用 Remote](#use-the-remote)
- [发布与生命周期](#publication-and-lifetime)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-the-remote"></a>
## 使用 Remote

读取完整快照，或打开 `watch`，立即获得快照及后续完整替换。消费者暂停时，流会合并更新；调用方取消或控制器卸载时关闭。在保存、移除或更改期望启用状态前读取配置档版本；发生冲突后需要重新读取，并显式进行新的编辑。

Save、removeServer、setEnabled、reconnect 和 probe 委托给管理服务的对应操作。Probe 表示在已初始化且拥有的连接上刷新工具。它不启动已禁用的服务器，也不执行工具。保存成功确认期望配置已持久化，不代表就绪；快照中的观测阶段独立报告激活成功或失败。

[请求与响应类型](src/types.ts)重新导出管理服务的定义。预期的操作错误使用固定 `mcp/*` 错误码。未分类错误使用固定内部诊断；上游异常文本和凭据不会复制到 Remote 错误中。外部行公开其真实拥有者，本 API 不提供变更这些行的操作。

<a id="publication-and-lifetime"></a>
## 发布与生命周期

Host 服务依赖 `typert` 和 `mcpManagement`。生成的 `./typert` 与 `./remote` 入口发布 Host 描述与 Client 命名空间。控制器只保留流生命周期和待发送的替换快照；管理服务拥有持久化状态、连接权限和验证。此控制器不拥有独立的持久化投影，因此不发布不变量伴随插件。

<a id="model-experience"></a>
## 模型体验

间接影响，经由 MCP 管理服务执行本 Remote 请求的连接变更。

#### KV Cache 影响

控制器不组装模型请求。工具集合变化具有桥接器常规工具 schema 前缀的影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

本 API 涵盖活动配置档所管理的根服务器，以及外部根连接的只读观察。它不提供跨配置档选择器、OAuth 流程、MCP 资源或 MCP 提示词。完整快照侧重当前状态，不提供历史转换日志。
