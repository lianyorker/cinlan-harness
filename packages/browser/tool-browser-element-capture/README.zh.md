---
description: "面向模型的 Browser 元素选择与已核验裁剪工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser-element-capture

[English](README.md) | 中文

## 概述

这个 Consumer 为持久 [`ctx.browser`](../browser/README.zh.md) 能力增加 `browser_select_element` 和 `browser_capture_element`。Selection 直接调用 Browser Provider；capture 把 JSON-safe task 提交给进程内 Coordination service，由 Host executor 负责 Browser I/O 与附件持久化。

默认 Cinlan Web 组合使用 Cinlan CLI Provider，并挂载这两个工具及 capture executor。其他组合可以将它们与独立的 Playwright Provider 一起挂载。

## 目录

- [工具与数据流](#tools-and-data-flow)
- [配置](#configuration)
- [权限与取消](#permissions-and-cancellation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="tools-and-data-flow"></a>
## 工具与数据流

| 工具 | 参数 | 结果 |
|---|---|---|
| `browser_select_element` | `page_id` | 临时 `selection_id`、元素文本 metadata 和可见 bounds。 |
| `browser_capture_element` | `page_id`，以及 `observation_id` + `element_id` 或 `selection_id` 二选一 | 请求标识、`verified: true` 和一个 durable image attachment reference。 |

Capture 会在创建 task 前拒绝混合、不完整、空或带首尾空白的 target id。Coordination input 只包含 page、target 与 format 的字符串 JSON 字段。Executor output 只包含 `attachmentId`、`mediaType`、`bytes`、`width`、`height` 和可选 `name`；run 成功后，Consumer 才把这些 metadata 与已验证的请求标识组合起来。

Consumer 要求精确的 provider/model route 在 capture 执行前声明 image input；prompt assembly 无法证明该能力时，只隐藏 `browser_capture_element`。Nested 与 PTC dispatch 会把同一个 durable image 作为 plugin user context 延迟注入，使下一次模型请求只收到一次该 capture。

<a id="configuration"></a>
## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `60000` | 附加到两个工具的 cooperative timeout metadata。 |
| `screenshotFormat` | `png` | 向 Provider 请求的元素裁剪编码（`png` 或 `jpeg`）。 |

未知键、无效格式、非正数、不安全整数和超过支持范围的 timer 值会在插件设置阶段失败。

<a id="permissions-and-cancellation"></a>
## 权限与取消

两个工具都使用 Browser permission policy 的 `observe` 类，并继续受其 ToolRuntime guard 约束。Coordination 调度不会替代该决策。Caller 取消会请求 run 取消，然后等待 executor 结算后再返回 tool error，避免 caller 已观察到完成后 capture 仍继续持久化。

<a id="model-experience"></a>
## 模型体验

### Browser 元素捕获 system prompt

#### 模型看到的内容

Consumer 增加固定英文指引，说明如何选择 observation id 或临时人工 selection，以及页面标识过期后需要重新获取。

##### Capture guidance

```markdown
Use browser_select_element when a person must identify an element through a temporary hover highlight. Use browser_capture_element with either the exact observation_id and element_id from browser_snapshot or the selection_id from browser_select_element. The provider verifies element identity and visible bounds around capture; obtain a new snapshot or selection after the page changes.
```

#### Token 影响

Consumer 启用时，固定指引增加稳定的请求前缀成本。

#### KV Cache 影响

插件配置与工具可见性不变时，指引可继续复用；启用、禁用或过滤 Consumer 会从首个受影响 token 起改变前缀。

### Browser 元素捕获 tool definition

#### 模型看到的内容

模型收到用于一次人工选择的 `browser_select_element`；只有 image-capable route 才收到 `browser_capture_element`。Timeout 与图像格式属于部署配置，不是模型参数。

#### Token 影响

两个固定 definition 在可见时增加稳定前缀 token；text-only route 只保留 selection definition。

#### KV Cache 影响

Route capability 与插件配置不变时，definition 保持现有前缀。Capture 工具的 route-dependent 可见性会从被移除或新增的首个 tool token 起改变复用。

### Browser 元素捕获结果

#### 模型看到的内容

Selection 返回固定英文文本，包含选中的 page、`selection_id`、role、name 和 bounds。Capture 返回固定英文文本，包含 page、精确 target、图像 media type、尺寸与字节数，随后是 durable image block；元素过期或变化时返回普通 tool failure，不返回 attachment result。

#### Token 影响

Selection 与 capture metadata 增加取决于数据的文本。成功裁剪还会增加特定 model provider 的 image input 成本，但不会再次发送完整页面图像。

#### KV Cache 影响

Tool result 追加在可复用请求前缀之后。新的 selection 或 capture 在 compaction 前只改变后缀历史。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- Cinlan CLI Provider 支持人工选择和 selection-bound capture；observation ref 返回 `BROWSER_FEATURE_UNSUPPORTED`。见 [Provider capture 语义](../browser-cinlan/README.zh.md#element-selection-and-capture)。
- Selection id 是进程内临时值，并在 capture 后被消费；它不是 durable Session entity。
- 当前 capture 不支持 padding、annotation、full-page mode、script evaluation 或独立 element-text extraction。
- 人工选择需要具备可见 UI 的 Browser Provider。

<a id="dev-note"></a>
### 开发备注

本包不发布 runtime invariant companion，因为一次调用结束后 Consumer 不保留独立关系：Browser 负责 target freshness，Coordination 负责 task settlement，AttachmentStore 负责 durable bytes，ToolRuntime 负责 call/result logging。
