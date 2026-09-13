---
description: "任务协调能力家族。"
kind: "package-group"
---

# coordination/ - 轻量任务协调

[English](README.md) | 中文

## 概述

在独立选择调度、执行、所有权与隔离 provider 的同时协调小型任务图。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

此能力协调小型有向无环任务图。调度保持提供方无关；执行器可以在当前进程运行任务或把任务委派给子 agent。能力参考位于 [`coordination/`](coordination/README.zh.md)。

| Package | 角色 | Runtime surface |
|---|---|---|
| [`coordination/`](coordination/README.zh.md) | 任务身份、图校验、生命周期和扩展约定 | `ctx.coordination` |
| [`coordination-local/`](coordination-local/README.zh.md) | 带并发上限的进程内调度器 | 提供 `ctx.coordination` |
| [`coordination-subagent-executor/`](coordination-subagent-executor/README.zh.md) | One-shot subagent 执行适配器 | 注册一个执行器 kind |
| [`coordination-browser-element-capture/`](coordination-browser-element-capture/README.zh.md) | 经过校验的 Browser 元素 crop 持久化适配器 | 注册一个执行器 kind |
| [`tool-coordination/`](tool-coordination/README.zh.md) | 面向模型的 DAG、状态、等待、取消与消息 Consumer | 在 `ctx.tools` 注册六个工具 |

消息、审批适配器与审计投影通过独立 Listener 注册。持久化或远程 coordination 仍待后续提供方实现。

随附的 base 与 Web bundle 不挂载 Coordination。[`dsh-web-app`](../bundle/web-app/README.zh.md) 挂载本地调度器、由 `spawn` subagent 提供方支撑的 worktree 执行器，以及以 `worktree` 为默认执行器的 model-facing 工具。其他组合可以挂载普通 subagent 执行器或其他已注册执行器 kind。移除已配置的执行器后，新 run 会以 `EXECUTOR_UNAVAILABLE` 失败，不会静默 fallback。

<a id="dev-note"></a>
## 开发备注

该包组没有独立的 subsystem 页面；任务图 coordination 文档由组 README 与包 README 负责。
