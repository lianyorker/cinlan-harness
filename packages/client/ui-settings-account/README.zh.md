---
description: "用于一次账户登录、授权 prompt 与显式退出本地登录、由功能自身拥有的 Cinlan 账户设置 UI。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account

[English](README.md) | 中文

## 概述

此浏览器插件在设置中添加 Cinlan 账户区段。它显示固定 Cinlan 账户的登录状态、启动账户密码登录、渲染调用方持有的 notice 与 prompt、遮蔽 secret 答案，并只在明确警告不会吊销远程访问后移除本地账户凭据。提供方和模型配置不属于此区段。

## 目录

- [使用账户设置](#use-accounts-settings)
- [状态与组合](#state-and-composition)
- [安全](#security)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-accounts-settings"></a>
## 使用账户设置

打开设置，然后进入 Cinlan 账户。页面显示一个账户卡片、本地连接状态和一个登录操作。账户登录使用 Cinlan 邮箱和密码；如果服务要求双因素验证，还会显示遮蔽的验证码输入。进度 notice、HTTP(S) 继续链接、代码、文本输入和遮蔽的 secret 输入仍显示在同一个功能自有区段中。

已连接的卡片可以重新登录，或在此计算机上退出登录。退出登录只会移除本地账户凭据，不会撤销 Cinlan 服务端的访问权限。成功提示会再次说明该限制。

<a id="state-and-composition"></a>
## 状态与组合

Apply 主体拥有一个 `AccountSettingsSource`。每次出现可用 Connection generation 时，它会重启不含机密的快照流；连接变化或插件离开时，它会取消活动授权流。卸载会等待这些可取消流，但不等待由 Connection 持有的一次性命令；来自较早 Connection generation 的一次性结果会被遏制，无法更新已重连或已卸载的 UI 状态。完整 Remote 快照通过注入的 `useAccount` hook 到达 React，不会进入设置交互 store。

插件通过 `ctx.slots.inject('settings.section', ...)` 注册 `account` 区段及其元数据，并通过 `settings.section.icon` 注册带键的用户图标。所有注册与 Remote 生命周期都随插件 fiber 离开。发布的 web bundle 挂载此浏览器 row，base bundle 则挂载 Host 账户控制器。

<a id="security"></a>
## 安全

Prompt 元数据可以进入 observable source，但答案不能。Prompt 组件将当前值保存在 React 本地 state 中，对 `secret` 使用密码输入，在提交时清空值，并直接把它传给单向 `answer` 命令。任何答案、凭据记录 payload、密码、token 或 API 密钥都不会进入 Remote 快照、功能 store、注入 props 字段或日志。

Host 只允许不含 URL 凭据的 HTTP(S) notice 链接。组件会在渲染 anchor 前执行相同检查。UI 故障使用固定 locale 键，而不是上游异常文本。英文和简体中文文案由类型化字典拥有。

该区段渲染控制器当前视图，不维护第二份持久账户模型，因此不发布不变量伴随插件。

<a id="further-exploration"></a>
## 进一步探索

- [Web Client 子系统](../../../docs/subsystems/web-client.zh.md)——Client 加载、对象 source 与呈现组合。
- [账户控制器](../../api/account-controller/README.zh.md)——Remote 方法、故障分类与安全投影。
- [Slots 子系统](../../../docs/subsystems/slots.zh.md)——区段注册与注入 hook 绑定。

<a id="model-experience"></a>
## 模型体验

无。此设置区段不会创建消息、工具、system prompt 文本或其他模型可见内容。

#### KV Cache 影响

不失效；UI 不贡献任何请求前缀内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 退出登录只移除本地 Cinlan 凭据，不会撤销远程账户访问，也无法确认其远程状态。
- 此区段依赖固定的 Cinlan 授权 flow，不发现已卸载 provider 遗留的孤儿记录。
- 重新加载页面或失去 Connection 会取消活动尝试。尝试不可恢复。
