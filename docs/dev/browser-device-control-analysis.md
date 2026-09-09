# 浏览器与设备控制对比分析

> 分析对象：cinlan-harness 各副本目录的浏览器控制、桌面控制、移动设备控制实现差异
> 日期：2026-09-09

## 总览

| 能力 | cinlan-harness (main) | integration-20260909 | staged-final-b84814d3 |
|------|----------------------|---------------------|----------------------|
| **Browser** | ❌ 无 | ✅ 6 个包 | ✅ 4 个包 |
| **Computer Use** | ❌ 无 | ❌ 空目录 | ✅ 4 个包 |
| **Mobile Device** | ❌ 无 | ❌ 空目录 | ✅ 4 个包 |
| **MCP Client** | ✅ 1 个包 | ✅ 1 个包 | ✅ 1 个包 |

## 架构模式

三个能力都遵循相同的 **Capability Seam 四角色** 模式：

```
Service Definition (provider-neutral)
  ├── Service Provider (Cinlan CLI / Playwright)
  ├── Permission Policy (allow/ask/deny)
  ├── Tool Consumer (model-facing tools)
  └── Bundle (cordis.yml 集成)
```

---

## 1. Browser（浏览器控制）

### 包结构对比

| 包 | main | integration | staged-final |
|----|------|------------|-------------|
| `browser` (Service Definition) | ❌ | ✅ 318 行 | ✅ 255 行 |
| `browser-cinlan` (Cinlan CLI Provider) | ❌ | ✅ 944 行 | ✅ 661 行 |
| `browser-permission-policy` | ❌ | ✅ | ✅ |
| `browser-playwright` (Playwright Provider) | ❌ | ✅ 837 行 | ❌ |
| `tool-browser` (Model Tools) | ❌ | ✅ 515 行 | ✅ 515 行 |
| `tool-browser-element-capture` | ❌ | ✅ 502 行 | ❌ |
| `ui-browser-element-capture` (UI) | ❌ | ✅ | ❌ |
| `coordination-browser-element-capture` | ❌ | ✅ | ❌ |
| `cinlan-browser` (Bundle) | ❌ | ✅ | ✅ |

### Service Definition 差异

**integration（0.1.3-alpha.1）** 比 **staged-final（0.1.0-rc.8）** 多出 **Element Capture** 扩展：

| 功能 | integration | staged-final |
|------|------------|-------------|
| `BrowserElementSelectionId` | ✅ Branded | ❌ 无 |
| `BrowserElementCaptureProvider` | ✅ 接口 | ❌ 无 |
| `selectElement()` | ✅ 方法 | ❌ 无 |
| `captureElement()` | ✅ 方法 | ❌ 无 |
| `BrowserElementScreenshot` | ✅ 类型 | ❌ 无 |
| `BrowserElementCaptureTarget` | ✅ 类型 | ❌ 无 |
| `BrowserElementSelectionRequest` | ✅ 类型 | ❌ 无 |
| `BrowserElementCaptureRequest` | ✅ 类型 | ❌ 无 |

integration 的 `BrowserRuntime` 有 `elementCaptureProvider()` 私有方法和 `selectElement`/`captureElement` 公开方法；staged-final 没有。

### Cinlan CLI Provider 差异

| 功能 | integration | staged-final |
|------|------------|-------------|
| `crop.ts` | ✅ 4901 bytes | ❌ 无 |
| `scripts.ts` | ✅ 7355 bytes | ❌ 无 |
| `protocol.ts` | 15419 bytes | 10372 bytes |
| `BrowserElementSelectionId` import | ✅ | ❌ |
| `BrowserElementCaptureProvider` import | ✅ | ❌ |
| `DEFAULT_MAX_CAPTURE_PIXELS` | ✅ 4_000_000 | ❌ |
| `DEFAULT_SELECTION_TIMEOUT_MS` | ✅ 60_000 | ❌ |
| `parseElementCapturePayload` | ✅ | ❌ |
| `parseEvalResult` | ✅ | ❌ |
| `RawElementCapture` / `RawElementFingerprint` | ✅ | ❌ |
| overlay/verify/marker scripts | ✅ | ❌ |

integration 的 `browser-cinlan` 实现了完整的 **元素选择 → 截图裁剪** 工作流：
1. `selectElement()` — 在浏览器中注入 overlay 脚本，让用户悬停高亮选择元素
2. `captureElement()` — 验证元素身份和可见边界，截图后裁剪

