# 终端设置迁移计划：参考 orca 独立终端设置栏

> 参考 orca 的 `TerminalPane.tsx` 独立设置页，将 DSH-better-sidebar 的终端设置从侧边卡片 Modal 弹窗提升为 DSH Settings 的独立 section，并迁移 orca 已有但 DSH 缺失的终端功能。

## 现状对比

### DSH-better-sidebar 当前终端设置

**位置**：嵌在侧边卡片设置页的 terminal tab 齿轮 Modal 弹窗里
**入口**：`@/packages/client/ui-better-sidebar/src/client/builtins/tabs.tsx:233-268` 的 `settings.toggles`
**渲染**：`@/packages/client/ui-better-sidebar/src/client/SideCardSection.tsx` 的 `SettingsBody` Modal

**现有 6 项设置**：

| 设置 | 字段 (`SidebarPrefs`) | 控件类型 | 实现位置 |
|---|---|---|---|
| Agent 终端工具 | `agentTerminalTools` | switch | `tabs.tsx:235` |
| 底部面板自动开终端 | `bottomPanelAutoTerminal` | switch | `tabs.tsx:239` |
| Shell 路径 | `terminalShell` | text | `tabs.tsx:243` |
| Shell 参数 | `terminalShellArgs` | text | `tabs.tsx:249` |
| 终端字体族 | `terminalFontFamily` | text | `tabs.tsx:255` |
| 终端字号 | `terminalFontSize` | number (9-32) | `tabs.tsx:261` |

**终端渲染**：`@/packages/client/ui-better-sidebar/src/client/TerminalView.tsx`
- xterm.js `Terminal` 硬编码配置（`TerminalView.tsx:121-128`）：
  - `cursorBlink: true`
  - `allowTransparency: true`
  - `convertEol: false`
  - `scrollback: 4000` ← 硬编码，不可配置
  - 无 WebGL addon ← 纯 DOM renderer
  - 无 `wordSeparator` ← 用 xterm 默认值
  - 无滚动灵敏度配置
  - 无右键粘贴
  - 无 Copy on Select
  - 无 OSC 52 剪贴板

**PTY 管理**：`@/packages/client/ui-better-sidebar/src/pty-manager.ts`
- `SidebarPty` 注册表，按 `${sessionId}:${tabId}` key 管理 node-pty 进程
- 支持断线重连、transcript 回放、park/close 生命周期
- 无会话管理 UI（无法查看/kill 活跃会话）

### orca 终端设置（独立设置页）

**位置**：DSH Settings 独立 section，标题"终端"
**入口**：`@/orca/src/renderer/src/components/settings/TerminalPane.tsx`

**6 个分区**：

| 分区 | 组件 | 设置项 |
|---|---|---|
| **Windows Shell** | `TerminalWindowsShellSection` | 默认 Shell（PowerShell / cmd / Git Bash / WSL），分段控件带图标 |
| **Rendering** | `TerminalRenderingSection` | GPU 加速（Auto / On / Off），控制 xterm.js WebGL vs DOM renderer |
| **Interaction** | `TerminalInteractionSection` | 滚动速度（normal/fast/TUI 三档 slider）、右键粘贴、Focus Follows Mouse、Copy on Select、OSC 52 剪贴板 |
| **Setup Script** | `TerminalSetupScriptSection` | 工作区启动脚本位置（New Tab / Split Vertical / Split Horizontal） |
| **Manage Sessions** | `ManageSessionsSection` | PTY 会话管理（列表、kill 单个/全部、重启 daemon） |
| **Advanced** | `TerminalAdvancedSection` | Scrollback 行数（preset/custom）、Word Separators、PowerShell 版本选择、Mac 键盘（Option as Alt、JIS Yen） |

### 差距矩阵

