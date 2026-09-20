# 浏览器设置迁移计划：参考 orca 独立浏览器设置栏

> 本文保留早期迁移计划的目标、阶段与风险，不代表当前实现清单。当前能力以[浏览器设置说明](../../../packages/client/ui-settings-security/README.zh.md)为准；下文“拟新建（尚不存在）”只记录目录与拟议文件名，不是现有文件链接。

> 参考 orca 的 `BrowserPane.tsx` 独立设置页，将 DSH 的浏览器功能从侧边卡片（ui-better-sidebar）和 ui-settings-security 两处半实现状态，整合提升为 DSH Settings 的独立 section，并迁移 orca 已有但 DSH 缺失的浏览器功能。

## 现状对比

### DSH 当前浏览器实现（三处分散）

#### 1. 侧边卡片浏览器标签页（ui-better-sidebar）

**位置**：`@/packages/client/ui-better-sidebar/src/client/BrowserView.tsx` **入口**：`@/packages/client/ui-better-sidebar/src/client/builtins/tabs.tsx:286-323`

**现有功能**：

| 功能 | 实现位置 | 状态 |
|---|---|---|
| 地址栏 + 导航 | `BrowserView.tsx:40-80` | ✅ 基本可用 |
| 前进/后退/刷新 | `BrowserView.tsx` browserBar 按钮 | ✅ |
| 外部浏览器打开 | `BrowserView.tsx` `window.open(url, '_blank')` | ✅ |
| iframe sandbox | `BrowserView.tsx` sandbox tokens | ✅ |
| sandbox 开关 | `tabs.tsx:297` `browserNoSandbox` toggle | ✅ |
| 嵌入阻断检测 | `BrowserView.tsx` embedBlocked + `BrowserEmbedBlocked` | ✅ |
| URL 安全策略 | `browser.ts` normalizeUrl / blockLoopback | ✅ |
| 链接拦截 | `link-intercept.ts` registerLinkInterception | ✅ |
| 链接拦截开关 | `tabs.tsx:301-312` 4 个 toggle | ✅ |

**现有 4 项链接拦截设置**（`tabs.tsx:295-312`）：

| 设置 | 字段 (`SidebarPrefs`) | 控件 | 默认 |
|---|---|---|---|
| 关闭 sandbox | `browserNoSandbox` | switch | off |
| 拦截链接（总开关） | `browserInterceptLinks` | switch | on |
| 拦截 http 链接 | `browserInterceptHttp` | switch | on |
| 拦截 https 链接 | `browserInterceptHttps` | switch | off |

**缺失**：
- 无首页/默认 URL 设置
- 无搜索引擎设置
- 无缩放设置
- 无 Cookie/会话管理
- 无 Agent Browser Use 技能安装引导
- 无链接路由修饰键设置（Shift+Ctrl 反转）
- 无终端链接动作弹出开关
- 无 localhost worktree 标签
- iframe 沙箱限制：无法执行需要 same-origin 的操作（Cookie、localStorage、跨窗口通信）

#### 2. Settings Security 浏览器能力页（ui-settings-security）

**位置**：`@/packages/client/ui-settings-security/src/client/CapabilitySection.tsx:310-342`（`BrowserCapabilityBody`）

**现有功能**：

| 功能 | 实现位置 | 状态 |
|---|---|---|
| Provider 库存检查 | `CapabilitySection.tsx:386-403` list() | ✅ |
| 浏览器偏好表单 | `BrowserPreferencesForm.tsx` | ✅ |
| 浏览器控制操作 | `BrowserControls.tsx` | ✅ |
| Cookie 导入 | `BrowserControls.tsx:89-99` importCookies | ✅ |

**`BrowserPreferencesForm` 现有 7 项设置**（`BrowserPreferencesForm.tsx:48-70`）：

| 设置 | 字段 (`BrowserPreferences`) | 控件 |
|---|---|---|
| 浏览器通道 | `browserChannel` | select (chrome/msedge/chromium) |
| Headless 模式 | `headless` | checkbox |
| 视口宽度 | `viewportWidth` | number |
| 视口高度 | `viewportHeight` | number |
| Profile 名称 | `profileName` | text |
| 首页 URL | `homePage` | text |
| 搜索引擎 | `searchEngine` | select (google/bing/duckduckgo) |