staged-final 的 `browser-cinlan` 只有基础操作（open/navigate/snapshot/click/screenshot/close），没有元素选择和裁剪。

### Playwright Provider（仅 integration）

integration 独有 `browser-playwright` 包（837 行），提供：
- 基于 `playwright-core` 的 Harness 自有浏览器 Provider
- 独立 Chromium profile（`DSH_HOME` 下）
- 完整的 Element Capture 扩展（`selectElement`/`captureElement`）
- 可配置：headless、viewport、timeout、maxElements、browserChannel

### 模型工具（tool-browser）

两个版本的 `tool-browser` 完全一致（515 行），注册以下工具：
- `browser_list_pages` — 列出持久化页面
- `browser_open` — 打开 URL
- `browser_navigate` — 导航到 URL
- `browser_snapshot` — 捕获无障碍观察
- `browser_click` — 点击元素
- `browser_screenshot` — 截图
- `browser_close` — 关闭页面

### Element Capture 工具（仅 integration）

`tool-browser-element-capture`（502 行）注册：
- `browser_select_element` — 人工元素选择（悬停高亮）
- `browser_capture_element` — 元素截图裁剪

通过 `coordination-browser-element-capture` 执行器在进程内协调，UI 通过 `ui-browser-element-capture` 展示。

### 权限策略

两个版本的 `browser-permission-policy` 完全一致，三个独立权限类：
- `observe` — list/snapshot/screenshot
- `navigate` — open/navigate
- `interact` — click/close

---

## 2. Computer Use（桌面控制）—— 仅 staged-final

### 包结构

| 包 | 说明 | 行数 |
|----|------|------|
| `computer-use` | Service Definition (`ctx.computerUse`) | 325 行 |
| `computer-use-cinlan` | Cinlan CLI Provider | 657 行 |
| `computer-use-permission-policy` | 权限策略 | — |
| `tool-computer-use` | 模型工具 | 694 行 |
| `cinlan-computer-use` | Bundle | — |

### Service Definition

`ctx.computerUse` 提供：
- `listApps()` — 列出桌面应用
- `listWindows()` — 列出窗口
- `observe()` — 捕获桌面无障碍观察
- `click()` — 点击
- `drag()` — 拖拽
- `scroll()` — 滚动
- `typeText()` — 输入文本
- `pasteText()` — 粘贴
- `pressKey()` — 按键
- `hotkey()` — 组合键
- `secondaryAction()` — 右键/辅助操作
- `setValue()` — 设置值

类型系统：`ComputerAppId`、`ComputerWindowId`、`ComputerElementId`、`ComputerObservationId`（全部 Branded）

### Cinlan CLI Provider

通过 `ctx.subprocess` 启动 `orca`/`orca-ide` CLI，协议解析：
- `parseAction` — 动作结果
- `parseCapabilities` — 能力声明
- `parseListApps` — 应用列表
- `parseListWindows` — 窗口列表
- `parseObservation` — 观察结果
- `loadComputerScreenshot` — 截图加载

### 模型工具

`tool-computer-use` 注册 `computer_*` 工具，按权限类分组：
- `computer_list_apps` / `computer_list_windows` / `computer_observe` (observe)
- `computer_click` / `computer_drag` / `computer_scroll` (pointer)
- `computer_type_text` / `computer_paste_text` / `computer_press_key` / `computer_hotkey` (keyboard)
- `computer_secondary_action` / `computer_set_value` (accessibilityAction)

系统提示词：`"Use computer_* tools for local desktop applications, native windows, browser chrome, and webviews. Run computer_observe before every action..."`

### 权限策略

四个独立权限类：
- `observe` — app/window/tree 观察
- `pointer` — click/scroll/drag
- `keyboard` — text/paste/key/hotkey
- `accessibilityAction` — secondaryAction/setValue

---

## 3. Mobile Device（移动设备控制）—— 仅 staged-final

### 包结构

| 包 | 说明 | 行数 |
|----|------|------|
| `mobile-device` | Service Definition (`ctx.mobileDevice`) | 206 行 |
| `mobile-device-cinlan` | Cinlan CLI Provider | 498 行 |
| `mobile-device-permission-policy` | 权限策略 | — |
| `tool-mobile-device` | 模型工具 | — |
| `cinlan-mobile-device` | Bundle | — |

### Service Definition

`ctx.mobileDevice` 提供：
- `listDevices()` — 列出设备
- `observe()` — 捕获设备观察
- `touch()` — 触摸（归一化坐标 0-1）
- `type()` — 输入文本
- `button()` — 导航按钮

