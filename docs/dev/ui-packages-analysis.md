# Client UI 包分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

staged-final 有 5 个 main 不存在的 client 包，覆盖改进版侧边栏、Cinlan 品牌 UI、设计工作室 UI、语音听写 UI 和运行时客户端。

## 包清单

| 包 | 说明 | src 大小 |
|----|------|---------|
| `client/runtime` | 运行时客户端（最大） | ~1.2MB |
| `client/ui-better-sidebar` | 改进版侧边栏 | ~700KB |
| `client/ui-brand-cinlan` | Cinlan 品牌 UI | ~4.2KB |
| `client/ui-design-studio` | 设计工作室 UI | ~11.3KB |
| `client/ui-voice-dictation` | 语音听写 UI | ~33.6KB |

---

## 1. client/runtime（运行时客户端）

**最大的 client 包**，~1.2MB 源码，是 Web UI 的核心运行时。

### 源文件结构

**根级（`src/`）**：

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.ts` | 52.2KB | 主入口 |
| `invariant.ts` | 1.2KB | 运行时不变量 |
| `agent-pty.ts` | 20.5KB | Agent PTY 管理 |
| `browser-probe.ts` | 1.1KB | 浏览器探测 |
| `bundle-route.ts` | 4.8KB | Bundle 路由 |
| `config.ts` | 6.4KB | 配置 |
| `context-types.ts` | 22.4KB | 上下文类型 |
| `fs-operations.ts` | 5KB | 文件系统操作 |
| `fs-search.ts` | 3.4KB | 文件系统搜索 |
| `fs-tree.ts` | 6.1KB | 文件树 |
| `git.ts` | 9.2KB | Git 集成 |
| `html-route.ts` | 5.1KB | HTML 路由 |
| `jobs-routes.ts` | 3KB | 任务路由 |
| `open-external.ts` | 4.4KB | 外部打开 |
| `prefs-shared.ts` | 12.1KB | 共享偏好 |
| `pty-deps.ts` | 9.7KB | PTY 依赖检查 |
| `pty-manager.ts` | 15.8KB | PTY 管理器 |
| `sidechat-core.ts` | 19.9KB | 侧边聊天核心 |
| `sidechat-routes.ts` | 15.8KB | 侧边聊天路由 |
| `subagent-activity.ts` | 4.1KB | 子代理活动 |
| `subagent-live-route.ts` | 3.9KB | 子代理实时路由 |
| `tools.ts` | 22.8KB | 工具管理 |
| `trust-fence.ts` | 3.2KB | 信任围栏 |
| `wire.ts` | 3.4KB | 线协议 |

**builtins/（内置组件）**：

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.tsx` | 18KB | 内置入口 |
| `Sidebar.tsx` | 68.3KB | 侧边栏（最大组件） |
| `sidebar.module.css` | 64.8KB | 侧边栏样式 |
| `state.ts` | 50.9KB | 状态管理 |
| `service.ts` | 38.4KB | 服务层 |
| `SideCardSection.tsx` | 45.7KB | 侧卡片区域 |
| `SideCardSection.module.css` | 25.3KB | 侧卡片样式 |
| `SubagentView.tsx` | 34KB | 子代理视图 |
| `TerminalView.tsx` | 17.1KB | 终端视图 |
| `TextEditor.tsx` | 17.9KB | 文本编辑器 |
| `EditorHost.tsx` | 22KB | 编辑器宿主 |
| `FileTree.tsx` | 27.7KB | 文件树 |
| `GitView.tsx` | 21.2KB | Git 视图 |
| `SideChatView.tsx` | 23.5KB | 侧边聊天视图 |
| `split-pane.tsx` | 12.7KB | 分割面板 |
| `TabBar.tsx` | 12.7KB | 标签栏 |
| `TreePanel.tsx` | 10.8KB | 树面板 |
| `mermaid.tsx` | 15.8KB | Mermaid 图表 |
| `locales.ts` | 43.2KB | 国际化 |
| `upload.ts` | 7.8KB | 文件上传 |
| `DiffView.tsx` | 12.1KB | Diff 视图 |
| `icons.tsx` | 9.6KB | 图标 |
| `BrowserView.tsx` | 9.8KB | 浏览器视图 |
| `chunk-loader.ts` | 15.4KB | 代码块加载器 |
| `intercept.tsx` | 5.3KB | 拦截器 |
| `open-with.ts` | 8.6KB | 打开方式 |
| `prefs.ts` | 9.6KB | 偏好设置 |
| `theme.ts` | 4.8KB | 主题 |
| `api.ts` | 15.4KB | API 客户端 |
| ... | | |

