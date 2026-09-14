# 手机模拟器（Mobile Emulator）迁移计划

## 1. 现状对比

### 1.1 Orca 的手机模拟器实现

Orca 的 `MobileEmulatorSettingsPane` 是一个完整的模拟器配置面板：

**前端 UI 组件：**
- `MobileEmulatorSettingsPane.tsx` — 主面板
- `MobileEmulatorAvailabilityDetails.tsx` — 可用性详情（Android SDK / iOS Simulator 检测）
- `MobileEmulatorAgentControlRow.tsx` — Agent 控制配置（CLI + 技能安装）
- `MobileEmulatorExamples.tsx` — 使用示例

**核心功能：**
1. **启用开关** — `mobileEmulatorEnabled`，控制模拟器功能可见性
2. **可用性检测** — 通过 `emulator.availability` RPC 检测：
   - Android SDK：是否找到、SDK 路径
   - iOS Simulator：`simctl` 和 `serveSim` 状态（仅 macOS）
   - 设备列表：名称、UDID、状态、运行时
3. **默认设备选择** — 从检测到的设备列表中选择默认设备
4. **Android SDK 路径配置** — 手动指定 SDK 路径
5. **Agent 控制设置**：
   - 步骤 1：启用 Cinlan IDE CLI（注册命令）
   - 步骤 2：安装 CLI 技能（`cinlan skill install`）
   - 常用命令展示（`emulator list/attach/tap/type`）
6. **使用示例** — Agent 提示词示例

**设置项：**
- `mobileEmulatorEnabled` — 启用开关
- `mobileEmulatorDefaultDeviceUdid` — 默认设备 UDID
- `androidSdkPath` — Android SDK 路径

### 1.2 DSH 的手机模拟器现状

DSH 已有完整的手机模拟器后端和基础 UI：

**已有后端：**
- `mobile-device` — Provider 中立的能力框架（`MobileDeviceProvider` 接口）
  - `listDevices()` — 列出设备
  - `observe()` — 观察设备（截图 + accessibility tree）
  - `touch()` — 点击/滑动
  - `typeText()` — 输入文本
  - `pressButton()` — 按键
- `mobile-device-cinlan` — Cinlan 原生 Provider 实现
- `mobile-device-permission-policy` — 权限策略
- `tool-mobile-device` — Agent 工具
- `cinlan-mobile-device` — 安装 bundle

**已有前端：**
- `ui-settings-security` 中的 `MobileCapabilityBody`（`CapabilitySection.tsx`）
  - 设备就绪状态检测（`checkDevice('mobile')`）
  - 启动命令展示（`dsh --profile device-control`）
  - 可用性检查
  - 操作说明
  - 使用示例
  - **已知限制说明**：
    - `mobileSdkTitle` — "Android SDK / iOS Simulator" — "Harness does not yet expose SDK detection or path persistence"
    - `mobileDefaultTitle` — "Default device" — "Default-device settings are not available. Tool calls select a device explicitly with device_id"

### 1.3 差距分析

| 能力 | Orca | DSH | 差距 |
|------|------|-----|------|
| 设备列表 | ✅ | ✅ | 都有 |
| 设备观察（截图+tree） | ✅ | ✅ | 都有 |
| 触控操作 | ✅ | ✅ | 都有 |
| 文本输入 | ✅ | ✅ | 都有 |
| 按键操作 | ✅ | ✅ | 都有 |
| 启用开关 | ✅ | ❌ | 需迁移 |
| 可用性检测 | ✅ | ✅ | 方式不同 |
| Android SDK 检测 | ✅ | ❌ | 需迁移 |
| iOS Simulator 检测 | ✅ | ❌ | 需迁移 |
| Android SDK 路径配置 | ✅ | ❌ | 需迁移 |
| 默认设备选择 | ✅ | ❌ | 需迁移 |
| Agent CLI 安装 | ✅ | ❌ | DSH 用 profile 模式 |
| 技能安装 | ✅ | ❌ | DSH 用 profile 模式 |
| 使用示例 | ✅ | ✅ | 都有 |
| 独立设置页面 | ✅ | ❌ | 需迁移 |

**关键差距：**
1. DSH 没有 SDK 检测和路径配置
2. DSH 没有默认设备选择
3. DSH 没有启用开关
4. DSH 的手机模拟器设置嵌在 CapabilitySection 中，不是独立设置页面
5. DSH 用 profile 启动模式，Orca 用 CLI + 技能安装模式

