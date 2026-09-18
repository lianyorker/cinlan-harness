---
description: "选择浏览器元素、预览截图，并将图片附加到 Session 草稿。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-element-capture

[English](README.md) | 中文

## 概述

选择已有 Browser 页面中的元素，预览经过校验的截图，并将图片附加到发起操作的 Session 草稿。即使当前 Session 已切换，目标仍是该 Session。捕获与附加都不会发送消息；准备好后从会话中提交草稿。

## 目录

- [捕获流程](#capture-workflow)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="capture-workflow"></a>
## 捕获流程

在支持 Web 的 profile 中启用可选的 [Cinlan Browser 组合包](../../bundle/cinlan-browser/README.zh.md)。打开一个 Session，并在已配置的 Browser 中打开页面，然后进入**设置 → 元素捕获**。刷新页面列表，选择页面并开始选择。在 Browser 窗口中点击目标元素；在该窗口按 Escape 或点击设置中的取消按钮会移除选择覆盖层。Browser 在截图前后检查元素与可见区域，并返回截图供预览。

预览加载成功后可以附加图片。Session 已移除或草稿正忙时，附加被拒绝并保留预览以便重试。刷新、重新选择、取消和页面卸载都会中止待处理工作并忽略迟到结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

[Client 入口](src/client/index.ts)等待 `remote.browser`、Session 和 conversation 服务及设置 slot 声明。它向组件提供普通操作回调。页面贡献与本地化搜索元数据共享声明生命周期；页面 URL 和图片数据不进入搜索元数据。

Node 入口为空。[Browser controller](../../api/browser-controller/README.zh.md)拥有经过身份验证的操作和图片持久化。[Conversation](../ui-conversation/README.zh.md)拥有草稿接收及最终提交。本包不发布运行时 invariant companion，因为这些 owner 校验图片接收，而 slot registry 拥有注册生命周期。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 草稿图片附件

#### 模型看到的内容

用户发送草稿前，模型不会看到内容。提交会记录带有 `image` 内容块的 `user/message`，该内容块引用捕获的附件；接收模型必须支持图片。本包不增加 prompt 或工具定义。

#### Token 影响

选择、捕获、预览和附加到草稿都不增加模型输入。提交的图片消耗接收模型的普通图片 token。

#### KV Cache 影响

查看或操作面板不改变模型请求。发送草稿时，图片加入普通请求的后续内容，不改变静态 prompt 前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

捕获依赖已配置的 Browser 和可写的 Session 草稿。

- 选择要求已有 Browser 页面和可用的 Browser Provider。面板不创建页面或执行导航。
- 选择结果只能使用一次。捕获或预览失败后需要重新选择元素；附加失败会保留已经加载成功的预览。
- 操作只读取并捕获所选页面，不授予模型工具点击、导航、脚本执行或上传权限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

[设置所有权决策](../../../.agents/notes/implemented/architecture/2026-09-17-native-settings-runtime-consumers.zh.md)记录了附加必须指向发起草稿的原因。[真实 Web 验收用例](../../../apps/web/tests/settings-element-capture.e2e.ts)通过可选 Browser 组合包覆盖捕获和草稿交接。当前运行证据记录在[验收状态](../../../.agents/plans/settings-native-acceptance-status.md)。

</details>
