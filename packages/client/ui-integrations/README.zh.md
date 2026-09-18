---
description: "设置中的原生只读 GitHub、GitLab 与 Gitee 就绪检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-integrations

[English](README.md) | 中文

## 概述

开发设置组中的集成页面检查 GitHub、GitLab 与 Gitee 在 Host 上的真实就绪状态。它显示提供方状态和可用的账号提示，不安装工具、不认证账号，也不更改凭据。

## 目录

- [使用本包](#use-this-package)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

打开集成页面即可检查三个提供方。当前检查完成后，刷新全部会重新检查。每行分别区分已连接、缺少 CLI（命令行界面）、缺少认证、缺少配置、不可用与检查中状态。Remote 请求失败时会显示错误，不会变成未配置的账号。

当 Host 报告缺少前置条件时，GitHub 与 GitLab 会显示对应的安装或认证命令。Gitee 在令牌缺失或被拒绝时显示令牌设置说明；仅存在令牌不代表连接成功。命令仅以文本显示，页面不会执行它们。

设置搜索索引本地化的提供方描述与刷新全部。账号提示及其他响应数据不会进入索引。四个稳定锚点分别属于提供方行与刷新控件。

<a id="implementation"></a>
## 实现

[预检控制器](../../api/integration-preflight-controller/src/index.ts)通过 `gh auth status` 检查 GitHub，通过 `glab auth status` 检查 GitLab，并通过用户端点检查 Gitee。组件为每轮检查拥有一个 AbortController；替换回调、刷新或离开页面会取消已结束使用的检查轮次，并忽略迟到结果。

分区 id 保持为 `integrations`，顺序为 40。其 UI、开发组元数据与四条搜索描述共享一个 `slots.inject` 生命周期；标签跟随当前语言，不索引实时账号数据。

不发布运行时不变量伴随插件：就绪状态由 Host 控制器拥有，此页面渲染可释放的请求快照。

<a id="model-experience"></a>
## 模型体验

无，因为页面不注册面向模型的工具或提示词内容，也不更改 Session 日志。

#### KV Cache 影响

无；浏览器触发的检查不会进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

状态在打开页面和显式刷新全部时更新；页面不订阅外部认证变化。CLI 安装指导包含现有 Windows 命令。视觉参考中的 Linear 连接、添加连接流程与启动时验证偏好没有对应操作或设置，因此这里不提供这些功能。
