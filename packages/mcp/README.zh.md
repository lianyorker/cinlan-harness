---
description: "MCP 包组：挂载外部 Model Context Protocol 服务器，让它们的工具可以作为原生工具调用。"
kind: "package-group"
---

# MCP — 模型上下文协议

[English](README.md) | 中文

## 概述

`mcp/` 组把 harness 连接到 Model Context Protocol（MCP）工具服务器生态。客户端挂载外部服务器，让模型以稳定的服务器限定名称调用工具；资源服务让模型按需发现与读取服务器内容。每台服务器是一条配置项；默认不启用任何服务器，因此按需逐台开启。不支持 MCP 提示词模板。本页映射该组；逐包约定由包 README 负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组包含 MCP 传输桥接与当前 profile 管理；各包 README 负责包级行为细节。

| 包 | 提供的能力 |
|---|---|
| [`mcp-client/`](mcp-client/README.zh.md) | 挂载一台外部 MCP 服务器，让模型可以把它的工具当作原生工具调用 |
| [`mcp-resources/`](mcp-resources/README.zh.md) | 通过共享工具发现资源分页与 URI 模板并读取内容 |
| [`mcp-management/`](mcp-management/README.zh.md) | 持久化当前 profile 的服务器定义，并拥有其连接生命周期 |

-----

<a id="related-documentation"></a>
## 相关文档

先用可运行的示例配置体验插件，再阅读 Agent Note 了解其背后的行为决策。

- [MCP 客户端插件 Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.zh.md)——桥接的设计：服务器限定命名、发现、执行与环境清洗。
- [第三方记忆 MCP 指南](../../docs/user/guide/mcp-memory.zh.md)——可运行的 overlay 配置行与设置说明。
- [MCP 子系统参考](../../docs/subsystems/mcp.zh.md) — 连接快照、带修订号的管理请求与 Cordis API。
- [工具子系统参考](../../docs/subsystems/tools.zh.md)——接收已注册工具的 `ToolRuntime`。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
