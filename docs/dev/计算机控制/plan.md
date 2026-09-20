# 计算机控制设置迁移计划：参考 orca 独立计算机控制设置栏

> 本文保留早期迁移计划的目标、阶段与风险，不代表当前实现清单。当前能力以[计算机控制设置说明](../../../packages/client/ui-settings-security/README.zh.md)为准；下文“拟新建（尚不存在）”只记录目录与拟议文件名，不是现有文件链接。

> 参考 orca 的 `ComputerUsePane.tsx` 独立设置页，将 DSH 的计算机控制功能从 `ui-settings-security` 的半实现状态提升为完整的 DSH Settings section，并迁移 orca 已有的权限管理 UI 和技能安装引导。

## 现状对比

### DSH 当前计算机控制实现（两处分散）

#### 1. Settings Security 计算机能力页（ui-settings-security）

**位置**：`@/packages/client/ui-settings-security/src/client/CapabilitySection.tsx:231-248`（`ComputerCapabilityBody`）

**现有功能**：

| 功能 | 实现位置 | 状态 |
|---|---|---|
| Provider 库存检查 | `CapabilitySection.tsx:386-403` list() + `CAPABILITY_MATCHERS.computer` | ✅ |
| 设备就绪探测 | `CapabilitySection.tsx:389` `checkDevice('computer')` | ✅ |
| 安装命令展示 | `CapabilitySection.tsx:239` `CopyText` `dsh --profile device-control` | ✅ |
| 功能说明卡片 | `COMPUTER_CARDS` (observe/operate/verify) | ✅ |
| 刷新按钮 | `RefreshButton` | ✅ |

**缺失**：
- 无 OS 权限状态检查（macOS Accessibility/Screenshots 权限）
- 无 OS 权限引导打开（orca 的 `openPermission` → System Settings）
- 无权限重置
- 无权限策略配置 UI（allow/ask/deny 四类）
- 无 Computer Use 技能安装引导
- 无实时截图/无障碍树预览

#### 2. 计算机控制工具与权限策略（packages/computer-use）

**工具注册**：`@/packages/computer-use/tool-computer-use/src/index.ts`

已注册 6 个工具：

| 工具名 | 功能 | 权限类 |
|---|---|---|
| `computer_list_apps` | 列出本地应用 | observe |
| `computer_list_windows` | 列出窗口 | observe |
| `computer_observe` | 截图 + 无障碍树 | observe |
| `computer_pointer` | 点击/滚动/拖拽 | pointer |
| `computer_keyboard` | 输入文本/按键/粘贴 | keyboard |
| `computer_accessibility` | 无障碍动作/设值 | accessibilityAction |

**权限策略**：`@/packages/computer-use/computer-use-permission-policy/src/index.ts`

四类独立权限，每类 `allow` / `ask` / `deny`，默认全部 `ask`：

| 权限类 | 覆盖工具 | 默认 |
|---|---|---|
| `observe` | list_apps, list_windows, observe | ask |
| `pointer` | pointer | ask |
| `keyboard` | keyboard | ask |
| `accessibilityAction` | accessibility | ask |

**Provider 实现**：`@/packages/computer-use/computer-use-cinlan/src/index.ts`
- 桌面应用/窗口枚举
- 无障碍树解析
- 截图捕获
- 点击/滚动/拖拽/键盘输入模拟

### orca 计算机控制设置实现（参考目标）

**位置**：`@/orca/src/renderer/src/components/settings/ComputerUsePane.tsx`

orca 的 `ComputerUsePane` 包含两大模块：

#### 模块 1：OS 权限管理（macOS 专属）

| 功能 | 实现 | 说明 |
|---|---|---|
| 权限状态检查 | `window.api.computerUsePermissions.getStatus()` | 返回 platform + permissions[] + helperUnavailableReason |
| 权限打开 | `window.api.computerUsePermissions.openSetup({ id })` | 打开 macOS System Settings 对应权限页 |
| 权限重置 | `window.api.computerUsePermissions.reset()` | 重置权限状态 |
| 焦点刷新 | `window.addEventListener('focus', refresh)` | 用户在 System Settings 授权后回到 orca 自动刷新 |