## 2. 迁移目标

1. 将手机模拟器设置从 `CapabilitySection` 中独立出来，或增强现有 `MobileCapabilityBody`
2. 添加 SDK 检测和路径配置
3. 添加默认设备选择
4. 添加启用开关
5. 保持 DSH 的 profile 启动模式，不迁移 CLI 安装

## 3. 迁移方案

### 3.1 方案选择：增强现有 CapabilitySection

DSH 已有 `MobileCapabilityBody`，应在其基础上增强，而非新建独立设置页面。

**理由：**
- DSH 的能力设置架构将 security/browser/computer/mobile/design 统一在 `CapabilitySection` 中
- 独立出来会破坏统一架构
- 现有 `MobileCapabilityBody` 已有设备检测和启动引导

### 3.2 增强 MobileCapabilityBody

**新增设置区域：**

```typescript
function MobileCapabilityBody(props: BodyProps): ReactNode {
  const { state, t } = props
  const status = deviceStatus(state)
  return <div className={css.setupCard}>
    <HeroHeader ... />
    {/* 已有：可用性检查 */}
    {/* 已有：启动命令 */}
    {/* 已有：操作说明 */}

    {/* 新增：启用开关 */}
    <MobileEnableToggle ... />

    {/* 新增：SDK 检测和路径配置 */}
    <MobileSdkSettings ... />

    {/* 新增：默认设备选择 */}
    <MobileDefaultDeviceSelect ... />
  </div>
}
```

### 3.3 SDK 检测和路径配置

**后端：** 扩展 `device-capabilities-controller` 或新建 SDK 检测服务

```typescript
interface MobileSdkAvailability {
  platform: string
  android: {
    sdkFound: boolean
    sdkPath?: string
    message: string
  }
  ios?: {
    simctlOk: boolean
    serveSimOk: boolean
    message?: string
  }
  devices: MobileDevice[]
}
```

**前端：** 新增 `MobileSdkSettings` 组件
- Android SDK 状态行（检测到/未检测到）
- SDK 路径显示和配置
- "Locate SDK folder" 按钮（目录选择器）
- "Clear" 按钮（清除自定义路径）
- "Download Android Studio" 链接
- iOS Simulator 状态行（仅 macOS）

### 3.4 默认设备选择

**后端：** 在 mobile-device 设置中添加默认设备配置

```typescript
interface MobileDeviceSettings {
  defaultDeviceId?: string
}
```

**前端：** 新增 `MobileDefaultDeviceSelect` 组件
- 设备列表下拉框
- "Auto-select" 选项
- 设备状态显示（Booted/Shutdown/Unavailable）
- Android/iOS 图标区分

### 3.5 启用开关

**后端：** 在 mobile-device 设置中添加启用开关

```typescript
interface MobileDeviceSettings {
  enabled: boolean
  defaultDeviceId?: string
  androidSdkPath?: string
}
```

**前端：** 在 `MobileCapabilityBody` 顶部添加开关
- 控制模拟器功能可见性
- 禁用时隐藏其他设置

### 3.6 本地化文本

在 `locales.ts` 中添加：

```typescript
// 中文
mobileEnable: '启用手机模拟器',
mobileEnableDescription: '显示手机模拟器操作并允许 Agent 连接活动模拟器。',
mobileSdkAndroid: 'Android SDK',
mobileSdkAndroidNotFound: '未找到。安装 Android Studio，然后创建虚拟设备。',
mobileSdkLocate: '定位 SDK 目录',
mobileSdkClear: '清除',
mobileSdkDownload: '下载 Android Studio',
mobileSdkIos: 'iOS Simulator (Xcode)',
mobileSdkIosNotReady: '安装 Xcode 并添加 iOS Simulator 运行时。',
mobileDefaultDevice: '默认设备',
mobileDefaultDeviceAuto: '自动选择设备',
mobileDefaultDeviceDescription: '新模拟器标签页和 Agent 连接命令的默认设备。',

// 英文
mobileEnable: 'Enable Mobile Emulator',
mobileEnableDescription: 'Show the mobile emulator action and allow agents to attach to the active emulator.',
mobileSdkAndroid: 'Android SDK',
mobileSdkAndroidNotFound: 'Not found. Install Android Studio, then create a Virtual Device.',
mobileSdkLocate: 'Locate SDK folder',
mobileSdkClear: 'Clear',
mobileSdkDownload: 'Download Android Studio',
mobileSdkIos: 'iOS Simulator (Xcode)',
mobileSdkIosNotReady: 'Install Xcode and add an iOS Simulator runtime.',
mobileDefaultDevice: 'Default Device',
mobileDefaultDeviceAuto: 'Auto-select device',
mobileDefaultDeviceDescription: 'Default device for new emulator tabs and agent attach commands.',
```

