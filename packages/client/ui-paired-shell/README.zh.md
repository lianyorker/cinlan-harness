---
description: "在配对 Desktop 载体上显示已授权 Session 的受限手机外壳。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-paired-shell

[English](README.md) | 中文

## 概述

此 Client 插件以适合手机的布局显示已授权 Session 选择和既有 Conversation UI。认证、Session 授权与撤销由 [Remote Access](../../remote-access/remote-access/README.zh.md) 负责。外壳不授予权限。

## 目录

- [组合](#composition)
- [生命周期与数据](#lifecycle-and-data)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="composition"></a>
## 组合

[Desktop](../../../apps/desktop/README.zh.md#paired-phone-access)仅在受限配对图中提供此入口。Host 入口不执行操作。不要在普通布局插件旁挂载此 Client 入口：两者都拥有 root slot。配对图包含模块加载器、传输与 Remote 基础设施、Session controller、仅内存 Settings 基础服务、locale、keyboard、theme、renderer、Session 与 Conversation UI、聊天、工具结果、审批和问题。

外壳为选定的已授权 Session 渲染既有会话。不安装设置页面、工作区浏览、模型选择、插件管理、命令或 HMR。file-upload 依赖满足 Conversation 注入；配对 Host 策略仍拒绝上传操作。

<a id="lifecycle-and-data"></a>
## 生命周期与数据

Session 列表与选择来自既有 Session controller 和框架 hook。只读工作区投影仅从已授权 Session 摘要派生，目录与工作区修改在本地失败。主题展示属于受管理 effect，释放时恢复先前 DOM 状态。root slot、词典和工作区适配器遵循 Cordis 释放生命周期。

配对传输显式报告非本地权限，包括回环 HTTPS origin。Settings 基础服务使用内存模式，不读取或写入 Host 设置。Host 继续对每个操作与事件执行 Session 授权；从外壳移除控件不等于授权检查。

<a id="model-experience"></a>
## 模型体验

无，因为此展示包不注册模型工具、提示词或参数，用户消息和交互委托给现有 Session 与 Conversation 路径。

#### KV Cache 影响

无。外壳不贡献模型可见前缀或提示内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

外壳操作由可信 Host 显式共享的 Session。它不能创建工作区、浏览 Host 目录、上传文件或修改 Host 配置。传输要求独立配置 HTTPS 和有效的配对设备授权。浏览器测试不证明已交付签名原生 Android 或 iOS 应用。

此包没有 invariant companion，因为它不拥有可独立修改的业务注册表：Session 状态与权限仍由既有 owner 负责。生命周期测试覆盖真实 Client Loader 组合与既有会话交互。

### 开发备注

遵循 [Web Client 分层](../../../docs/subsystems/web-client.zh.md)和 [slot 所有权](../../../docs/subsystems/slots.zh.md)。展示变更属于此包；载体授权与精确资源暴露属于各自 Host owner。
