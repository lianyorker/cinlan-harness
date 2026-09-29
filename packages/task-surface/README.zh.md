---
description: "task-surface 组地图：声明式任务面板、纯 Session 投影与 show_task_surface 工具，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/task-surface

[English](README.md) | 中文

## 概述

task-surface 组为 agent 轮次中的人机协作提供统一的声明式任务面板抽象。它包含两个包：@deepseek-ai/dsh-task-surface 定义领域模型、校验规则、纯 Session 投影单元与服务注册表；@deepseek-ai/dsh-tool-task-surface 提供面向模型的 show_task_surface 工具，用于展示交互式表单并暂停执行直到人工提交或关闭。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`task-surface`](task-surface/README.zh.md) | 纯 Session 投影、声明式任务面板模型与提交协调器 | `ctx.taskSurface` |
| [`tool-task-surface`](tool-task-surface/README.zh.md) | 面向模型的工具，展示任务面板并暂停轮次等待用户输入 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [Session 投影子系统](../../docs/subsystems/session-projection.zh.md)——纯投影注册表与客户端状态模型。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-task-surface)——模型接收的 `show_task_surface` schema。
- [添加工具手册](../../docs/cookbook/adding-a-tool.zh.md)——工具规范、呈现器与 UI 卡片展示。
- [任务面板 Agent Note](../../.agents/notes/implemented/feature/2026-08-04-task-surface.zh.md)——统一任务面板设计与决策依据。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
