---
description: "Cinlan Harness Browser 能力包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser

[English](README.md) | 中文

## 概述

本包负责持久化 Browser 能力中的一层职责，详细 service、provider、policy 或 tool contract 见下方章节。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

`BrowserRuntime` 是持久浏览器页面的 Service Definition。它负责 provider 注册、确定性 provider 选择、与 provider 无关的请求和结果、跨包 branded id 以及 `BrowserError`；具体传输、模型工具、权限、附件和呈现由同级包负责。

## 服务 API

| 成员 | 行为 |
|---|---|
| `registerProvider(provider)` | 为调用 fiber 注册一个稳定 provider id 并返回 disposer；空白或重复 id 会立即失败。 |
| `listPages(signal?)` | 列出所选 provider 的持久页面。 |
| `openPage(request, signal?)` | 打开一个页面并返回 branded `BrowserPageId`。 |
| `navigate(request, signal?)` | 导航一个页面；provider 会使此前的观察失效。 |
| `snapshot(request, signal?)` | 返回无障碍树、branded `BrowserObservationId` 和作用域限定在该观察内的 `BrowserElementId`。 |
| `click(request, signal?)` | 仅在 page、observation 和 element id 都是当前值时点击元素。 |
| `selectElement(request, signal?)` | 通过可选 Provider 扩展等待人工选择一个元素，并返回临时选择元数据。 |
| `captureElement(request, signal?)` | 通过可选 Provider 扩展返回绑定到 observation 或 selection 的、经过校验的元素 crop。 |
| `screenshot(request, signal?)` | 返回有界的 viewport 编码字节，由 Consumer 负责持久化为附件。 |
| `closePage(request, signal?)` | 关闭一个持久页面。 |

所有异步成员都通过其返回的 Promise 拒绝，包括在 provider I/O 前即可确定的 provider 选择失败。

## Provider 选择

`provider` 可选地固定一个 provider id。未配置时，执行要求恰好有一个已注册 provider 的廉价本地 `available()` 检查返回 true。

| 状态 | `BrowserError.code` |
|---|---|
| 配置的 id 未注册 | `BROWSER_PROVIDER_CONFIGURED_MISSING` |
| 配置的 provider 不可用 | `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 不存在可用 provider | `BROWSER_PROVIDER_UNAVAILABLE` |
| 存在多个可用 provider | `BROWSER_PROVIDER_AMBIGUOUS` |
| provider id 为空或重复 | `BROWSER_PROVIDER_ID_INVALID` / `BROWSER_PROVIDER_DUPLICATE` |

每次调用都会重新选择，因此 HMR disposal 和 provider 可用性变化不会留下缓存的 backend 选择。

## 标识与新鲜度

`BrowserPageId`、`BrowserObservationId`、`BrowserElementId` 和 `BrowserElementSelectionId` 是不透明的 branded string。element id 仅在其精确观察内有效。可选的 capture 扩展接受精确 observation target 或临时 selection id；对于过期的 runtime generation、observation、selection 或 element，provider 会返回结构化错误，而不会猜测调用方意图对应的当前页面或元素。

## 原生扩展

BrowserAutomationProvider 提供显式主页/搜索解析、当前 profile、后退/前进、页面访问记录、网络元数据及 Cookie 导入。BrowserTransferProvider 提供观察绑定的文件输入上传、页面所属下载清单及有界字节读取。未实现扩展的 Provider 返回 BROWSER_FEATURE_UNSUPPORTED。Cookie 只经人工 Remote 导入，不注册模型导入工具；权限仍由 Consumer 持有。

## 模型体验

### Consumer 所有的 Browser 结果

#### 模型看到的内容

本包不直接贡献模型文本。[`@deepseek-ai/dsh-tool-browser`](../tool-browser/README.zh.md) 渲染 `ctx.browser` 结果，并通过常规 tool-result 路径保留 `BrowserError` 失败。

#### Token 影响

Service Definition 不增加请求或结果 token；这些成本由面向模型的 Consumer 所有。

#### KV Cache 影响

provider 注册、选择和新鲜度状态不会改变模型请求前缀；任何影响缓存的文本或 schema 变化都由 Consumer 配置所有。

## 已知限制与暂缓事项

- 文本输入、滚动、PDF 与 trace 尚未提供；核心 Provider 可以不实现原生扩展。
- Browser 不是 OS Computer Use。原生窗口、桌面应用、全局键盘或指针输入以及操作系统控件需要独立能力。
- Service Definition 没有公开的 provider 状态事件或页面变化订阅；调用方通过操作和结构化失败观察当前状态。


<a id="开发备注"></a>
### 开发备注

本包将 transport、policy 与 model-facing 职责保留在各自层；不要直接编辑生成 artifact。

No runtime invariant companion is published because Provider 选择与观察新鲜度在操作返回前由所属服务校验。