**缺失**：
- 无链接路由设置（openLinksInApp）
- 无链接路由修饰键设置
- 无终端链接动作设置
- 无 localhost worktree 标签
- 无 Agent Browser Use 技能安装引导
- 无 sandbox 开关（这是侧边卡片独有的）
- 无链接拦截开关（这是侧边卡片独有的）

#### 3. 链接拦截注册（ui-better-sidebar index.tsx）

**位置**：`@/packages/client/ui-better-sidebar/src/client/index.tsx:290-340` **逻辑**：`registerLinkInterception` 在 document 级别捕获 click 事件，根据 `browserInterceptLinks` 总开关和 `browserInterceptHttp`/`browserInterceptHttps` 协议开关决定是否将外部链接路由到侧边栏浏览器标签页。

### orca 浏览器设置实现（参考目标）

**位置**：`@/orca/src/renderer/src/components/settings/BrowserPane.tsx`

orca 的 `BrowserPane` 是一个完整的独立设置页，包含以下模块：

| 模块 | 组件 | 功能 |
|---|---|---|
| Agent Browser Use | `BrowserUseSetup` | 三步引导：CLI 注册 → 技能安装 → Cookie 导入 |
| 默认首页 | `BrowserHomePageSetting` | 新标签页打开的默认 URL |
| 默认搜索引擎 | `BrowserSearchEngineSetting` | 地址栏非 URL 文本的搜索引擎 |
| 默认缩放 | `BrowserDefaultZoomSetting` | 新标签页的缩放级别 |
| 链接路由 | `BrowserLinkRoutingSetting` | `openLinksInApp` 总开关 |
| 链接路由修饰键 | `BrowserLinkRoutingModifierSetting` | `openLinksInAppModifierInverts` Shift+Ctrl 反转 |
| 终端链接动作 | `BrowserTerminalLinkActionsSetting` | `terminalLinkActionPopoverEnabled` |
| Localhost Worktree 标签 | `BrowserLocalhostWorktreeLabelsSetting` | 端口标签区分 |
| 会话与 Cookie | `BrowserSessionCookiesSection` | 多 Profile 管理 + Cookie 导入 |

**orca 浏览器标签页 UI**（`@/orca/src/renderer/src/components/browser-pane/BrowserPane.tsx`，5744 行）：
- Electron webview（非 iframe），可访问 same-origin API
- Grab 功能：悬停元素 → 确认 → 复制文本/截图/标注发送给 Agent
- 标注（Annotation）系统：在页面上标注元素并附加意图标签
- 远程浏览器流：支持远程浏览器驱动
- 下载管理、网络检查、历史记录
- 证书信任处理
- 视口预设

## 差异总结

| 维度 | DSH 侧边卡片 | DSH Settings Security | orca |
|---|---|---|---|
| 渲染方式 | iframe sandbox | 无浏览器视图 | Electron webview |
| 首页设置 | ❌ | ✅ `homePage` | ✅ `BrowserHomePageSetting` |
| 搜索引擎 | ❌ | ✅ `searchEngine` | ✅ `BrowserSearchEngineSetting` |
| 缩放 | ❌ | ❌ | ✅ `BrowserDefaultZoomSetting` |
| 链接路由 | ✅ 4 toggle | ❌ | ✅ 单开关 + 修饰键 |
| Cookie 管理 | ❌ | ✅ 导入 | ✅ 多 Profile |
| Agent 技能引导 | ❌ | ❌ | ✅ 三步引导 |
| 终端链接动作 | ❌ | ❌ | ✅ |
| Localhost 标签 | ❌ | ❌ | ✅ |
| sandbox 开关 | ✅ | ❌ | ❌（webview 不需要） |
| Grab/标注 | ❌ | ❌ | ✅ |

## 迁移策略

将三处分散的浏览器设置整合为 DSH Settings 的一个独立 section `cinlan-browser`，保留侧边卡片浏览器标签页作为浏览器视图入口，但将所有设置项迁移到 Settings 页面。