类型系统：`MobileDeviceId`、`MobileDeviceGeneration`、`MobileObservationId`（Branded）

### Cinlan CLI Provider

通过 `ctx.subprocess` 启动 `orca`/`orca-ide` CLI，协议解析：
- `parseDevices` — 设备列表
- `parseObservation` — 观察结果
- `parseAcknowledgement` — 动作确认

### 模型工具

`tool-mobile-device` 注册 `mobile_*` 工具：
- `mobile_list_devices` — 列出设备
- `mobile_observe` — 观察设备
- `mobile_touch` — 触摸
- `mobile_type` — 输入文本
- `mobile_button` — 导航按钮

系统提示词：`"Use mobile_* tools for local Android emulators and iOS simulators. Run mobile_list_devices, select one exact device_id, and run mobile_observe before every mutation..."`

### 权限策略

四个独立权限类：
- `observe` — 设备发现和观察
- `touch` — tap/swipe
- `textInput` — 文本输入
- `deviceNavigation` — 导航按钮

---

## 4. MCP Client

三个版本都有 `mcp/mcp-client`，main 的版本是 `0.1.5-alpha.1`，integration 和 staged-final 分别是 `0.1.3-alpha.1` 和 `0.1.0-rc.8`。

---

## 完整对比矩阵

### Browser

| 功能 | integration | staged-final |
|------|------------|-------------|
| 基础操作（open/navigate/snapshot/click/screenshot/close） | ✅ | ✅ |
| Cinlan CLI Provider | ✅ | ✅ |
| Playwright Provider | ✅ | ❌ |
| Element Capture（选择+裁剪） | ✅ | ❌ |
| Element Capture UI | ✅ | ❌ |
| Element Capture Coordination | ✅ | ❌ |
| 权限策略 | ✅ | ✅ |
| Bundle | ✅ | ✅ |
| invariant.ts | ❌ | ✅ |

### Computer Use

| 功能 | integration | staged-final |
|------|------------|-------------|
| Service Definition | ❌ 空目录 | ✅ 完整 |
| Cinlan CLI Provider | ❌ | ✅ |
| 权限策略 | ❌ | ✅ |
| 模型工具 | ❌ | ✅ |
| Bundle | ❌ | ✅ |

### Mobile Device

| 功能 | integration | staged-final |
|------|------------|-------------|
| Service Definition | ❌ 空目录 | ✅ 完整 |
| Cinlan CLI Provider | ❌ | ✅ |
| 权限策略 | ❌ | ✅ |
| 模型工具 | ❌ | ✅ |
| Bundle | ❌ | ✅ |

---

## 迁移建议

### 保留 staged-final-b84814d3 的方案

staged-final 有完整的三大能力（Browser + Computer Use + Mobile Device），但缺少 integration 的 Element Capture 扩展。

**推荐策略**：以 staged-final 为基础，从 integration 补入 Element Capture。

### 需要迁移的包

| 来源 | 包 | 说明 |
|------|-----|------|
| staged-final | `browser/browser` | Service Definition（基础版） |
| staged-final | `browser/browser-cinlan` | Cinlan CLI Provider（基础版） |
| staged-final | `browser/browser-permission-policy` | 权限策略 |
| staged-final | `browser/tool-browser` | 模型工具 |
| staged-final | `bundle/cinlan-browser` | Bundle |
| staged-final | `computer-use/*` (4 个包) | 完整桌面控制 |
| staged-final | `mobile-device/*` (4 个包) | 完整移动设备控制 |
| integration | `browser/browser-playwright` | Playwright Provider（可选） |
| integration | `browser/tool-browser-element-capture` | Element Capture 工具（可选） |
| integration | `client/ui-browser-element-capture` | Element Capture UI（可选） |
| integration | `coordination/coordination-browser-element-capture` | Element Capture 协调器（可选） |

### 注意事项

- integration 的 `browser/browser` Service Definition 比 staged-final 多 Element Capture 类型，如果要从 integration 补入 Element Capture，需要用 integration 版本的 `browser/browser` 替换 staged-final 版本
- integration 的 `browser-cinlan` 有 `crop.ts`/`scripts.ts` 额外文件，需要一起迁移
- staged-final 的所有包都有 `invariant.ts`，integration 没有——迁移时需确认 invariant 是否与 main 的 invariant 体系兼容
- 版本差异：staged-final `0.1.0-rc.8` → main `0.1.5-alpha.1`，需确认 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-subprocess` 等 peerDependency 的 API 兼容性
