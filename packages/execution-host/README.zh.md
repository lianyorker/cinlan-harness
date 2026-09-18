---
description: "用于可信 artifact provenance 的 execution-host identity provider。"
kind: "package-group"
---

# execution-host/ — execution-host identity 能力

[English](README.md) | 中文

## 概述

为每个执行主机发布稳定标识，并管理用于显式有界检查的 SSH 目标。本地来源信息与远程 Session 路由分开；本组不提供后者。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`execution-host/`](execution-host/README.zh.md) | provenance 与授权使用的 execution-host identity 约定 |
| [`execution-host-local/`](execution-host-local/README.zh.md) | 提供不可变宿主 identity 事实的本地进程 provider |
| [`execution-host-targets/`](execution-host-targets/README.zh.md) | 保存目标记录、严格 OpenSSH 连接与活动检查所有权 |
| [`execution-host-worker/`](execution-host-worker/README.zh.md) | 采用显式导出根目录及版本化检查消息的 stdio worker |

<a id="dev-note"></a>
## 开发备注

<details>
<summary>供维护者展开的工作上下文</summary>

[Execution Host 子系统参考](../../docs/subsystems/execution-host.zh.md)列出生成的 Cordis API 与事件；身份、目标和 worker 协议约定仍由各包 README 负责。

</details>
