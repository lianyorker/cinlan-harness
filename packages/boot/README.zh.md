---
description: "boot 包组：dsh app bin 如何启动——环境加载、profile 与 patch 层、清晰的启动失败信息，以及由应用持有的命令行。"
kind: "package-group"
---

# boot/：共享的 app bin 启动粘合层

[English](README.md) | 中文

## 概述

boot 组启动 dsh 应用并管理运行中 profile 的组合。`app-boot` 加载环境与 patch 层；`cmdline` 提供由应用持有的 flag 和退出处理。这些库由 `apps/cli` 与测试专用 Loader fixture 导入。`plugin-manager` 运行时插件列出 profile 的 Plugin 和 bundle，并管理持久化修改与安装。各包 README 负责各自的约定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`app-boot`](app-boot/README.zh.md) | 从 `cordis.yml` 启动 dsh 应用：加载 `.env`、应用 profile 与 patch 层，并清晰报告启动失败 | （供各 bin 使用的库） |
| [`cmdline`](cmdline/README.zh.md) | 让应用持有自己的 flag、`--help` 与退出码；启动器自身 flag 之后的一切原样传入 | `cmdlineArgs`、`appExit` |
| [`plugin-manager`](plugin-manager/README.zh.md) | 列出运行中 profile 的 Plugin 和 bundle，并管理持久化组合与包安装 | `pluginManager` |

<a id="related-documentation"></a>
## 相关文档

- [Profile 管理](../../docs/subsystems/profile-management.zh.md)——生成的 service 与事件参考。
- [dsh 应用](../../apps/cli/README.zh.md)——在其启动序列中使用这些 helper 的 `dsh` bin。
- [Profile 组合包](../bundle/README.zh.md)——可由 `dsh --profile` 组合挂载的可安装 patch 层。
- [dsh-home-paths](../util/home-paths/README.zh.md)——两个包都依赖的 harness home 解析器。
- [dsh-cmdline](cmdline/README.zh.md)——flag 家族如何由应用持有而非启动器。

<a id="dev-note"></a>
## 开发备注

无。