### 命名与注册

- 新 section id：`cinlan-browser`（与现有 `ui-settings-security` 的 `cinlan-browser` section 合并或替换）
- 导航标签：`Browser` / `浏览器`
- 图标：`IconGlobeOutline14`
- 注册方式：通过 `ctx.slots.register('settings.section', ...)` 注册

### 架构决策

1. **保留 iframe 方案**：DSH 的侧边卡片浏览器使用 iframe sandbox，orca 使用 Electron webview。迁移不改变渲染方式（iframe → webview 是架构级变更，不在本次范围），但将 sandbox 开关从侧边卡片 toggle 提升到 Settings section。
2. **合并两个浏览器 section**：当前 `ui-settings-security` 已有 `cinlan-browser` section（`BrowserCapabilityBody`），将其与侧边卡片的浏览器设置合并为一个统一的浏览器设置页。
3. **链接拦截保留在侧边卡片**：`registerLinkInterception` 是运行时行为，不是设置项，保留在 `ui-better-sidebar` 的 `index.tsx`，但其开关迁移到 Settings section。

## 分阶段实施

### 阶段 1：创建统一浏览器 Settings section

**目标**：将侧边卡片的 4 个浏览器 toggle 和 `ui-settings-security` 的 `BrowserCapabilityBody` 合并为一个 Settings section。

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `BrowserSettingsSection.tsx`。当前页面由 [CapabilitySection.tsx](../../../packages/client/ui-settings-security/src/client/CapabilitySection.tsx) 中的 `BrowserCapabilityBody` 组合，未拆为此拟议文件。
   - 合并 `BrowserCapabilityBody` 的 Provider 检查 + `BrowserPreferencesForm` + 侧边卡片的 sandbox/链接拦截 toggle
   - 结构：Provider 状态卡 → 浏览器偏好表单 → 链接路由设置 → sandbox 设置 → Cookie 管理

2. **修改** `@/packages/client/ui-settings-security/src/client/index.ts`
   - 将 `cinlan-browser` section 的渲染从 `CapabilitySection`（`BrowserCapabilityBody`）切换到新的 `BrowserSettingsSection`
   - 注入侧边卡片的 `SidebarPrefs` 读写能力（通过 `settingsScope`）

3. **修改** `@/packages/client/ui-better-sidebar/src/client/builtins/tabs.tsx:286-323`
   - 移除 browser tab 的 `settings.toggles`（4 个链接拦截 toggle）
   - 保留 browser tab 的 `createTab` 和 `component`

4. **修改** `@/packages/client/ui-better-sidebar/src/client/index.tsx:290-340`
   - 链接拦截注册逻辑保留，但读取的偏好键从 `SidebarPrefs` 迁移到 `settingsScope`（或保持 `SidebarPrefs` 但由 Settings section 写入）

**新增设置项**（从 `SidebarPrefs` 迁移或新增）：

| 设置 | 字段 | 控件 | 来源 |
|---|---|---|---|
| 关闭 sandbox | `browserNoSandbox` | switch | 侧边卡片迁移 |
| 拦截链接总开关 | `browserInterceptLinks` | switch | 侧边卡片迁移 |
| 拦截 http 链接 | `browserInterceptHttp` | switch | 侧边卡片迁移 |
| 拦截 https 链接 | `browserInterceptHttps` | switch | 侧边卡片迁移 |
| 浏览器通道 | `browserChannel` | select | 已有 |
| Headless | `headless` | checkbox | 已有 |
| 视口宽度 | `viewportWidth` | number | 已有 |
| 视口高度 | `viewportHeight` | number | 已有 |
| Profile 名称 | `profileName` | text | 已有 |
| 首页 URL | `homePage` | text | 已有 |
| 搜索引擎 | `searchEngine` | select | 已有 |

### 阶段 2：迁移 orca 缺失功能

**目标**：将 orca 有但 DSH 缺失的浏览器设置项添加到新 section。

**新增设置项**：

