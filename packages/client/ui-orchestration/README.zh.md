---
description: "配置主机工具并行度，并查看 Agent 预设中已求值的工作流与委派能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orchestration

[English](README.md) | 中文

## 概述

使用编排设置可保存主机的并行工具调用上限，并检查各 Agent 预设中的工作流工具、委派工具和工作流引擎。页面首屏保持紧凑：能力卡片显示当前状态、并行度控件和简短覆盖摘要，详细引擎与预设条目默认收在折叠说明中。能力状态来自已求值的插件条目，包括禁用、条件未确定、等待及失败状态。预设文件与工作流引擎上限仍由所属组成配置管理。

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

与设置、语言、槽位和 Remote 服务一起挂载本浏览器插件。它提供编排页面，没有插件配置字段。

并行工具调用通过设置作用域写入 `agent-loop.maxParallelToolCalls`。保存接受正整数；恢复继承值会移除用户覆盖。主机调度器在下一组工具调用中读取已提交值。已开始的调用组保留其捕获的限制，PTC 子调用使用独立的组成设置。主机设置只读或不可用时禁用编辑。保存被拒绝后保留草稿，设置刷新后仍需用户明确重试。

能力检查读取当前主机清单。「已配置」表示插件已启用但没有运行中的实例；「已激活」表示插件生命周期状态，不验证提供商连接。页面分别报告主机引擎条目与各预设的引擎。Web 组成禁用主机工作流引擎，在预设内挂载引擎。工作流并发数与 Agent 总数上限需要在拥有该引擎的组成配置中编辑。搜索工作流限制或预设覆盖时，会先展开说明，再定位对应锚点。

搜索只索引本地化字段标签与说明，不包含当前值或预设内容。设置卡片下方还会展示 Workflow、Parallel 和 Pipeline 三种简短协作示例。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

设置作用域提供共享描述镜像、写入串行化、版本校验及重连恢复。页面把输入草稿与观察到的状态分开保存。分区元数据及本地化字段描述与页面槽位一起注册，在声明移除或插件释放时一起消失。

[覆盖投影](src/client/view.ts)在结构化清单中匹配第一方模块的精确说明符，不在浏览器解析组装文本或执行表达式。[注册入口](src/client/index.ts)将这些读取和修改操作连接到[页面](src/client/OrchestrationSection.tsx)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下所有者定义持久化、组成及执行语义。

- [设置](../ui-settings/README.zh.md)——共享主机设置镜像与修改队列。
- [Agent 预设](../ui-agent-preset/README.zh.md)——内置预设只读，以及自定义预设复制、打开和删除操作。
- [插件清单](../../host/plugin-inventory/README.zh.md)——已求值的主机与预设条目。
- [Agent 循环](../../core/agent-loop/README.zh.md)——工具调用调度。
- [工作流 Worker 引擎](../../workflow/workflow-worker-thread/README.zh.md)——由组成配置管理的工作流限制。

-----

<a id="model-experience"></a>
## 模型体验

间接通过消费已保存执行限制的主机 agent loop（智能体循环）生效；本浏览器插件不注册面向模型的工具或提示词段落。

#### KV Cache 影响

无；读取能力状态与保存调度限制不会改变运行中会话的提示词前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

页面区分观察到的组成配置与已验证的执行。

- 能力检查识别第一方工作流及委派模块说明符。第三方替代实现需要自己的能力报告。
- 清单 API 不提供工作流引擎配置值。页面无法编辑或报告这些引擎实际的并发数与 Agent 总数上限。
- 插件生命周期状态不验证提供商连接。「重新检查」在组成配置变化后重新加载清单。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本浏览器插件投影主机拥有的设置与清单，Node 入口不拥有独立可变状态。
