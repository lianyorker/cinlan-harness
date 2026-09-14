# 通用设置（General Settings）迁移计划

## 1. 现状对比

### 1.1 Orca 的通用设置

Orca 的 `GeneralPane` 是一个聚合面板，包含以下子区域：

**子区域清单：**
1. **导航（Navigation）** — 标签页顺序（最近 vs 标签条）、关闭固定标签页确认
2. **工作区（Workspace）** — 工作区目录、嵌套工作区、删除确认（工作区/自动化/制品）、Open In Apps
3. **项目运行时（Project Runtime）** — WSL 支持（Windows 平台）
4. **编辑器（Editor）** — 自动保存、自动保存延迟、默认 Diff 视图、字体族、自动换行、小地图、Markdown 审查笔记
5. **CLI** — Cinlan IDE CLI 注册/移除、Agent 技能安装
6. **更新（Updates）** — 检查更新、版本信息
7. **支持（Support）** — 帮助链接、反馈、日志

**外观（Appearance）** — 独立面板：
- 主题选择（系统/深色/浅色）
- UI 缩放
- IDE 字体
- 标题栏应用名
- 最小化到托盘
- 菜单栏图标

### 1.2 DSH 的通用设置

DSH 的 General section 是一个**纯容器**，通过 `settings.general.item` 插槽聚合各功能插件贡献的设置行。

**当前已注册的 General items：**
1. **权限预设（permission）** — `ui-permission-presets`，order: -20
2. **语言（language）** — `locale`，order: 0
3. **外观/主题（appearance）** — `ui-theme`，order: 10
4. **字体大小（font-size）** — `ui-theme`，order: 11

**DSH 的设置架构特点：**
- General section 本身不包含任何设置项，纯由插槽聚合
- 每个功能插件自行注册其设置行
- 支持搜索过滤（通过 SettingsRoot 的搜索框）
- 支持本地化

### 1.3 差距分析

| 设置项 | Orca | DSH | 迁移建议 |
|--------|------|-----|----------|
| 语言 | ✅ | ✅ | 已有 |
| 主题/外观 | ✅ | ✅ | 已有 |
| 字体大小 | ✅ | ✅ | 已有 |
| 权限预设 | ❌ | ✅ | DSH 独有，保留 |
| 工作区目录 | ✅ | ❌ | 需迁移 |
| 嵌套工作区 | ✅ | ❌ | 需迁移 |
| 删除确认 | ✅ | ❌ | 需迁移 |
| Open In Apps | ✅ | ❌ | 可选迁移 |
| 标签页顺序 | ✅ | ❌ | 需迁移 |
| 关闭固定标签确认 | ✅ | ❌ | 需迁移 |
| 编辑器自动保存 | ✅ | ❌ | 需迁移 |
| 自动保存延迟 | ✅ | ❌ | 需迁移 |
| Diff 视图 | ✅ | ❌ | 需迁移 |
| 编辑器字体 | ✅ | ❌ | 已有字体大小，字体族可选 |
| 自动换行 | ✅ | ❌ | 需迁移 |
| 小地图 | ✅ | ❌ | 需迁移 |
| Markdown 审查笔记 | ✅ | ❌ | 需迁移 |
| CLI 注册 | ✅ | ❌ | 需迁移 |
| Agent 技能安装 | ✅ | ❌ | 需迁移 |
| 检查更新 | ✅ | ❌ | 需迁移 |
| UI 缩放 | ✅ | ❌ | 需迁移 |
| 最小化到托盘 | ✅ | ❌ | 需迁移 |
| 菜单栏图标 | ✅ | ❌ | 平台相关，可选 |
| WSL 支持 | ✅ | ❌ | Windows 平台，需迁移 |

## 2. 迁移目标

将 Orca 通用设置中**对 DSH 有意义的项**迁移过来，通过 `settings.general.item` 插槽机制注册。每个设置项由对应的功能插件贡献，保持 DSH 的去中心化架构。

## 3. 迁移方案

### 3.1 分类迁移

按 DSH 架构将设置项分为三类：

**A. 已有，无需迁移：**
- 语言、主题/外观、字体大小、权限预设

**B. 需要迁移（高优先级）：**
- 工作区目录、嵌套工作区、删除确认
- 编辑器自动保存、自动保存延迟、Diff 视图、自动换行、小地图
- UI 缩放
- CLI 注册
- 检查更新

