---
description: "持久 UTC 自动化组合包地图，通过常规 Agent Session 执行任务。"
kind: "package-group"
---

# automation/ — 持久本地自动化

[English](README.md) | 中文

## Summary

自动化组拥有保存的定义、执行时刻准入和调用日志。每次获准执行都以显式工作区、模型、预设和权限输入创建常规 Agent Session。[自动化参考](../../docs/subsystems/automation.zh.md) 定义共享语义；各包文档拥有配置与运行限制。

## Table of Contents

- [组合包](#packages)
- [相关文档](#related-documentation)

<a id="packages"></a>
## 组合包

| 组合包 | 职责 |
|---|---|
| [automation](automation/README.zh.md) | 独占本地调度、持久认领与历史，以及通过既有 Agent 生命周期执行。 |

<a id="related-documentation"></a>
## 相关文档

- [自动化 API](../api/automation-controller/README.zh.md) 提供浏览器命令与已提交状态更新。
- [自动化设置](../client/ui-settings-automation/README.zh.md) 提供创建、检查和显式执行控件。

## Dev Note

此组拥有跨工作区保存的自动化。Session 内的提醒继续归 [schedule 包](../schedule/schedule/README.zh.md) 所有。
