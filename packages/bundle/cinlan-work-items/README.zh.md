---
description: "可选原生 Work Items 组合，外部写入默认关闭。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-work-items

[English](README.md) | 中文

## 概述

此 bundle 组合原生 GitHub/Linear Provider、Work Items 注册表与写入账本、模型工具、Host Remote controller 和本地化 Web Settings 页面。可选 work-items profile 包含它；普通 Web profile 不挂载它。

## 目录

- [组合](#composition)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="composition"></a>
## 组合

将此 bundle 放在 dsh-base 和 dsh-web-app 之后。Provider 范围由部署配置：GitHub 需要 owner/repository；Linear 需要 team 或 project。凭据通过 Host 凭据引用解析。未配置范围时 Provider 保持不可用，不猜测账户并连接。

以下仓库命令输出受支持的 profile 组合，不启动服务器：

~~~sh
pnpm dsh --profile work-items --dump-config
~~~

两个 Provider 默认都是 allowWrites: false。后续 patch 可启用 Provider，但每次修改仍需持久化预览和独立确认。卸载 bundle 会移除它的工具和 Settings 页面，不删除已保存的关联或回执。

<a id="model-experience"></a>
## 模型体验

间接通过 [工具 Consumer](../../work-items/tool-work-items/README.zh.md)，由它提供 list/get 与 prepare/confirm/cancel/history 工具及稳定指引。

#### KV Cache 影响

bundle 挂载期间，工具 schema 和指引会在请求前缀中增加固定内容。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 尚不提供 Provider 范围发现、专用凭据/配置 UI、GitHub Enterprise 地址或自动同步。
- 真实 GitHub/Linear 账户需要单独验证；本地测试只替换外部 HTTP，不替换原生 Provider。

<a id="dev-note"></a>
### 开发备注

本包不发布 runtime invariant companion，因为它只拥有静态组合，不持有独立运行时状态。服务、持久化和 UI 行为保留在各自所属包中。
