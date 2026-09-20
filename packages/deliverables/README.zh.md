---
description: "deliverables 包组：逐轮工作区改动记录与对比，供选择记录器的用户和维护者阅读。"
kind: "package-group"
---

# packages/deliverables

[English](README.md) | 中文

## 概述

本组让客户端展示轮次中哪些工作区文件发生了改动，并对比其内容。workspace-changes 包记录 git 快照和文件工具捕获，再为每个存活 Session 提供摘要与对比。用户需要审阅轮次文件改动时可选择本组。Web 产出物插件负责渲染结果。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组拥有工作区改动记录；客户端展示归 Web 插件所有。

| 包 | 角色 |
|---|---|
| [workspace-changes](workspace-changes/README.zh.md) | 逐轮记录改动文件，提供摘要和逐文件对比 |

<a id="related-documentation"></a>
## 相关文档

- [Web 产出物](../client/ui-deliverables/README.zh.md)——展示轮次结果。
- [Session 子系统](../../docs/subsystems/session.zh.md)——宣告已完成工作的持久事件。
- [子进程能力](../subprocess/README.zh.md)——管理 git 进程。

<a id="dev-note"></a>
## 开发备注

无。
