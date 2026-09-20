---
description: "通过受管 Node 进程执行 PTC 并提供可选 CodeRuntime 兼容能力的包映射。"
kind: "package-group"
---

# ptc-runtime/——Node 程序执行

[English](README.md) | 中文

## 概述

本组提供 tools 与 workflow 消费的 PTC 服务及 Node 进程提供方。程序调用宿主绑定并返回捕获的日志与 JSON 值。自定义 CodeRuntime 消费方可使用可选兼容适配器。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

直接消费方使用服务接口，运行时组合使用提供方。

| 包 | 职责 | 服务 |
|---|---|---|
| [ptc-runtime](ptc-runtime/README.zh.md) | 定义显式请求解析、绑定、执行结果及取消 | `ctx.ptcRuntime` |
| [ptc-runtime-node](ptc-runtime-node/README.zh.md) | 在受管 Node 进程中执行程序，并提供可选 CodeRuntime 兼容适配器 | `ctx.ptcRuntime`；可选 `ctx.codeRuntime` |

-----

<a id="related-documentation"></a>
## 相关文档

- [PTC 运行时子系统](../../docs/subsystems/ptc-runtime.zh.md)——执行请求、结果与提供方生命周期。
- [既有代码运行时](../code-runtime/README.zh.md)——供自定义消费方使用的兼容 API。
- [SSH 提供方](../ssh/README.zh.md)——共享远端文件系统、进程与沙箱坐标。
- [能力 seam](../../docs/capability-seams.zh.md)——服务定义、提供方与消费方。

<a id="dev-note"></a>
## 开发备注

可选适配器保留既有 CodeRuntime 接口。其包 README 负责说明失败分类、策略选择及结果元数据的差异。