**两类 OS 权限**：

| 权限 ID | 标签 | 说明 | 图标 |
|---|---|---|---|
| `accessibility` | Accessibility | 读取应用界面树并执行请求的操作 | `Accessibility` |
| `screenshots` | Screenshots | 捕获应用窗口以便 Agent 检查视觉状态 | `Camera` |

**权限状态**：`granted` / `not-granted` / `unsupported`

**UI 结构**：
- 顶部摘要卡：ShieldCheck 图标 + 状态标题 + 描述 + Ready 徽章 + 刷新按钮
- 权限行列表：图标 + 标签 + 状态徽章 + 描述 + Open 按钮
- 底部：Reset access 链接

#### 模块 2：Computer Use 技能安装

**位置**：`@/orca/src/renderer/src/components/settings/ComputerUseSkillSetupPanel.tsx`

通过 `AgentSkillSetupPanel` 组件渲染：
- 技能名称：`COMPUTER_USE_SKILL_NAME`
- 安装命令：`COMPUTER_USE_SKILL_INSTALL_COMMAND`
- 更新命令：`COMPUTER_USE_SKILL_UPDATE_COMMAND`
- CLI 前置条件检查
- 技能检测（`useInstalledAgentSkill`）
- 终端内安装（`AgentSkillSetupPanel` 提供 terminal shell）

## 差异总结

| 维度 | DSH ui-settings-security | DSH computer-use 包 | orca |
|---|---|---|---|
| Provider 检查 | ✅ `checkDevice` | ✅ Provider 实现 | ❌（直接用 OS API） |
| 库存检查 | ✅ `CAPABILITY_MATCHERS` | ❌ | ❌ |
| OS 权限检查 | ❌ | ❌ | ✅ `getStatus` |
| OS 权限引导 | ❌ | ❌ | ✅ `openSetup` |
| OS 权限重置 | ❌ | ❌ | ✅ `reset` |
| 权限策略 UI | ❌ | ✅ Config（无 UI） | ❌（orca 无策略 UI） |
| 权限策略执行 | ❌ | ✅ PreToolDecision | ❌ |
| 技能安装引导 | ❌ | ❌ | ✅ `ComputerUseSkillSetupPanel` |
| 安装命令 | ✅ `dsh --profile` | ❌ | ✅ `orca-cli skill install` |
| 功能说明 | ✅ 3 张卡片 | ❌ | ❌ |
| 截图预览 | ❌ | ✅ 工具输出 | ❌ |
| 无障碍树预览 | ❌ | ✅ 工具输出 | ❌ |

**关键差异**：
- orca 的权限管理是 **OS 级**（macOS Accessibility/Screenshots），通过 Electron IPC `window.api.computerUsePermissions` 与原生 helper 通信
- DSH 的权限管理是 **策略级**（allow/ask/deny 四类），通过 `computer-use-permission-policy` 插件在工具管道中拦截
- 两者解决不同层面的问题：orca 解决"能否访问 OS 资源"，DSH 解决"Agent 能否执行操作"
- **迁移应同时包含两个层面**：OS 权限引导（如适用）+ 策略配置 UI

## 迁移策略

将 `ui-settings-security` 的 `ComputerCapabilityBody` 提升为独立的计算机控制 Settings section，新增权限策略配置 UI 和技能安装引导。

### 命名与注册

- section id：`cinlan-computer`（替换现有 `ui-settings-security` 的 `cinlan-computer` section）
- 导航标签：`Computer use` / `计算机控制`
- 图标：`IconBrowseOutline16`
- 注册方式：通过 `ctx.slots.register('settings.section', ...)` 注册

### 架构决策

1. **保留 Provider 检查**：DSH 的 `checkDevice('computer')` 通过 Remote API 探测 Provider 就绪状态，这是 DSH 独有的（orca 直接调用 OS API）。保留并放在设置页顶部。
2. **新增权限策略 UI**：将 `computer-use-permission-policy` 的 Config（四类 allow/ask/deny）暴露为 Settings section 的可配置项，通过 `settingsScope` 持久化。
3. **OS 权限引导按平台条件显示**：macOS 显示 Accessibility/Screenshots 权限状态（需新增 Remote API），Windows/Linux 跳过此模块。
4. **技能安装引导适配 DSH**：orca 用 `orca-cli skill install`，DSH 用 `dsh --profile device-control`。展示安装命令而非终端内安装。

