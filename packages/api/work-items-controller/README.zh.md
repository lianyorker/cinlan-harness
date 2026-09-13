---
description: "Work Items Remote 宿主端与 Workspace 归属控制器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-work-items-controller

[English](README.md) | 中文

## 概述

本包持有 Host 端 `workItems` Remote 命名空间。它通过服务持有的账本提供预览/确认/取消/历史操作，读取标准化 Provider item，并持久化 item 到 Workspace 或 Session 的显式关联，不保存凭据、Provider response body 或 checkout path。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在 `dsh-work-items`、`dsh-workspace` 与 `dsh-storage-domain` 之后挂载本包。生成的 `./remote` contribution 由官方 `dsh-api-remotes` assembly 消费。

<a id="understand-the-implementation"></a>
## 理解实现

[Settings UI](../../client/ui-work-items/README.zh.md) 使用生成的 Remote 方法。

控制器在接受关联前验证 Workspace 归属，串行化本地写入，并只投影已注册 Workspace 与未归档的所属 Session。Provider failure 会转换为分类的 `RemoteError`，不会暴露 response body 或 credential value。

<a id="model-experience"></a>
## 模型体验

无。本 Host API 只提供面向用户的 Remote transport，不注册 prompt、tool、Session event 或 model request content。

#### KV Cache 影响

无；控制器不改变模型请求前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 外部写入需要 Provider 显式启用；控制器不提供自动重试或任意 HTTP 操作。
- 控制器不发现 Provider scope，也不暴露任意 Provider URL。

<a id="dev-note"></a>
### 开发备注

生成的 Host 与 Remote artifact 由仓库 Typert build 生成；请修改 `src/types.ts` 与 `src/index.ts`，不要直接修改 `lib/typert.*`。

No runtime invariant companion is published because 关联写入由 storageDomain 原子提交，实时分支状态读取权威租约；没有单独维护且可能偏离的业务投影。

prepareWrite/confirmWrite/cancelWrite/listWrites 直接委托公共服务的持久化审批 API；只确认 operationId，不能提交替换字段。本地 associate/disassociate 与外部工单写入保持独立。