### 3.7 替换现有限制说明

当前 `MobileCapabilityBody` 中的限制说明：
- `mobileSdkTitle` / `mobileSdkDescription` — "Harness does not yet expose SDK detection or path persistence"
- `mobileDefaultTitle` / `mobileDefaultDescription` — "Default-device settings are not available"

这些应替换为实际的 SDK 检测和默认设备选择 UI。

## 4. 实施阶段

### 阶段 1：后端 SDK 检测 ✅
- ✅ 扩展 `device-capabilities-controller` 添加 `checkSdk` 和 `listMobileDevices` Remote 方法
- ✅ 实现 Android SDK 自动检测（`ANDROID_HOME` / `ANDROID_SDK_ROOT` / 常见路径）
- ✅ 实现 iOS Simulator 检测（`xcrun simctl`，仅 macOS）
- ✅ 添加 `MobileSdkSnapshot` / `MobileDeviceListSnapshot` / `MobileDeviceSummary` 类型
- ✅ 添加 Remote API（`@Remote('checkSdk')` / `@Remote('listMobileDevices')`）

### 阶段 2：前端 SDK 设置 UI ✅
- ✅ 在 `MobileCapabilityBody` 中实现 SDK 状态显示
- ✅ 实现 SDK 路径输入框和"使用检测到的路径"按钮
- ✅ 实现"下载 Android Studio"链接
- ✅ 实现 iOS Simulator 状态行（仅 macOS 检测到时显示）
- ✅ 添加本地化文本（中英文 16 个新键）

### 阶段 3：默认设备选择 ✅
- ✅ 新建 `MobileDeviceSettings` 设置命名空间（`mobile-device` namespace）
- ✅ Host 端注册命名空间（`ctx.settings.register` + schemastery schema）
- ✅ Client 端绑定设置 scope（`ctx.settingsScope.bind`）
- ✅ 实现设备列表下拉框（`listMobileDevices` Remote 调用）
- ✅ 实现"自动选择设备"选项

### 阶段 4：启用开关和整合 ✅
- ✅ 添加启用开关（`enabled` 字段，通过 `settings.set()` 持久化）
- ✅ 整合到 `MobileCapabilityBody`（禁用时隐藏 SDK 和设备选择区域）
- ✅ 替换现有限制说明（`mobileSdkTitle` / `mobileSdkDescription` / `mobileDefaultTitle` / `mobileDefaultDescription` 已移除）
- ✅ 添加本地化文本

### 阶段 5：测试和验证 ✅
- ✅ device-capabilities-controller 测试 11 项通过
- ✅ ui-settings-security 测试 60 项通过（含新增 enable toggle 测试）
- ✅ typecheck 通过
- 测试 SDK 检测
- 测试设备选择
- 端到端验证

## 5. 依赖项

**前端：**
- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-client-ui-primitives` — UI 基础组件
- `@deepseek-ai/dsh-api-remotes` — 远程 API

**后端：**
- `@deepseek-ai/dsh-mobile-device` — 移动设备框架
- `@deepseek-ai/dsh-api-device-capabilities-controller` — 设备能力控制器

## 6. 风险和注意事项

1. **跨平台 SDK 检测**：Android SDK 和 iOS Simulator 的检测方式在不同平台上差异较大。
2. **SDK 路径安全**：SDK 路径是本地文件系统路径，需要验证路径有效性。
3. **设备列表实时性**：设备列表可能随时变化（启动/关闭模拟器），需要刷新机制。
4. **Profile 模式**：DSH 使用 profile 启动模式，不迁移 Orca 的 CLI 安装和技能安装。
5. **架构一致性**：增强 `MobileCapabilityBody` 而非新建独立页面，保持能力设置架构统一。

## 7. 优先级评估

**迁移优先级：中**

理由：
- DSH 已有完整的移动设备后端和基础 UI
- 主要差距是 SDK 检测和默认设备选择，属于体验优化
- 后端 SDK 检测需要跨平台适配，工作量中等
- 不阻塞核心工作流

**建议迁移顺序：在任务来源之后，浮动工作区之前。**