## 分阶段实施

### 阶段 1：创建独立计算机控制 Settings section

**目标**：将 `ComputerCapabilityBody` 从 `CapabilitySection` 中拆出为独立 section，保留现有功能。

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `ComputerSettingsSection.tsx`。当前页面由 [CapabilitySection.tsx](../../../packages/client/ui-settings-security/src/client/CapabilitySection.tsx) 中的 `ComputerCapabilityBody` 实现，未拆为此拟议文件。
   - 从 `CapabilitySection.tsx:231-248` 提取 `ComputerCapabilityBody`
   - 添加独立的 section header 和注册逻辑
   - 结构：Provider 状态卡 → 安装命令 → 功能说明卡片

2. **修改** `@/packages/client/ui-settings-security/src/client/index.ts:141-142`
   - 将 `computer` capability 的注册从 `register(definition)` 切换到新的 `ComputerSettingsSection`
   - 或保持 `CAPABILITIES` 数组但将 `computer` 的渲染路由到新组件

3. **修改** `@/packages/client/ui-settings-security/src/client/CapabilitySection.tsx:409`
   - 将 `definition.id === 'computer'` 的分支替换为 `<ComputerSettingsSection>`

### 阶段 2：新增权限策略配置 UI

**目标**：将 `computer-use-permission-policy` 的四类权限配置暴露为 Settings section 的可配置项。

**新增设置项**：

| 设置 | 字段 | 控件 | 选项 | 默认 |
|---|---|---|---|---|
| 观察权限 | `observe` | select | allow/ask/deny | ask |
| 指针权限 | `pointer` | select | allow/ask/deny | ask |
| 键盘权限 | `keyboard` | select | allow/ask/deny | ask |
| 无障碍动作权限 | `accessibilityAction` | select | allow/ask/deny | ask |

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `ComputerPermissionPolicySection.tsx`
   - 四行 select 控件，每行：图标 + 标签 + 描述 + allow/ask/deny 下拉
   - 通过 `settingsScope` 绑定 `computer-use-permission-policy` namespace
   - 保存时调用 `ctx.remote.settings.mutate`

2. **修改** `ComputerSettingsSection.tsx`：在功能说明卡片下方嵌入 `ComputerPermissionPolicySection`

3. **修改** `@/packages/client/ui-settings-security/src/client/locales.ts`：添加权限策略的 i18n 键
   - `computerPermissionObserve` / `computerPermissionPointer` / `computerPermissionKeyboard` / `computerPermissionAccessibility`
   - `computerPermissionAllow` / `computerPermissionAsk` / `computerPermissionDeny`
   - 各权限的描述文案

4. **修改** `@/packages/client/ui-settings-security/src/client/index.ts`
   - 注入 `computer-use-permission-policy` 的 `settingsScope` 到 `ComputerSettingsSection`

### 阶段 3：OS 权限引导（macOS 专属）

**目标**：迁移 orca 的 OS 权限检查和引导，仅 macOS 显示。

**参考**：`@/orca/src/renderer/src/components/settings/ComputerUsePane.tsx:63-286`

**需新增的 Remote API**：

| API | 功能 | 对应 orca |
|---|---|---|
| `ctx.remote.computerUse.getPermissionStatus()` | 返回 platform + permissions[] | `window.api.computerUsePermissions.getStatus()` |
| `ctx.remote.computerUse.openPermissionSetup({ id })` | 打开 OS 权限设置 | `window.api.computerUsePermissions.openSetup()` |
| `ctx.remote.computerUse.resetPermissions()` | 重置权限 | `window.api.computerUsePermissions.reset()` |

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `ComputerOSPermissionsSection.tsx`。当前只读能力与未探测权限说明见 [ComputerObservations.tsx](../../../packages/client/ui-settings-security/src/client/ComputerObservations.tsx)，不等同于本阶段拟议的 OS 权限操作。
   - 平台检测：仅 `platform === 'darwin'` 显示
   - 顶部摘要卡：ShieldCheck + 状态标题 + Ready 徽章 + 刷新按钮
   - 权限行列表：Accessibility + Screenshots，每行图标 + 标签 + 状态徽章 + Open 按钮
   - 底部：Reset access 链接
   - 焦点刷新：`window.addEventListener('focus', refresh)`

