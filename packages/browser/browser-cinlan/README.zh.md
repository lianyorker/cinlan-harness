---
description: "Cinlan Harness Browser 能力包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-cinlan

[English](README.md) | 中文

## 概述

本包负责持久化 Browser 能力中的一层职责，详细 service、provider、policy 或 tool contract 见下方章节。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

这个 Service Provider 使用公开的 Cinlan IDE JSON CLI 实现 [`ctx.browser`](../browser/README.zh.md)。每个操作都通过 `ctx.subprocess` 启动一个基于 argv 的进程，在发布状态前验证完整 JSON envelope 和 result，并且绝不调用 Computer Use 命令或 shell。插件设置会立即注册 Provider，不解析 executable 也不探测运行时；executable 解析和首次 CLI 调用在首次操作时懒执行，因此 Cinlan IDE CLI 缺失或未就绪不会阻断插件树。

## 公开命令

| Browser 操作 | 配置 executable 之后的 CLI argv |
|---|---|
| `listPages` | `tab list --worktree <selector> --json` |
| `openPage` | `tab create --url <url> --worktree <selector> --json` |
| `navigate` | `goto --page <pageId> --url <url> --worktree <selector> --json` |
| `snapshot` | `snapshot --page <pageId> --worktree <selector> --json` |
| `click` | `click --page <pageId> --element <ref> --worktree <selector> --json` |
| `screenshot` | `screenshot --page <pageId> --format <png|jpeg> --worktree <selector> --json` |
| `selectElement` | `eval --page <pageId> --expression <selection script> --worktree <selector> --json` |
| `captureElement` | 在一次 viewport `screenshot` 前后执行 `eval --expression` 校验，再由 Host 裁剪。 |
| `closePage` | `tab close --page <pageId> --worktree <selector> --json` |

parser 仅接受当前公开响应字段和 `{ id, ok, result|error, _meta: { runtimeId } }` envelope。未知字段、格式错误的 result、进程状态与 envelope 状态不一致、重复的 page 或 element id、非规范 base64 以及超限输出都会以结构化 `BrowserError` code 失败。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `providerId` | `cinlan` | 注册到 `ctx.browser` 的 provider id。 |
| `command` | `orca`（Linux 为 `orca-ide`） | 由 `ctx.subprocess` 解析的 bare executable name 或绝对路径。 |
| `cwd` | `process.cwd()` | 子进程工作目录。 |
| `worktree` | `active` | 发送给每个命令的 Cinlan worktree selector。 |
| `commandTimeoutMs` | `65000` | executable lookup 和每个普通命令的 deadline。 |
| `cleanupTimeoutMs` | `15000` | overlay/marker cleanup 与 owned-tab disposal 的每条命令 deadline。 |
| `graceMs` | `3000` | 子进程 TERM-to-KILL grace。 |
| `maxJsonBytes` | `16777216` | 完整 stdout JSON 字节上限。 |
| `maxStderrBytes` | `65536` | 捕获 stderr 的字节上限。 |
| `maxImageBytes` | `10485760` | base64 解码后以及 crop 编码后的图像文件字节上限。 |
| `selectionTimeoutMs` | `60000` | executable lookup 与人工元素选择的 deadline。 |
| `maxCapturePixels` | `4000000` | 元素 crop 的最大可见 CSS-pixel 面积，不是解码后的 device-pixel 数量。 |

未知键、带首尾空格或为空的字符串、非整数限制、非正数限制、不安全整数以及超过 Node 支持范围的 timer 值都会在插件设置期间失败。

`closeOwnedPagesOnDispose` 有意不作为 config key。关闭由该 provider instance 在当前 generation 中创建的 page 是 lifecycle invariant：禁用 cleanup 会在 HMR 或 disposal 后遗留 provider 所有的持久状态，而列出的页面和预先存在的页面始终不属于 provider ownership。

<a id="element-selection-and-capture"></a>
## 元素选择与捕获

