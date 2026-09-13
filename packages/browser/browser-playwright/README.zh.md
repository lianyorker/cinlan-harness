---
description: "用于持久 Browser 页面和已核验元素捕获的 Playwright Provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-playwright

[English](README.md) | 中文

## 概述

这个可选 Service Provider 使用 Playwright 实现 [`ctx.browser`](../browser/README.zh.md)。它在首次操作时启动已安装的浏览器 channel，默认在 `$DSH_HOME/browser/profile` 保存专用持久 profile，并负责 BrowserContext、page id、observation、selection 和 element handle 的生命周期。

Provider 支持持久页面列表、HTTP(S) 导航、无障碍快照、绑定到 observation 的点击、PNG/JPEG viewport screenshot、临时人工元素选择、已核验元素裁剪和页面关闭。它不使用 Cinlan CLI Browser Provider，也不提供 OS Computer Use。

## 目录

- [生命周期与标识](#lifecycle-and-identity)
- [已核验元素捕获](#verified-element-capture)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="lifecycle-and-identity"></a>
## 生命周期与标识

每个已跟踪页面拥有独立的生命周期取消信号。从 Harness 外部关闭页面会以 `BROWSER_PAGE_CLOSED` 中止进行中的页面操作；显式 `browser_close` 仍正常完成。导航和关闭会使 observation 与 selection 失效；点击在发出副作用前消费 observation，并且不会在结果不确定时重试。

Snapshot element id 只在一个精确 observation 内有效。Selection id 持有一个由 Provider 管理的 element handle，并在 capture 尝试后被消费。插件释放时会拒绝新操作、中止页面工作、释放保留的 handle、注销 Provider，并且只关闭一次持久 BrowserContext。

<a id="verified-element-capture"></a>
## 已核验元素捕获

`selectElement()` 安装一个临时 hover 高亮层，并在点击、Escape、取消、超时、导航、被另一个 selection 替换或插件释放时结束。`captureElement()` 接受 observation/element 组合或 selection id，把元素裁剪到 viewport，执行字节数与像素数限制，并在截图编码前后核验元素 fingerprint 与可见矩形。

元素发生变化、detached、不可见、过期或尺寸超限时，操作会失败且不发布 capture bytes。点击失败保留 stale、timeout、not-actionable 和其他 Provider failure 的独立错误码。

<a id="configuration"></a>
## 配置

本插件需要 Browser 与 Settings 服务。browser-playwright Settings 命名空间在部署默认值之上undefined。修改在 Provider 重新挂载或 profile 重启时生效，不会打断当前浏览器操作。视口偏好接受正安全整数。可执行路径、存储目录与 Provider 身份仍属于部署配置。

| 键 | 默认值 | 含义 |
|---|---|---|
| `providerId` | `local` | 注册到 `ctx.browser` 的 Provider id。 |
| `storageDir` | `$DSH_HOME/browser/profile` | 专用持久浏览器 profile。 |
| `browserChannel` | `chrome` | 已安装 channel：`chrome`、`msedge` 或 `chromium`。 |
| `executablePath` | 无 | 显式浏览器 executable；覆盖 `browserChannel`。 |
| `headless` | `false` | 是否在没有可见窗口的情况下运行页面。 |
| `actionTimeoutMs` | `30000` | 浏览器启动与 action timeout。 |
| `navigationTimeoutMs` | `60000` | 页面 navigation timeout。 |
| `maxElements` | `200` | 单次 snapshot 最多返回的交互引用数。 |
| `viewportWidth` / `viewportHeight` | `1440` / `900` | 浏览器 viewport 尺寸。 |
| `maxCaptureBytes` | `10485760` | 单次元素裁剪的最大编码字节数。 |
| `maxCapturePixels` | `4000000` | 单次元素裁剪的最大可见 CSS 像素数。 |
| `selectionTimeoutMs` | `60000` | 等待一次人工选择的最大时间。 |
| `profileName` / `homePage` / `searchEngine` | `default` / `about:blank` / `google` | 重启后生效的 profile 和导航偏好。 |
| `maxHistoryEntries` / `maxNetworkEntries` | `100` / `100` | 每个打开页面保留的记录数。 |
| `maxCookieCount` / `maxDownloadCount` | `100` / `20` | 单次导入 Cookie 数及每页下载数。 |
| `maxTransferBytes` | `4194304` | 上传或读取下载文件的字节上限。 |

profileName 只接受小写字母开头的安全名称。default 保留原 storageDir；其他名称使用 storageDir/harness-profiles/profile-{name}。Cookie 与浏览器存储按目录隔离，修改名称不复制或删除旧数据。history/network 只保留打开页面的最近记录，去掉 URL 凭据、查询和片段，不保留请求头或响应体；关闭页面或 Provider 后清空。

文件上传只设置当前观察对应的 input，页面 input/change 事件可能发送数据；失败后需要新观察。下载文件名经过清理，读取按流施加字节上限；maxTransferBytes 不限制浏览器网络传输过程的磁盘占用。达到每页下载数量上限后取消后续下载并报告 truncated。

<a id="model-experience"></a>
## 模型体验

### Provider 支持的 Browser 操作

#### 模型看到的内容

Provider 不贡献 prompt 或 tool definition。[`@deepseek-ai/dsh-tool-browser`](../tool-browser/README.zh.md) 渲染持久页面操作，[`@deepseek-ai/dsh-tool-browser-element-capture`](../tool-browser-element-capture/README.zh.md) 渲染 selection 与已核验裁剪结果。

#### Token 影响

只有 Consumer 渲染的文本与图像会进入模型输入。无障碍树、元素 metadata 和裁剪图像随页面状态变化。

#### KV Cache 影响

浏览器进程状态、profile 内容、page id、observation 和 selection 不改变可复用请求前缀；Consumer 配置与可见性负责所有前缀变化。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- Host 必须已经安装配置的 Chrome、Edge 或 Chromium executable；Provider 不会在运行时下载浏览器。
- Chromium 使用共享凭证清理后的子进程环境。
- 专用 profile 与用户日常浏览器 profile 分离，以避免 profile lock 和无关个人状态。
- 尚不支持文本/键盘输入、滚动、trace、PDF、HAR、持久化访问历史、profile 清单/删除/重命名或逐页 profile 切换。
- 人工选择需要可见的 headed 浏览器窗口；非交互操作可以在 headless 模式运行。

<a id="dev-note"></a>
### 开发备注

本包不发布 runtime invariant companion，因为它没有可独立观察的关系：`BrowserRuntime` 负责 Provider 注册，每个操作都在发布结果前检查 page、observation、selection 和 handle 的有效性。
