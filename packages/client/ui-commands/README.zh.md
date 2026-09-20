---
description: "Web GUI 的斜杠命令：客户端动作与弹窗选择器、宿主命令输入，以及按会话发现命令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-commands

[English](README.md) | 中文

## 概述

在 composer 中键入 `/` 命令会打开选择器、运行客户端动作或提交宿主命令。业务包可以添加客户端命令，或装饰宿主命令的裸调用，同时仍将文本参数交给宿主。命令查找使用当前会话的目录，查找失败绝不会将命令静默降级为普通提示词。

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

与 `ui-input-trigger` 及 `ui-conversation` 一起挂载本插件；`/` source 随即出现在触发菜单中，业务包经 `ctx.commandUi` 注册自己的命令表面。键入 `/model` 打开已注册的弹窗；带参数声明的宿主命令打开其输入或直接执行。

### 种类与装饰

贡献项是客户端自有命令；与宿主命令同名会明确报错。装饰为已存在的宿主命令添加裸调用弹窗或动作。宿主保留其目录行、参数声明以及已执行命令的生命周期记账；没有宿主目录行的装饰永不触发。菜单查询按顺序且不区分大小写地模糊匹配命令名的子序列；前缀排名最高。

### 带附件提交

`action` 请求受守卫保护的 token 消费，然后以调用时的会话运行同步回调。它不提交内容，并将附件留在 composer 中，即使 token 守卫未命中也如此。其他带附件提交要求宿主命令声明 `input.attachments`；弹窗路径与不接受附件的宿主命令会抛出本地化的 `attachmentsUnsupported` 拒绝，保留草稿和附件卡。处理器返回错误时保留相同草稿状态供用户重试。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[`src/client/contract.ts`](src/client/contract.ts) 定义经 `ctx.commandUi` 注册贡献项与装饰的 API。裸菜单选择或回车调用已注册的 `popupSelect` 或 `action`；空格与带参数的回车保留宿主输入声明。动作在运行前请求消费 token：菜单选择使用捕获的范围与草稿修订号，裸回车则检查去除首尾空白后的草稿是否仍等于 token。输入归属方执行这两种守卫。`CommandDirectory` 缓存各会话的宿主目录，在宿主变化或连接重置时使其失效，并拒绝过期的获取结果。宿主执行返回匹配结果后，浏览器发布本地 `command/executed` 确认；其他客户端收到持久命令节点。`PopupSelectController` 拥有选择器状态，`PopupSelectView` 经 `conversation.input.overlay` 渲染。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当命令面不够用时阅读以下页面。它们从命令 API 进入触发流水线与宿主命令注册表。

- [ui-input-trigger](../ui-input-trigger/README.zh.md)——`/` source 注册进的流水线。
- [ui-conversation](../ui-conversation/README.zh.md)——声明输入浮层槽位并拥有 composer。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由派发路径触发的宿主 `command.execute` RPC：每个命令 handler 的宿主包拥有任何模型可见效果（`/plan` 的 handler 翻转 plan 模式，其归属包注入 policy 段），而命令行、分离结果与所有菜单和 notice 渲染都留在客户端，永不进入会话日志。

#### KV Cache 影响

无直接影响；该包既不组装也不发送提供方请求。它触发的命令 handler 可能改变归属宿主包对下一个请求系统提示词的贡献——某个 section 的出现或消失会替换较早的请求 token，并使提供方前缀从该点起失效——但这一影响由各命令的宿主包拥有并记录。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前命令表面。它们是当前包约束，不是通用命令行对比或任务积压。

- **脱离会话后，分离结果 notice 回退到 console**——fire-and-forget 路径经 `SessionInput.notify` 把结果送到触发会话的 composer；会话销毁后，console 输出行是仅剩的呈现面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这是基于 wire command directory 的浏览器侧 source，不发出 Cordis 事件，也不持有跨插件可变状态；dispatch 与 cache 行为由包测试覆盖。
