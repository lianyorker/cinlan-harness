---
description: "dsh Web 客户端通用设置里的并行工具调用数行：agent-loop 命名空间的并行工具调用上限。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-agent-loop

[English](README.md) | 中文

## 概述

打开设置 → **通用设置**，即可设置一步之内最多同时运行多少个可并行的工具调用。行内是即时生效的数字输入：每敲入一个合法整数就立即写入，被覆盖过的值旁有**恢复默认**。行只在 Host 服务 `agent-loop` 命名空间期间存在。

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

通用设置里的**并行工具调用数**行限制循环在一步之内同时运行的调用数。输入框即时生效：敲入的每个不小于 1 的整数都会写入，无效输入不写入、失焦后回到生效值；清空并失焦等于重置回部署默认值。被覆盖过的值旁有**恢复默认**。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧通过 `ctx.configForms.get` 绑定 `agent-loop` 命名空间，`AgentLoopCardController` 直接镜像共享配置表单的生效值、覆盖状态与可写性，写入走表单的 `set`/`unset`；`AgentLoopCard` 通过 `ctx.configForms.whileServed` 注册进通用设置的行 slot。行文案在本包的 `settings.agentLoop` 字典里。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings-general](../ui-settings-general/README.zh.md)——全页 Settings 外壳及其智能体导航分组。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与"命名空间被服务期间"的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——本页渲染的设置表单模型与字段。
- [agent-loop](../../core/agent-loop/README.zh.md)——注册 `agent-loop` 命名空间的循环。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只编辑命名空间的一个字段**——Host 的这一节只承载并行上限；组合进来的 `agents` 数组属于启动组合而非用户设置，这里没有对应字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
