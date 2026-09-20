---
description: "实验组地图：公开的浏览器、计算机操作与 Auto review 引入包，以及私有原型，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/experimental

[English](README.md) | 中文

## 概述

通过本组可以试用实验性的浏览器控制、计算机操作、Auto review、Agent Teams、检查工具与替代运行时。[公开发布允许列表](../../scripts/experimental-package-policy.ts)中的七个官方引入包随 dsh 共享版本发布；发布不意味着默认启用，也不承诺 API 稳定性。本组其他包保持私有，并排除在正式发布之外。已发布包可以依赖列表中的公开引入包，但不得依赖私有包。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`agent-team-profile`](agent-team-profile/README.zh.md) | Agent Teams 的显式源码 checkout profile 层 | — |
| [`agent-team`](agent-team/README.zh.md) | 具名 teammate，成员之间持久消息与共享任务板 | `ctx.agentTeams` |
| [`agent-team-web-profile`](agent-team-web-profile/README.zh.md) | Agent Teams 的显式源码 checkout Web 层 | — |
| [`auto-review`](auto-review/README.zh.md) | 为 Auto 权限预设逐次执行模型授权审查 | — |
| [`browser-use-runtime`](browser-use-runtime/README.zh.md) | 共享 Session 浏览器资源与 MCP 激活 | 库，不使用 ctx key |
| [`browser-use-playwright-mcp`](browser-use-playwright-mcp/README.zh.md) | 通过 Playwright MCP 提供 Chromium 工具 | — |
| [`browser-use-chrome-devtools-mcp`](browser-use-chrome-devtools-mcp/README.zh.md) | 通过 Chrome DevTools MCP 提供 Chromium 工具 | — |
| [`browser-use-stagehand-native`](browser-use-stagehand-native/README.zh.md) | 使用显式配置的模型执行 Stagehand 浏览器操作 | — |
| [`client-ui-agent-team`](client-ui-agent-team/README.zh.md) | Web Team roster、任务板与 teammate 导航 | — |
| [`code-runtime-python`](code-runtime-python/README.zh.md) | 代码执行 seam 的 CPython 子进程后端 | `ctx.codeRuntime` |
| [`computer-use-cua-driver-mcp`](computer-use-cua-driver-mcp/README.zh.md) | 通过已安装的 Cua Driver MCP 可执行文件提供桌面工具 | — |
| [`computer-use-cua-driver-native`](computer-use-cua-driver-native/README.zh.md) | 通过 Cua Driver 原生 npm SDK 提供桌面工具 | — |
| [`inspector`](inspector/README.zh.md) | 用于 Host 调试、Client Runtime 检查、网络采集与 Cordis 树的跨 realm CDP hub | `ctx.inspector` |
| [`tool-agent-team`](tool-agent-team/README.zh.md) | 让模型创建、发消息与协调 teammate 的九个工具 | 按作用域注册工具到 `ctx.tools` |
| [`webworker-packer`](webworker-packer/README.zh.md) | 构建浏览器 worker 预览所消费的 gzip 压缩 VFS 镜像 | 库与 CLI，不使用 ctx key |
| [`webworker-runtime`](webworker-runtime/README.zh.md) | 在专用浏览器 worker 中运行 harness 插件树 | 库与 worker 入口，不使用 ctx key |

-----

<a id="related-documentation"></a>
## 相关文档

- [实验包决策](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md)——私有原型的位置与依赖隔离；七个公开引入包遵循上述允许列表。
- [Agent Teams 子系统](../../docs/subsystems/agent-team.zh.md)——持久 Team 类型与 `ctx.agentTeams` 服务 API。
- [实验子树规则](AGENTS.md)——实验状态放宽了什么、不放宽什么。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