**C. 可选迁移（低优先级）：**
- Open In Apps（DSH 可能无此概念）
- Markdown 审查笔记（依赖源代码控制集成）
- 最小化到托盘（平台相关）
- 菜单栏图标（macOS 相关）
- WSL 支持（Windows 相关）
- 标签页顺序（依赖 DSH 标签实现）
- 关闭固定标签确认（依赖 DSH 标签实现）

### 3.2 工作区设置

**新建 `ui-workspace-settings` 包或在现有 workspace 包中添加设置行。**

注册 `settings.general.item`：
- `workspace-directory` — 工作区根目录
- `nest-workspaces` — 嵌套工作区开关
- `confirm-delete-workspace` — 删除确认开关
- `confirm-delete-automation` — 自动化删除确认开关

```typescript
ctx.slots.inject('settings.general.item', () => ctx.slots.register({
  name: 'settings.general.item',
  id: 'workspace-directory',
  order: 1,
  locale: NS,
  inject: () => injected,
}, WorkspaceDirectoryRow))
```

### 3.3 编辑器设置

**新建 `ui-editor-settings` 包或在现有 editor 包中添加设置行。**

注册 `settings.general.item`：
- `editor-auto-save` — 自动保存开关
- `editor-auto-save-delay` — 自动保存延迟
- `editor-diff-view` — 默认 Diff 视图
- `editor-word-wrap` — 自动换行
- `editor-minimap` — 小地图开关

### 3.4 UI 缩放

**在 `ui-theme` 包中添加。**

```typescript
ctx.slots.inject('settings.general.item', () => ctx.slots.register({
  name: 'settings.general.item',
  id: 'ui-zoom',
  order: 12,
  locale: SETTINGS_NS,
  inject: () => zoomInjected,
}, ZoomRow))
```

### 3.5 CLI 注册

**新建 `ui-cli-settings` 包或在现有 CLI 包中添加。**

- 检测 CLI 是否已注册
- 注册/移除 CLI 命令
- 安装 Agent 技能

### 3.6 检查更新

**新建 `ui-update-settings` 包或在现有 update 包中添加。**

- 检查更新按钮
- 当前版本显示
- 更新日志链接

### 3.7 平台相关设置

**Windows 特有：**
- WSL 支持（项目运行时）

**macOS 特有：**
- 最小化到托盘
- 菜单栏图标

这些通过平台检测条件注册。

## 4. 实施阶段

### 阶段 1：工作区设置（2-3 天）
- 创建工作区设置行组件
- 注册 `settings.general.item`
- 实现工作区目录选择器
- 实现嵌套和确认开关
- 添加本地化文本

### 阶段 2：编辑器设置（2-3 天）
- 创建编辑器设置行组件
- 注册 `settings.general.item`
- 实现自动保存、延迟、Diff 视图
- 实现自动换行、小地图
- 添加本地化文本

### 阶段 3：UI 缩放（1 天）
- 在 `ui-theme` 中添加缩放设置行
- 实现缩放级别选择
- 添加本地化文本

### 阶段 4：CLI 和更新（2 天）
- 创建 CLI 注册设置行
- 创建检查更新设置行
- 添加本地化文本

### 阶段 5：平台相关设置（1-2 天）
- Windows WSL 支持
- macOS 托盘和菜单栏

## 5. 依赖项

- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-client-ui-primitives` — UI 基础组件
- 各功能包（workspace、editor、theme 等）

## 6. 风险和注意事项

1. **架构差异**：Orca 是单体面板，DSH 是插槽聚合。迁移时要遵循 DSH 的去中心化架构，每个设置项由对应功能包贡献。
2. **设置持久化**：DSH 使用 `ctx.settingsScope` 持久化设置，需确认每个设置项的存储位置。
3. **搜索支持**：DSH 的 SettingsRoot 已有搜索功能，但只搜索 section 标题。Orca 搜索到具体设置项。DSH 需要增强搜索以覆盖 item 级别。
4. **平台差异**：部分设置项是平台相关的，需要条件注册。
5. **功能依赖**：某些设置项依赖 DSH 尚未实现的功能（如标签页、自动化），这些项应推迟。

## 7. 优先级评估

**迁移优先级：高**

理由：
- 通用设置是用户最常访问的设置页面
- 工作区和编辑器设置是基础功能，影响日常使用
- DSH 已有框架（插槽机制），迁移成本相对较低
- 但需要逐项迁移，工作量分散在多个功能包中

**建议迁移顺序：在安全研发之后，集成之前。优先迁移工作区和编辑器设置。**
