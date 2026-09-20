---
description: "在当前 Web profile 中安装、启用、停用和移除 bundle。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-manager

[English](README.md) | 中文

## 概述

管理当前 Web profile 中已安装的 bundle 和可独立定位的插件。安装可流式输出诊断、按请求取消，并在失败或取消后恢复 manifest 和 lockfile。实时 profile 立即应用配置变化；仅启动时应用的 profile 保留运行中的组合，直到重启。变化影响使用该 profile 的所有会话。Desktop 包事务仍由 Desktop shell 持有。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

profile 组合在 Host 插件清单旁挂载本服务。launcher 通过 `profileContext` 提供当前 profile。服务的 Remote 方法向可信客户端提供 bundle 检查、安装、移除、启停和取消功能。插件配置表单仍由对应的 settings namespace 和客户端插件持有。

可选的 `@deepseek-ai/dsh-plugin-manager/tools` 入口为 Cordis 预设注册 `plugin_manager`。每项操作（包括查询）均要求完全权限或仅针对本次调用的审批；审批不改变 Session 权限模式。安装脚本权限要求人类显式批准，与工具调用审批分别处理。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `pnpmCommand` | `pnpm` | Pnpm 可执行文件名或路径；应用提供的调用参数优先。 |
| `inspectTimeoutMs` | `20000` | 注册表查询的最长持续时间，单位为毫秒。 |
| `outputBytes` | `16384` | 返回的诊断字节上限；完整输出保留在返回的日志路径中。 |
| `lockWaitMs` | `120000` | profile 写锁的最长等待时间，单位为毫秒。 |

插件开关只改变 profile patch 中最后一个匹配 override 的 `disabled` 字段，或追加 override。bundle 开关改变有序的 `dsh.profile.bundles` 列表并保留依赖。启用会追加 bundle，因此可能改变优先级。home 和调用 overlay 保持更高优先级。

安装默认启用有效 bundle。调用方生成的请求 id 将进度、日志块和取消操作关联到一次安装。只有 pnpm 退出且 manifest 与 lockfile 恢复后，取消才报告成功。开始激活后，取消返回 `too-late`。安装失败会恢复这两个文件；已下载文件和诊断日志可能保留。

pnpm 阻止依赖脚本时，结果列出待决定的包名。重试可通过 `approvedBuilds` 显式允许这些名称。允许记录按包名保存在 profile 的 pnpm workspace 设置中，之后安装失败也会保留。已有拒绝、通配符规则、别名和锚点不能通过该操作覆盖。已允许的脚本以宿主用户权限执行。

移除先取消 bundle 选择，等待其运行时贡献卸载，再执行 pnpm 移除。某阶段失败会停止操作并保留已完成阶段。仍在使用的包不能移除。管理组件不能停用自身。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

管理器在共享 manifest 文件锁下写入 profile 文件。Pnpm 在配置队列外执行；bundle 选择与 Loader 协调在队列内执行。Cordis 模块重载与配置监视器通过同一队列处理 profile 与 home patch 及 manifest 选择变化。每次重载保留本地模块解析器并刷新 profile 链接，再等待移除的资源与结果 Loader 树。未改变的非活动条目产生警告；新失败条目以及显式启用却仍未激活的目标使变化失败。

每个写入 Remote 在取得锁或修改文件前检查 launcher 与 profile 标识。launcher 提供的 `pluginManagementHost` 通过受保护的条目 id 和应用自有的 patch 读取器，允许单独启停条目。Desktop 拒绝 bundle 选择和包括注册表查询在内的包操作；这些事务由原生壳持有。其 patch 读取器保留必需 overlay，不修改共享的 CLI 解析器链接。模块代码 HMR 与 profile 管理共用一个生命周期队列。嵌套 profile 配置会被拒绝；已处于 HMR 代次中的 watcher 回调会直接完成，不会排在自身后面等待。销毁会先关闭新任务接纳和 watcher，再等待队列。不发布不变式伴生入口：管理器直接读取文件与 Loader 状态，没有独立投影。

公共记录位于 [types.ts](src/types.ts)。[operations.ts](src/operations.ts) 持有子进程输出、环境清理与包协调；[patch.ts](src/patch.ts) 保留 YAML 注释和无关字段；[build-approval.ts](src/build-approval.ts) 持有显式脚本权限。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [App boot](../app-boot/README.zh.md)——profile 各层、重载策略和模块解析。
- [插件清单](../../host/plugin-inventory/README.zh.md)——当前 Loader 与预设观测。
- [插件设置](../../client/ui-settings-plugins/README.zh.md)——Settings 中的配置表单。

-----

<a id="model-experience"></a>
## 模型体验

### 管理工具 schema 与结果

#### 模型看到的内容

启用 `./tools` 入口后，模型获得[生成目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-plugin-manager)中描述的 `plugin_manager` 工具，以及包含 `entries`、`total` 和 `nextOffset` 的 JSON 清单分页或所选操作的结果。受管理插件可向后续模型请求贡献工具和提示词分节。

#### Token 影响

管理工具启用时增加其 schema，每次调用增加一个文本结果。清单响应最多包含请求的 `limit` 条记录，上限为 100 条；其他结果的长度取决于所选操作。

#### KV Cache 影响

启用管理工具会将其 schema 和执行结果加入模型请求。启用或停用插件可能改变之后的工具声明、提示内容及其缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Desktop 事务使用 shell 既有的独占暂存、健康检查和激活路径。
- 替换已加载的 JavaScript 包需要重启进程才能取得新的模块世代。
- 仅启动时应用的 profile 不能移除运行进程仍在使用的包。
- 管理影响整个 profile；Agent 预设组合仍为只读。
- 移除失败可能留下部分改变的依赖。安装恢复不会删除已下载文件或诊断日志。
- 本集成不声明可选 bundle 目录；清单记录报告 `optional: false`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