2. **修改** `ComputerSettingsSection.tsx`：在 Provider 状态卡和权限策略之间嵌入 `ComputerOSPermissionsSection`

3. **新建** Remote API 定义（packages/computer-use 或 packages/api）
   - `computerUse.getPermissionStatus` / `openPermissionSetup` / `resetPermissions`
   - macOS 实现：调用 `computer-use-cinlan` 的 OS 权限检查
   - Windows/Linux 实现：返回 `unsupported` 状态

4. **修改** `@/packages/client/ui-settings-security/src/client/locales.ts`：添加 OS 权限的 i18n 键

### 阶段 4：技能安装引导

**目标**：迁移 orca 的 `ComputerUseSkillSetupPanel`，适配 DSH 的安装方式。

**参考**：`@/orca/src/renderer/src/components/settings/ComputerUseSkillSetupPanel.tsx`

**DSH 适配**：
- orca 用 `orca-cli skill install computer-use` 安装技能
- DSH 用 `dsh --profile device-control` 启动带计算机控制能力的 profile
- DSH 无 `useInstalledAgentSkill` hook，改为检查 Provider 就绪状态（已有 `checkDevice`）

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `ComputerUseSetupGuide.tsx`。当前启动命令与就绪检查见 [CapabilitySection.tsx](../../../packages/client/ui-settings-security/src/client/CapabilitySection.tsx) 中的 `ComputerCapabilityBody`。
   - 简化版：显示 `dsh --profile device-control` 命令 + 复制按钮
   - Provider 就绪状态徽章（复用现有 `checkDevice`）
   - 无需终端内安装（DSH 的 profile 启动方式不同）

2. **修改** `ComputerSettingsSection.tsx`：用 `ComputerUseSetupGuide` 替换现有的 `CopyText` 安装命令

### 阶段 5：实时预览（可选）

**目标**：在 Settings 页面提供截图和无障碍树的实时预览，让用户验证计算机控制是否工作。

**参考**：DSH 已有的 `computer_observe` 工具输出（截图 + 无障碍树）

**文件变更**：

1. **拟新建（尚不存在）**：在 [ui-settings-security/src/client](../../../packages/client/ui-settings-security/src/client/) 下创建 `ComputerPreviewSection.tsx`
   - "测试观察" 按钮：调用 `ctx.remote.computerUse.observe()` 获取截图 + 无障碍树
   - 截图显示区：`<img src="data:image/png;base64,...">`
   - 无障碍树折叠树：JSON 折叠展示

2. **修改** `ComputerSettingsSection.tsx`：在底部嵌入 `ComputerPreviewSection`

3. **新增** Remote API：`ctx.remote.computerUse.observe()`（直接调用 Provider 的 observe 方法）

## 风险

1. **OS 权限 API 缺失**：DSH 当前无 `computerUsePermissions` Remote API，macOS 权限检查需要新增原生实现。Windows/Linux 无对应的 OS 权限系统，该模块需平台条件渲染。
2. **权限策略存储位置**：`computer-use-permission-policy` 的 Config 当前通过 Cordis Config 加载（`cordis.yml`），迁移到 `settingsScope` 需确保两处配置不冲突，或统一为 settingsScope 单一来源。
3. **Provider 检查 vs OS 权限**：DSH 的 `checkDevice` 探测的是 Provider 进程就绪，orca 的 `getStatus` 探测的是 OS 隐私权限。两者不等价——Provider 就绪不代表 OS 权限已授予。Settings 页面需同时展示两者。
4. **section 注册冲突**：`ui-settings-security` 已注册 `cinlan-computer` section，拆分独立 section 需替换原注册，避免重复导航项。
5. **实时预览安全**：在 Settings 页面调用 `observe` 会触发截图，需确保权限策略允许（或预览操作绕过策略检查，仅限 Settings 页面）。