**子目录**：

| 目录 | 说明 |
|------|------|
| `agents/` | Agent 管理器、会话、工作区 |
| `contract/` | 契约定义 |
| `conversation/` | 对话组装、上下文、投影 |
| `sessions/` | 会话管理、持久化、通知 |
| `workspaces/` | 工作区管理 |

### 核心功能

- **侧边栏** — 68KB 的 `Sidebar.tsx`，完整的工作区导航
- **状态管理** — 51KB 的 `state.ts`，全局状态
- **服务层** — 38KB 的 `service.ts`，API 调用和状态同步
- **终端** — PTY 管理、终端视图
- **编辑器** — CodeMirror 集成
- **Git** — Git 状态视图
- **子代理** — 子代理活动视图和实时路由
- **文件树** — 工作区文件浏览
- **Mermaid** — 图表渲染
- **国际化** — 43KB 的 locales

---

## 2. client/ui-better-sidebar（改进版侧边栏）

改进版的标签和视图系统。

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.ts` | 1.4KB | 入口 |
| `tabs.tsx` | 13.3KB | 标签页管理 |
| `viewers.tsx` | 5KB | 查看器 |

---

## 3. client/ui-brand-cinlan（Cinlan 品牌 UI）

Cinlan 品牌标识组件。

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.ts` | 271B | 入口 |
| `invariant.ts` | 1.1KB | 不变量 |
| `Brand.tsx` | 802B | 品牌组件 |
| `logo.ts` | 3.1KB | Logo 逻辑 |
| `logo.png` | 2.2KB | Logo 图片 |

---

## 4. client/ui-design-studio（设计工作室 UI）

设计工作室的 Web UI 组件。

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.ts` | 2.2KB | 入口 |
| `locales.ts` | 1.6KB | 国际化 |
| `DesignStudioView.tsx` | 7.8KB | 设计工作室视图 |
| `DesignStudioView.module.css` | 3KB | 样式 |

---

## 5. client/ui-voice-dictation（语音听写 UI）

语音听写的 Web UI 组件。

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.ts` | 257B | 入口 |
| `api.ts` | 3.4KB | API 客户端 |
| `apply.ts` | 3.3KB | 应用逻辑 |
| `dictation-controller.ts` | 5.4KB | 听写控制器 |
| `dictation.ts` | 4.3KB | 听写逻辑 |
| `microphone.ts` | 3.2KB | 麦克风管理 |
| `VoiceButton.tsx` | 2.3KB | 语音按钮 |
| `VoiceButton.module.css` | 663B | 按钮样式 |
| `VoiceSettingsSection.tsx` | 12KB | 设置页语音区域 |
| `VoiceSettingsSection.module.css` | 5.4KB | 设置样式 |
| `locales.ts` | 3.3KB | 国际化 |

---

## main 中是否存在

❌ main 没有这 5 个包。main 有不同的 client 包：

| main 的 client 包 | 说明 |
|-------------------|------|
| `file-upload` | 文件上传 |
| `resources` | 资源管理 |
| `store` | 状态存储 |
| `ui-approval` | 审批 UI |
| `ui-chat` | 聊天 UI |
| `ui-dockkit` | DockKit UI |
| `ui-open-in-app` | 应用内打开 |
| `ui-schedule` | 调度 UI |
| `ui-session` | 会话 UI |
| `ui-sidebar-files` | 侧边栏文件 |
| `ui-sidebar-right` | 右侧边栏 |
| `ui-sidebar-textpreview` | 文本预览 |

两者架构不同：staged-final 用大型 `client/runtime` 集中式管理，main 用分散的小包。

## 注意事项

- `client/runtime` 是最大的 client 包（~1.2MB），迁移工作量最大
- `Sidebar.tsx`（68KB）和 `state.ts`（51KB）是最大的单文件
- `locales.ts`（43KB）包含国际化字符串
- main 的 client 架构已重构为分散小包，直接迁移 `client/runtime` 可能与现有架构冲突