| 设置 | 字段 | 控件 | 参考 |
|---|---|---|---|
| 默认缩放 | `browserDefaultZoom` | number/slider | `BrowserDefaultZoomSetting` |
| 链接路由修饰键反转 | `browserLinkModifierInverts` | switch | `BrowserLinkRoutingModifierSetting` |
| 终端链接动作弹出 | `terminalLinkActionPopover` | switch | `BrowserTerminalLinkActionsSetting` |
| Localhost worktree 标签 | `browserLocalhostLabels` | switch | `BrowserLocalhostWorktreeLabelsSetting` |

**文件变更**：

1. **修改** `BrowserSettingsSection.tsx`：添加上述设置行
2. **修改** `@/packages/client/ui-settings-security/src/client/locales.ts`：添加新设置项的 i18n 键
3. **修改** `@/packages/client/ui-better-sidebar/src/client/link-intercept.ts`：支持修饰键反转逻辑（Shift+Ctrl 点击反转链接路由）

### 阶段 3：Agent Browser Use 技能引导

**目标**：迁移 orca 的 `BrowserUseSetup` 三步引导到 DSH。

**参考**：`@/orca/src/renderer/src/components/settings/BrowserUsePane.tsx`

orca 的三步引导：
1. CLI 注册（`ensureOrcaCliAvailableForAgentSkillTerminal`）
2. Browser Use 技能安装（`useInstalledAgentSkill(ORCA_CLI_SKILL_NAME)`）
3. Cookie 导入（`fetchBrowserSessionProfiles`）

**DSH 适配**：
- DSH 无 Electron IPC `window.api.cli`，需通过 `ctx.remote` 或 `ctx.slots` 暴露 CLI 检查能力
- DSH 的技能安装通过 `dsh --profile` 命令，非 orca 的 `orca-cli` skill install
- Cookie 导入已有 `BrowserControls.importCookies`，可复用

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `BrowserUseSetupSection.tsx`
   - 简化版三步引导：检查 Provider → 显示安装命令 → Cookie 导入
2. **修改** `BrowserSettingsSection.tsx`：在顶部嵌入 `BrowserUseSetupSection`

### 阶段 4：多 Profile Cookie 管理（可选）

**目标**：迁移 orca 的多浏览器 Profile 管理。

**参考**：`@/orca/src/renderer/src/components/settings/BrowserSessionCookiesSection.tsx`

orca 支持：
- 默认 Profile + 自定义 Profile
- 从 Chrome/Edge/Arc 导入 Cookie
- 按 Profile 切换
- 按 Host 选择 Profile 来源

**DSH 适配**：
- DSH 当前只有单 Profile（`BrowserPreferences.profileName`）
- 需扩展 `BrowserPreferences` 类型支持多 Profile
- 需新增 Remote API 枚举系统浏览器

**文件变更**：

1. **修改** `@/packages/dsh-browser-playwright/types.ts`：扩展 `BrowserPreferences` 支持多 Profile
2. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `BrowserSessionCookiesSection.tsx`。当前 Cookie 导入见 [BrowserControls.tsx](../../../packages/client/ui-settings-security/src/client/BrowserControls.tsx)，不代表此处规划的多 Profile 管理已实现。
3. **修改** `BrowserSettingsSection.tsx`：嵌入 Cookie 管理区

## 风险

1. **iframe vs webview 限制**：iframe sandbox 无法实现 orca 的 Grab/标注功能（需要 same-origin 访问 DOM）。如需这些功能，需迁移到 Electron webview 或 BrowserView，这是架构级变更。
2. **偏好存储迁移**：侧边卡片的 `SidebarPrefs` 和 `ui-settings-security` 的 `BrowserPreferences` 是两个独立的 settingsScope namespace，合并需决定统一存储位置或保持双存储 + 同步。
3. **链接拦截耦合**：`registerLinkInterception` 在 `ui-better-sidebar` 的 `index.tsx` 初始化时注册，依赖 `SidebarPrefs` 的实时值。迁移设置项后需确保拦截逻辑仍能读取到最新值。
4. **Settings section 冲突**：`ui-settings-security` 已注册 `cinlan-browser` section，新增 section 需替换或合并，避免重复导航项。
