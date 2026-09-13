---
description: "Web Settings 中的静态 Browser 元素捕获说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser-element-capture

[English](README.md) | 中文

## 概述

这个 Client 插件注册一个本地化 `settings.section` 条目，用于说明 Browser Element Capture 工作流及其权限分离。面板是静态的，不包含 Host Remote、Browser service、React Context、手工订阅、Provider state projection 或 capture action。

## 目录

- [注册](#registration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="registration"></a>
## 注册

Client half 等待 `settings.section` slot，以 order `70` 注册 id 为 `browser-element-capture` 的 section，并贡献键集合一致的中英文 locale dictionary。它不注册 `settings.section.icon`。Settings declaration 被移除或插件释放时，slot 生命周期会移除该 section。

Node half 有意保持为空，因为 presentation 完全属于 browser-side。

<a id="model-experience"></a>
## 模型体验

无。本 Client 插件不注册 prompt、tool、Session event 或 model-request input。

#### KV Cache 影响

Settings section 不改变模型请求。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 面板不显示实时 Provider status、活动 selection、task progress 或已保存 attachment。
- Selection 与 capture 仍是 model-tool operation，不是直接 Settings action。说明明确使用 Cinlan selection-id 工作流，并要求模型支持图像输入。

<a id="dev-note"></a>
### 开发备注

本包不发布 runtime invariant companion，因为插件只保留 slot-owned presentation state，而 slot registry 已负责 registration lifetime。