`selectElement` 通过 `orca eval --expression` 安装临时 hover overlay。点击选择元素，Escape 或 selection deadline 会取消。成功选择后保留私有 DOM marker，并返回进程内 `selectionId`。Capture 在任何异步操作前独占消费该 id；并发调用和重试必须重新选择，取消或失败后也一样。始终尝试清理 overlay；选择失败和每次 capture 尝试还会通过有 deadline 的尽力执行命令移除 marker。Cleanup 失败不会替换主要结果或错误。

Selection-bound capture 在 viewport 截图前后校验标记元素的 fingerprint、可见矩形和 viewport。Host 使用 `sharp`，按解码图像与 CSS viewport 的尺寸比例裁剪，并重新编码为 PNG 或 JPEG。实际编码必须与请求格式一致。元素变化或丢失、bounds 或 viewport 变化、无效图像字节及超限都会返回结构化错误，不返回 capture 结果。

Observation-bound capture 返回 `BROWSER_FEATURE_UNSUPPORTED`：Orca snapshot 中的 `e1`、`@e1` 等 ref 是不透明 runtime handle，不是 CSS selector。本 Provider 应使用人工选择，不猜测 selector，也不回退到完整页面截图。

## Runtime 与生命周期

每次 spawn 都使用明确的 stdin/stdout/stderr disposition，转发调用方 `AbortSignal`，增加 provider deadline，并从子进程环境移除 `ORCA_PAIRING_CODE`、`ORCA_REMOTE_PAIRING` 和 `ORCA_ENVIRONMENT`。provider 不会通过 ambient pairing state 选择远程 Cinlan runtime。

Executable lookup 与操作共用 deadline 和取消信号。只缓存成功的解析结果；解析失败或取消后可以重试，不会取消独立调用方。

CLI `runtimeId` 是 generation marker。generation 变化会使所有 observation 和 selection 失效，记录于旧 generation 的 page 会以 `BROWSER_RUNTIME_STALE` 失败。每次成功 snapshot 都创建新的 harness observation id；click 要求该精确 observation 及其精确 element ref。navigate 和 click 会在发出命令前使此前 observation 失效。

插件 disposal 会先注销 provider、停止接收调用、中止并等待进行中的进程，然后仅关闭由该 provider instance 在当前 runtime generation 中创建的 page。列出的页面或预先存在的页面永远不归 cleanup 所有。runtime restart 会使该 ownership 过期，而不会让 disposal 尝试远程 cleanup。`closed: false` 响应属于 cleanup 失败；disposal 仍会尝试关闭其余 owned tab，再报告失败。

## 模型体验

### Provider 支持的 Browser 结果

#### 模型看到的内容

provider 不直接贡献模型文本。[`@deepseek-ai/dsh-tool-browser`](../tool-browser/README.zh.md) 将验证后的 page state 转换为 `browser_*` 结果，并通过常规 error tool-result 路径暴露 transport、timeout、stale runtime、stale observation、stale element、missing page 和 protocol 失败。

#### Token 影响

CLI 执行和响应验证不增加请求 token；只有 Consumer 渲染的结果或错误会贡献模型可见 token。

#### KV Cache 影响

runtime generation、page ownership 和 observation state 不会改变可复用的请求前缀；任何 prompt 或 tool definition 变化都由 Consumer 配置所有。

## 已知限制与暂缓事项

- provider 要求已安装、可解析且已认证的 Cinlan CLI，以及该 CLI 可见的 worktree selector。
- 它有意不提供 remote pairing、Playwright fallback、browser engine embedding 或直接 Cinlan runtime API 依赖。
- 它不暴露 OS Computer Use、桌面窗口、下载、trace、上传、文本输入、滚动或网络检查。
- cleanup 只能关闭当前 generation 中由本 instance 打开的 page；CLI/runtime restart 会结束旧 generation 及其可观察 ownership。


<a id="开发备注"></a>
### 开发备注

本包将 transport、policy 与 model-facing 职责保留在各自层；不要直接编辑生成 artifact。

No runtime invariant companion is published because CLI 响应在发布前验证 runtime、页面、观察和进程归属。
