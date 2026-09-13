---
description: "提供类型化结果和可选截图的模型桌面工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-computer-use

[English](README.md) | 中文

## 概述

提供类型化结果和可选截图的模型桌面工具。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个面向模型的 Consumer 将 Provider 无关的 [`ctx.computerUse`](../computer-use/README.zh.md) API 暴露为六个分组桌面工具。它负责工具名、JSON schema、严格参数校验、超时元数据、system guidance、结果呈现、可选截图持久化和通用 UI render intent；它不导入具体 Provider。

## 工具

| 工具 | 操作 | 结果 |
|---|---|---|
| `computer_list_apps` | 列出应用 | 应用 id、名称、进程 id、运行状态和可选 bundle id。 |
| `computer_list_windows` | 列出某个应用的窗口 | 窗口 id、标题、尺寸和可用状态字段。 |
| `computer_observe` | 无障碍观察 | 新 observation id、应用/窗口身份、无障碍树、element id 和可选 PNG attachment。 |
| `computer_pointer` | 点击、滚动、拖拽 | 新的动作后观察和已脱敏动作元数据。 |
| `computer_keyboard` | 输入文本、粘贴文本、按键、快捷键 | 新的动作后观察和已脱敏动作元数据。 |
| `computer_accessibility` | 次级动作、设置值 | 新的动作后观察和已脱敏动作元数据。 |

只有应用和窗口列表声明 sibling concurrency safety。每次观察或动作保持有序，因为目标焦点、runtime generation 和 observation freshness 都可能在调用间变化。

## 配置

| Key | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `60000` | 附加到每个工具定义的 cooperative timeout 元数据。 |
| `maxTextChars` | `100000` | 单次 keyboard 或 accessibility 调用接受的最大字面文本或值长度。 |

模型不能选择这两个上限。未知 key、无效 timeout 值、非正或不安全上限会在插件设置时失败。

## 观察与截图准入

每个动作都要求精确的 `app_id`、`window_id` 和最新 `observation_id`。Element 目标必须来自该观察；point 目标使用非负的窗口局部坐标。每个动作都会返回一份新观察，因此旧 observation 及其全部 element id 会立即失效。

请求截图前，Consumer 要求 attachment policy 接受 PNG，并且精确的调用 provider/model 路由通过 `ctx.llm` 声明图片输入。任一事实不可用时，调用仍会继续使用无障碍树，并要求 Provider 跳过截图采集。通过准入的截图由 `ctx.attachments` 保存，并作为原生 `ImageBlock` 内容返回；此路径不使用 MCP。Attachment 持久化失败会与文本观察一起报告，而不会丢弃无障碍树。

字面文本和值会在 Provider dispatch 前受长度限制，且不会在结果摘要中回显，但普通 `tool/call` event 仍会在 Session log 中记录模型提供的参数。

## Render intent

每个工具都声明纯 `card: 'generic'` pending view，类型为 read 或 execute。桌面控制不是 terminal 输出、diff、文件系统位置或持久 Browser presentation。

<a id="model-experience"></a>
## 模型体验

### Computer Use system prompt

#### 模型看到的内容

插件增加一个固定 section，用于区分本地桌面应用与持久 Browser 页面，并要求 observation freshness。

##### Computer Use guidance

```markdown
Use computer_* tools for local desktop applications, native windows, browser chrome, and webviews. Run computer_observe before every action and use only its exact observation_id, window_id, and element ids. Every action returns a fresh observation; prior element ids immediately expire. Prefer accessibility actions and element ids over coordinates. Typed text and set values are not echoed in result summaries. Persistent web-page automation remains a separate browser_* capability.
```

#### Token 影响

启用插件时，固定 guidance 会增加稳定的请求前缀成本。

#### KV Cache 影响

插件保持加载且可见性不变时，prompt 前缀保持稳定。启用、禁用或重新加载插件可能从第一个变化的 prompt token 起使复用失效。

### Computer Use tool schema

#### 模型看到的内容

模型会收到生成的 [`@deepseek-ai/dsh-tool-computer-use`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-computer-use) 目录章节列出的六个 schema。动作子类型共享 pointer、keyboard 和 accessibility 工具，使 permission class 保持明确，同时避免为每个 Provider 操作创建一个 schema。

#### Token 影响

工具可见时，六个固定定义会增加稳定的请求前缀成本。

#### KV Cache 影响

配置和工具可见性不变时，定义会保留可复用前缀。修改可见性或定义会从第一个变化的 tool token 起使复用失效。

### 桌面观察与动作结果

#### 模型看到的内容

结果标识当前 observation、应用、窗口、尺寸、截图状态、无障碍树，以及已脱敏的动作路径或 verification。支持图片的路由还可能收到一个持久 PNG image block。输入文本和值不会在结果摘要中重复；失败保留常规 `Error: <message>` 形式和结构化 Harness 元数据。

#### Token 影响

应用列表、窗口列表和无障碍树依赖数据，并会保留在 Session 历史中直到 compaction。可选截图会按照所选模型 Provider 增加 attachment 元数据和图片输入成本。

#### KV Cache 影响

结果追加在可复用请求前缀之后，并保留已有前缀条目。

## 已知限制与暂缓事项

- 即使所选 Provider 声明不支持某个动作，六个 schema 仍保持可见；相应调用会在执行时通过 Provider 失败。
- 截图采集是 opportunistic。纯文本或能力未知的模型路由会收到没有图片的无障碍观察，而不是模型能力错误。
- Consumer 没有应用 allowlist、secret field 检测、凭据输入工作流、OCR 工具、display selector、move/resize 工具、菜单专用工具或持久桌面 lease。
- 这个工具集为可选能力，不注册持久 Browser、Mobile Device、Android/iOS emulator 或 simulator、Speech/Audio、麦克风、扬声器、STT 或 TTS 工具。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
