---
description: "Cinlan Harness Browser 能力包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

## 概述

本包负责持久化 Browser 能力中的一层职责，详细 service、provider、policy 或 tool contract 见下方章节。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

这个面向模型的 Consumer 将与 provider 无关的 [`ctx.browser`](../browser/README.zh.md) API 暴露为十六个持久 Browser 工具。它负责工具名称、JSON schema、HTTP(S) URL 验证、timeout metadata、system guidance、result rendering、screenshot 的附件持久化以及通用 UI render intent；它不导入具体 provider。

## 工具

| 工具 | 参数 | 结果 |
|---|---|---|
| `browser_list` | 无 | 持久 page id、index、URL、title 和 active state。 |
| `browser_open` | `url` | 打开绝对 HTTP(S) URL 并返回 `page_id`。 |
| `browser_navigate` | `page_id`, `url` | 导航一个页面并报告最终 URL/title。 |
| `browser_snapshot` | `page_id` | 返回新的 `observation_id`、无障碍树和 scoped element id。 |
| `browser_click` | `page_id`, `observation_id`, `element_id` | 点击该精确 observation 中的一个 element。 |
| `browser_screenshot` | `page_id` | 持久化 PNG/JPEG viewport attachment 并返回 image block。 |
| `browser_close` | `page_id` | 关闭一个持久页面。 |

undefinednavigate、snapshot、click、screenshot 和 close 保持顺序，因为 page state 和 observation freshness 可能在调用间变化。

主页、搜索、后退/前进、访问记录、网络检查、上传、下载清单与 attachment 保存由原生扩展提供。browser_upload 只读取调用 Session 工作区中的文件并设置观察绑定的 input；页面 input/change 事件可能发送数据。browser_save_download 将完成下载保存为 attachment，只返回 metadata。Cookie 导入没有模型工具。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `60000` | 附加到每个 tool definition 的 cooperative timeout metadata。 |
| `screenshotFormat` | `png` | provider screenshot encoding 与 attachment media type（`png` 或 `jpeg`）。 |

undefined未知键、无效格式以及非正数、非整数、不安全或超限的 timeout 值会在插件设置期间失败。

## Screenshot 准入

在 browser I/O 前，`browser_screenshot` 要求 deployment attachment policy 接受配置的 media type，并要求精确的调用方 provider/model route 通过 `ctx.llm` 明确声明 image input。该原生 image-capability lookup 不会通过 MCP 路由 screenshot。Consumer 会先通过 `ctx.attachments` 保存验证后的字节，再返回 `ImageBlock`；nested/code-mode dispatch 还会把同一 image 延迟为 plugin context，使下一个模型请求接收到它。

## Render intent

每个工具都声明纯 `card: 'generic'` pending view，并使用 read、fetch、execute 或 delete kind。Browser control 不是 terminal output、diff、filesystem location 或 OS Computer Use presentation。

## 模型体验

### Browser system prompt

#### 模型看到的内容

插件增加一个固定 section，用于区分持久 Browser 操作、observation-scoped element id 和 OS Computer Use。

##### Browser 指引

```markdown
Use browser_* tools to inspect and operate persistent web pages in the configured browser. Element ids are valid only with the observation_id returned by the latest browser_snapshot for that page; take a new snapshot after navigation or interaction. These tools do not control OS windows or desktop applications; use a Computer Use capability for those targets.
```

#### Token 影响

启用插件时，固定指引会增加稳定的请求前缀成本。

#### KV Cache 影响

只要插件保持加载且配置和可见性不变，prompt 前缀就保持稳定。启用、禁用或重新加载插件可能从第一个变化的 prompt token 起使复用失效。

### Browser tool definition

#### 模型看到的内容

模型会收到十六个 `browser_*` definition，用于列出、打开、导航、snapshot、点击、screenshot 和关闭持久 page；timeout 和 screenshot encoding 仍是 deployment configuration，而不是模型参数。

#### Token 影响

工具可见时，十六个固定 definition 会增加稳定的请求前缀成本。

#### KV Cache 影响

配置和 tool visibility 不变时，这些 definition 会保持可复用前缀。改变可见性或 definition 会从第一个变化的 tool token 起使复用失效。

### Browser tool result

#### 模型看到的内容

`browser_list` 为每个 page 渲染一行，`browser_snapshot` 标识 observation 和无障碍树，修改性 result 会要求在再次执行 element action 前获取新 snapshot。`browser_screenshot` 返回文字 image summary 和 durable image attachment；失败保留常规 `Error: <message>` tool-result 形式和结构化 harness error metadata。

#### Token 影响

page list 和无障碍树大小取决于数据，并在 compaction 前保留在 session history 中。screenshot 会根据所选 model provider 增加 attachment metadata 和 image input 成本。

#### KV Cache 影响

result 追加在可复用请求前缀之后，并保留现有前缀条目。

## 已知限制与暂缓事项

- 尚无文本输入、滚动、键盘事件、普通表单填写、trace 或 PDF 工具；历史与网络检查只保留页面生命周期内的有限 metadata。
- 显式 URL 只接受绝对 HTTP(S)；配置主页还可使用 about:blank。file、data 与其他自定义 scheme 被拒绝。
- screenshot 执行要求 image-capable model route 和 durable attachment service；未知 image capability 会 fail closed。
- 该套件为 opt-in，不注册 OS Computer Use 或桌面应用工具。


<a id="开发备注"></a>
### 开发备注

本包将 transport、policy 与 model-facing 职责保留在各自层；不要直接编辑生成 artifact。

No runtime invariant companion is published because ToolRuntime 拥有日志 call/result 关系，Browser 拥有观察新鲜度。