| 能力 | DSH | orca | 迁移策略 |
|---|---|---|---|
| Shell 路径 | ✅ 自由文本 | ✅ 平台感知分段控件 | **保留** DSH 的自由文本（更灵活），可选追加平台感知预设 |
| Shell 参数 | ✅ | ❌ | **保留**（DSH 独有） |
| 字体族 + 字号 | ✅ | ❌ | **保留**（DSH 独有） |
| Agent 终端工具 | ✅ | ❌ | **保留**（DSH 独有） |
| 底部面板自动终端 | ✅ | ❌ | **保留**（DSH 独有） |
| **GPU 渲染器** | ❌ 硬编码 DOM | ✅ Auto/On/Off | **迁移** — 新增 WebGL addon + 偏好 |
| **Scrollback 行数** | ❌ 硬编码 4000 | ✅ preset/custom | **迁移** — 新增可配置 |
| **滚动速度** | ❌ 无 | ✅ 三档 slider | **迁移** — xterm.js 原生支持 |
| **右键粘贴** | ❌ 无 | ✅ switch | **迁移** — contextmenu 事件 |
| **Copy on Select** | ❌ 无 | ✅ switch | **迁移** — onSelectionChange |
| **OSC 52 剪贴板** | ❌ 无 | ✅ switch | **迁移** — PTY 层解析 |
| **Focus Follows Mouse** | ❌ 无 | ✅ switch | **迁移** — DOM 事件 |
| **Word Separators** | ❌ 无 | ✅ text | **迁移** — xterm.js `wordSeparator` |
| **会话管理** | ❌ 无 UI | ✅ 列表 + kill | **迁移** — 暴露 pty-manager API |
| Setup Script | ❌ 无 | ✅ | **不迁移**（DSH 无 worktree 概念） |
| Windows Shell 选择 | ❌ 自由文本 | ✅ 分段控件 | **不迁移**（DSH 已有文本输入更通用） |
| Mac 键盘 | ❌ 无 | ✅ Option as Alt / JIS Yen | **暂不迁移**（低优先级，DSH 当前主要在 Windows） |

## 目标架构

### 独立终端设置 Section

在 DSH Settings shell 中注册新的 `settings.section`，id 为 `terminal`，与现有的 `better-sidebar` section 并列：

```
DSH Settings 导航:
├── general          (order: 0)
├── better-sidebar   (order: 100)  ← 现有侧边卡片设置
├── terminal         (order: 110)  ← 新增终端设置
└── ...
```

**Section 结构**（参考 orca `TerminalPane.tsx`）：

```
终端
Shell、渲染器、会话和终端行为。

┌─ Shell ─────────────────────────────────────────────┐
│  Shell 路径        [text input]                      │
│  Shell 参数        [text input]                      │
│  (保留 DSH 现有 shell 设置，从 Modal 迁移到这里)      │
└─────────────────────────────────────────────────────┘

┌─ 渲染器 ─────────────────────────────────────────────┐
│  GPU 加速         [Auto / On / Off]                  │
│  (新增：控制 WebGL vs DOM renderer)                   │
└─────────────────────────────────────────────────────┘

┌─ 外观 ───────────────────────────────────────────────┐
│  字体族           [text input]                      │
│  字号             [number input]                     │
│  (保留 DSH 现有字体设置，从 Modal 迁移到这里)          │
└─────────────────────────────────────────────────────┘

┌─ 交互 ───────────────────────────────────────────────┐
│  右键粘贴         [switch]                           │
│  选中即复制       [switch]                           │
│  Focus Follows Mouse  [switch]                       │
│  OSC 52 剪贴板    [switch]                           │
│  滚动速度         [slider × 3]                       │
│  Word Separators  [text input]                       │
└─────────────────────────────────────────────────────┘

┌─ 高级 ───────────────────────────────────────────────┐
│  Scrollback 行数  [preset toggle + custom input]     │
└─────────────────────────────────────────────────────┘

┌─ 会话管理 ───────────────────────────────────────────┐
│  活跃 PTY 会话列表                                    │
│  [刷新] [全部 Kill] [重启]                            │
└─────────────────────────────────────────────────────┘

┌─ Agent 终端 ─────────────────────────────────────────┐
│  Agent 终端工具    [switch]                           │
│  底部面板自动终端  [switch]                           │
│  (保留 DSH 独有设置)                                  │
└─────────────────────────────────────────────────────┘
```

### 偏好字段变更

在 `@/packages/client/ui-better-sidebar/src/prefs-shared.ts` 的 `SidebarPrefs` 新增字段：

