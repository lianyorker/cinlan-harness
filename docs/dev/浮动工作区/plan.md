# 浮动工作区迁移计划

## 1. 当前状态

### DSH 已有
- `ui-dockkit`：完整的浮动面板框架（`FloatLayer` 组件，支持拖拽、缩放、dock/undock、z-order）
- `ui-sidebar-right`：右侧边栏面板，已使用 `FloatLayer` 和 `DockSurface`
- `ui-better-sidebar`：侧边卡片设置页，已有大量偏好设置（终端字体、shell 路径等）
- `ExpandButton`：会话头部的侧边栏展开按钮

### 缺少
- 浮动工作区概念：没有独立的设置页面管理浮动面板偏好
- 启用开关：没有全局开关控制浮动面板功能
- 终端目录：没有终端默认工作目录设置
- 切换按钮位置：展开/折叠按钮位置不可配置

## 2. 迁移目标

新建 `ui-floating-workspace` 包，利用现有 `dockkit FloatLayer`，提供：
1. 浮动工作区启用开关（`enabled` 字段，持久化到 `floating-workspace` 命名空间）
2. 终端默认工作目录设置（`terminalDirectory` 字段）
3. 侧边栏切换按钮位置选择（`toggleButtonPosition` 字段：`header` / `sidebar` / `floating`）
4. 浮动面板默认大小设置（`floatDefaultWidth` / `floatDefaultHeight`）

## 3. 实施阶段

### 阶段 1：新建包 + 设置命名空间 + 设置页面 ✅
- ✅ 创建 `packages/client/ui-floating-workspace` 包
- ✅ 定义 `FloatingWorkspaceSettings` 类型和 schemastery schema
- ✅ Host 入口注册 `floating-workspace` 命名空间
- ✅ Client 入口绑定 settingsScope 并注册 `settings.section` 插槽
- ✅ 实现 `FloatingWorkspaceSection` 组件（启用开关 + 终端目录 + 按钮位置 + 浮动面板大小）
- ✅ 添加中英文本地化（20 个键）

### 阶段 2：测试 + 文档 + 提交 ✅
- ✅ 单元测试 11 项通过
- ✅ typecheck 通过
- ✅ 已加入 web-app bundle
- ✅ 文档更新