```typescript
// ── 渲染器 ──
/** GPU 加速模式：auto（尝试 WebGL，失败回退 DOM）/ on（强制 WebGL）/ off（强制 DOM） */
terminalGpuAcceleration: 'auto' | 'on' | 'off'

// ── 交互 ──
/** 右键粘贴剪贴板 */
terminalRightClickPaste: boolean
/** 选中即复制到剪贴板 */
terminalCopyOnSelect: boolean
/** 鼠标悬停自动聚焦终端 */
terminalFocusFollowsMouse: boolean
/** 允许 TUI 程序通过 OSC 52 写剪贴板 */
terminalAllowOsc52: boolean
/** 滚动灵敏度（normal） */
terminalScrollSensitivity: number
/** 快速滚动灵敏度（按修饰键时） */
terminalFastScrollSensitivity: number
/** TUI 鼠标滚轮倍率 */
terminalTuiScrollSensitivity: number
/** 双击选词的分隔符 */
terminalWordSeparator: string

// ── 高级 ──
/** Scrollback 行数 */
terminalScrollbackRows: number
```

**默认值**（`SIDEBAR_PREFS_DEFAULTS`）：

```typescript
terminalGpuAcceleration: 'auto',
terminalRightClickPaste: false,
terminalCopyOnSelect: false,
terminalFocusFollowsMouse: false,
terminalAllowOsc52: false,
terminalScrollSensitivity: 1,
terminalFastScrollSensitivity: 5,
terminalTuiScrollSensitivity: 3,
terminalWordSeparator: ' ()[]{},"\`',
terminalScrollbackRows: 10000,
```

## 分阶段实施

### Phase 1：独立设置页骨架（1-2 天）

**目标**：创建独立的终端设置 section，把现有 6 项设置从 Modal 弹窗迁移过来。

**改动文件**：

- `packages/client/ui-better-sidebar/src/prefs-shared.ts` — 新增偏好字段 + 默认值
- `packages/client/ui-better-sidebar/src/client/builtins/tabs.tsx` — 从 terminal tab descriptor 的 `settings.toggles` 中移除 shell/font/tools/bottom 相关 toggles（它们移到独立 section）
- `packages/client/ui-better-sidebar/src/client/TerminalSettingsSection.tsx` — **新建**，独立的终端设置 section 组件，注册到 DSH settings shell
- `packages/client/ui-better-sidebar/src/client/index.tsx` — 注册 `settings.section` id=`terminal`，order=110
- `packages/client/ui-better-sidebar/src/client/locales.ts` — 新增终端设置 section 的 i18n 字符串

**验证**：DSH Settings 导航出现"终端"条目，点进去能看到 Shell 路径、Shell 参数、字体、字号、Agent 工具、底部面板 6 项设置，功能与之前 Modal 弹窗一致。

---

### Phase 2：GPU 渲染器（1 天）

**目标**：支持 WebGL 渲染器，参考 orca `TerminalRenderingSection`。

**改动文件**：

- `packages/client/ui-better-sidebar/package.json` — 新增依赖 `@xterm/addon-webgl`
- `packages/client/ui-better-sidebar/src/client/TerminalView.tsx`：
  - 在 `term.open(host)` 之后，根据 `terminalGpuAcceleration` 偏好条件加载 `WebglAddon`
  - `auto`：尝试 `term.loadAddon(new WebglAddon())`，catch 失败则保持 DOM renderer
  - `on`：强制加载 WebGL，失败则报错
  - `off`：不加载 WebGL
  - 偏好变更时需要重新创建终端（WebGL addon 不能热切换），通过 store subscribe 检测 `terminalGpuAcceleration` 变化
- `packages/client/ui-better-sidebar/src/client/TerminalSettingsSection.tsx` — 新增"渲染器"分区，Auto/On/Off 分段控件

**参考**：orca `@/orca/src/renderer/src/components/settings/TerminalRenderingSection.tsx`

**验证**：设置 GPU 加速为 On 后，终端使用 WebGL 渲染（可通过 xterm 的 renderer 类型确认）；设为 Off 回退 DOM renderer。

---

### Phase 3：Scrollback 可配置（半天）

**目标**：scrollback 行数从硬编码 4000 改为可配置，参考 orca `TerminalAdvancedSection`。

**改动文件**：

- `packages/client/ui-better-sidebar/src/client/TerminalView.tsx:127` — `scrollback: 4000` 改为 `scrollback: prefs.terminalScrollbackRows`
- `packages/client/ui-better-sidebar/src/client/TerminalSettingsSection.tsx` — 新增"高级"分区，preset toggle（1k/5k/10k/50k）+ custom number input
- `packages/client/ui-better-sidebar/src/prefs-shared.ts` — 新增 `terminalScrollbackRows` 字段 + clamp 函数

**参考**：orca `@/orca/src/renderer/src/components/settings/TerminalAdvancedSection.tsx:86-174`

**验证**：修改 scrollback 行数后，新开的终端 tab 使用新的 scrollback 值。

---

### Phase 4：交互行为（2-3 天）

**目标**：迁移 orca 的终端交互设置。

#### 4.1 右键粘贴

**改动**：
- `TerminalView.tsx` — 在 xterm 容器上添加 `contextmenu` 事件监听
  - `terminalRightClickPaste` 为 true 时：阻止默认菜单，粘贴剪贴板内容到终端
  - Ctrl/Cmd + 右键：始终弹出原生菜单（escape hatch）
- `TerminalSettingsSection.tsx` — 新增 switch 行

**参考**：orca `TerminalInteractionSection.tsx:247-270`

#### 4.2 选中即复制

**改动**：
- `TerminalView.tsx` — 监听 `term.onSelectionChange`
  - `terminalCopyOnSelect` 为 true 时：选区变化自动 `writeClipboard(term.getSelection())`
- `TerminalSettingsSection.tsx` — 新增 switch 行

**参考**：orca `TerminalInteractionSection.tsx:301-333`

#### 4.3 Focus Follows Mouse

**改动**：
- `TerminalView.tsx` — 在终端容器上添加 `mouseenter` 事件
  - `terminalFocusFollowsMouse` 为 true 时：`term.focus()`
- `TerminalSettingsSection.tsx` — 新增 switch 行

**参考**：orca `TerminalInteractionSection.tsx:272-299`

#### 4.4 OSC 52 剪贴板

**改动**：
- `pty-manager.ts` 或 WebSocket 终端层 — 解析 PTY 输出中的 OSC 52 序列
  - `terminalAllowOsc52` 为 true 时：解析 `ESC ] 52 ; <clipboard> ; <base64> ST`，写入系统剪贴板
  - 为 false 时：丢弃 OSC 52 序列
- `TerminalSettingsSection.tsx` — 新增 switch 行

**参考**：orca `TerminalInteractionSection.tsx:335-377`

#### 4.5 滚动速度

**改动**：
- `TerminalView.tsx` — 在 `Terminal` 构造选项中加入：
  - `scrollSensitivity: prefs.terminalScrollSensitivity`
  - `fastScrollSensitivity: prefs.terminalFastScrollSensitivity`
  - `fastScrollModifier: 'alt'`
- TUI 滚轮倍率需要在 `term.onMouse` 或 wheel 事件层处理（xterm.js 无直接选项）
- `TerminalSettingsSection.tsx` — 新增三档 slider（normal / fast / TUI）

**参考**：orca `TerminalInteractionSection.tsx:130-245`

#### 4.6 Word Separators

**改动**：
- `TerminalView.tsx:121-128` — Terminal 构造选项加入 `wordSeparator: prefs.terminalWordSeparator`
- `TerminalSettingsSection.tsx` — 新增 text input

**参考**：orca `TerminalAdvancedSection.tsx:176-202`

**验证**：各项交互开关后行为符合预期，关闭后恢复默认行为。

---

### Phase 5：会话管理（1-2 天）

**目标**：在设置页展示活跃 PTY 会话列表，支持 kill 单个/全部。

**改动文件**：

- `packages/client/ui-better-sidebar/src/pty-manager.ts` — 暴露 `listSessions()` API，返回活跃 `SidebarPty[]`（sessionId、tabId、shell、cwd、exited）
- `packages/client/ui-better-sidebar/src/index.ts` — 在 `buildApi` 中新增 `terminal.sessions` 和 `terminal.kill` HTTP API 方法
- `packages/client/ui-better-sidebar/src/client/api.ts` — 新增 `api.terminalSessions()` 和 `api.terminalKill(sessionId, tabId)` 客户端调用
- `packages/client/ui-better-sidebar/src/client/TerminalSettingsSection.tsx` — 新增"会话管理"分区：
  - 活跃会话表格（shell 名称、session ID、tab ID、cwd）
  - 每行一个 Kill 按钮
  - 全部 Kill 按钮
  - 刷新按钮

**参考**：orca `@/orca/src/renderer/src/components/settings/ManageSessionsSection.tsx`

**验证**：打开终端 tab 后，设置页能看到对应会话；Kill 后终端 tab 断开连接。

---

### Phase 6：偏好热更新（1 天）

**目标**：终端设置变更后，已打开的终端 tab 实时生效（无需关闭重开）。

**改动文件**：

- `packages/client/ui-better-sidebar/src/client/TerminalView.tsx` — 扩展 `store.subscribe` 回调：
  - `terminalScrollbackRows` 变化 → `term.options.scrollback = newValue`（xterm.js 支持热更新）
  - `terminalWordSeparator` 变化 → `term.options.wordSeparator = newValue`
  - `terminalScrollSensitivity` / `terminalFastScrollSensitivity` 变化 → 更新 `term.options`
  - `terminalGpuAcceleration` 变化 → 需要重新创建终端（dispose + 重建），因为 WebGL addon 不能热切换
  - `terminalRightClickPaste` / `terminalCopyOnSelect` / `terminalFocusFollowsMouse` / `terminalAllowOsc52` 变化 → 更新事件监听器开关

**验证**：修改任何终端设置后，已打开的终端 tab 立即反映新配置。

## 文件清单

### 新建文件

| 文件 | 说明 |
|---|---|
| `packages/client/ui-better-sidebar/src/client/TerminalSettingsSection.tsx` | 独立终端设置 section 组件 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `packages/client/ui-better-sidebar/src/prefs-shared.ts` | 新增 10 个偏好字段 + 默认值 + clamp 函数 |
| `packages/client/ui-better-sidebar/src/client/builtins/tabs.tsx` | 从 terminal tab 的 `settings.toggles` 移除迁移到独立 section 的设置项 |
| `packages/client/ui-better-sidebar/src/client/TerminalView.tsx` | WebGL addon、scrollback、wordSeparator、scrollSensitivity、右键粘贴、copy on select、focus follows mouse、OSC 52 |
| `packages/client/ui-better-sidebar/src/client/index.tsx` | 注册 `settings.section` id=`terminal` |
| `packages/client/ui-better-sidebar/src/client/locales.ts` | 新增终端设置 section 的 i18n 字符串 |
| `packages/client/ui-better-sidebar/src/client/api.ts` | 新增 `terminalSessions()` 和 `terminalKill()` API |
| `packages/client/ui-better-sidebar/src/index.ts` | 在 `buildApi` 中新增会话管理 HTTP API |
| `packages/client/ui-better-sidebar/src/pty-manager.ts` | 暴露 `listSessions()` 和 `killSession()` 方法 |
| `packages/client/ui-better-sidebar/package.json` | 新增 `@xterm/addon-webgl` 依赖 |

### 不迁移的 orca 功能

| orca 功能 | 原因 |
|---|---|
| Windows Shell 分段控件 | DSH 已有自由文本输入，更通用 |
| Setup Script | DSH 无 worktree 概念 |
| Mac 键盘（Option as Alt / JIS Yen） | 低优先级，DSH 当前主要在 Windows |
| PowerShell 版本选择 | DSH 的 `defaultShell()` 已有 pwsh.exe 检测链 |
| Quick Commands | 独立功能，不属于终端设置范畴 |

## 里程碑

| 里程碑 | 预期时间 | 交付物 |
|---|---|---|
| M1: 独立设置页 | 第 2 天 | 终端 section 注册，现有 6 项迁移完成 |
| M2: GPU 渲染器 | 第 3 天 | WebGL addon + Auto/On/Off 控件 |
| M3: Scrollback | 第 3.5 天 | 可配置 scrollback 行数 |
| M4: 交互行为 | 第 6 天 | 右键粘贴、copy on select、OSC 52、滚动速度、word separators、focus follows mouse |
| M5: 会话管理 | 第 8 天 | PTY 会话列表 + kill |
| M6: 偏好热更新 | 第 9 天 | 已打开终端实时生效 |

## 风险与对策

| 风险 | 对策 |
|---|---|
| WebGL addon 在某些 GPU/驱动上崩溃 | `auto` 模式 catch 失败回退 DOM renderer，与 orca 一致 |
| OSC 52 解析增加 PTY 层复杂度 | 在 WebSocket 消息处理层做轻量正则匹配，不影响正常输出 |
| 偏好热更新需要重建终端 | GPU 加速变更时 dispose + 重建终端，保留 transcript 回放 |
| 从 Modal 迁移到独立 section 破坏现有用户偏好 | 偏好字段名不变，只是 UI 位置变化，数据层无迁移 |
| `@xterm/addon-webgl` 增加包体积 | 通过 chunk-loader 懒加载（与 xterm.js 一致） |
