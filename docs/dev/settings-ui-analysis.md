# 设置 UI 样式对比分析

> 分析对象：cinlan-harness 各副本目录的设置 UI 实现差异
> 日期：2026-09-09

## 总览

| 目录 | 版本 | 设置样式 | 组件名 | role | 弹框 | 搜索 | 连接指示器 | 能力页面 | icon slot |
|------|------|---------|--------|------|------|------|-----------|---------|-----------|
| **cinlan-harness** (main) | 0.1.5-alpha.1 | 居中弹框 | `SettingsPanel` | `dialog` | ✅ | ❌ | ✅ | ❌ | ❌ |
| **integration-20260909** | 0.1.3-alpha.1 | 全页面 | `SettingsPage` | `region` | ❌ | ✅ | ✅ | ❌ | ❌ |
| **staged-final-b84814d3** | 0.1.0-rc.8 | 全页面 | `SettingsPage` | `region` | ❌ | ✅ | ❌ | ✅ | ✅ |

## 演进关系

```
staged-final (0.1.0-rc.8)          integration (0.1.3-alpha.1)       main (0.1.5-alpha.1)
全页面 + capabilities    →         全页面（简化）          →          弹框（回退）
  icon slot 可扩展                   icon 硬编码                       icon 硬编码
  5 个能力页面                       无能力页面                        无能力页面
  无连接指示器                       有连接指示器                      有连接指示器
  invariant 校验                     无 invariant                      无 invariant
```

staged-final-b84814d3 是全页面（无弹框）样式的最完整版本。integration 虽然版本号更高，但砍掉了 capabilities 和 icon slot。main 直接回退成了弹框模式。

## 各版本详情

### 1. cinlan-harness（main，0.1.5-alpha.1）—— 弹框模式

文件：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`

- 组件名：`SettingsPanel`
- `role="dialog"` + `aria-modal="true"`
- 全屏遮罩 `.overlay` + 半透明蒙层 `.mask`（`backdrop-filter: blur`）
- 居中面板 800×800px，圆角 32px，阴影 `box-shadow: var(--dsw-elevation-prominent)`
- 关闭方式：右上角 X 按钮 + 点击蒙层 + Escape
- 触发按钮有 `aria-haspopup="dialog"`
- 有 `ConnectionIndicator` 连接状态指示器
- 导航图标硬编码（`navIcon()` 函数，3 个固定 id 映射）
- CSS 注释引用 Figma 设计稿（501:29947）
- 无搜索框
- 无 Cinlan 能力页面

### 2. integration-20260909（0.1.3-alpha.1）—— 全页面模式（简化版）

文件：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`

- 组件名：`SettingsPage`
- `role="region"`（不是 dialog）
- 无遮罩、无蒙层、无居中面板
- `position: fixed; inset: 0; z-index: 1000` 全屏覆盖
- 左侧 280px 导航栏 + 右侧内容区，grid 布局
- 关闭方式：左上角返回按钮 + Escape
- 有搜索框（搜索 section）
- 有 `ConnectionIndicator`
- 导航图标硬编码（`navIcon()` 函数）
- 无 Cinlan 能力页面
- 无 invariant 校验

### 3. staged-final-b84814d3（0.1.0-rc.8）—— 全页面模式（完整版）

文件：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`

- 组件名：`SettingsPage`
- `role="region"`（不是 dialog）
- 同样全屏覆盖，无弹框
- 比 integration 多出的功能：
  - `settings.section.icon` slot（可扩展的导航图标，通过 `renderSlot` 动态渲染，不硬编码）
  - `ui-settings-cinlan-capabilities` 包（5 个 Cinlan 能力页面）
  - `invariant.ts`（运行时不变量校验）
  - 返回按钮文案通过 `renderSlot('settings.close', {})` 而非硬编码 `t('back')`
- 比 integration 少的：无 `ConnectionIndicator`、无 `useConnectionState`、无 `reconnect`

#### Cinlan 能力页面（`ui-settings-cinlan-capabilities`）

5 个能力页面，从 Host Loader 投影读取插件清单：

| 能力 | order | matcher | 说明 |
|------|-------|---------|------|
| security | 40 | `/security\|skill\|finding\|mcp/i` | 安全研发能力 |
| browser | 50 | `/browser/i` | 浏览器自动化 |
| computer | 60 | `/computer-use/i` | 计算机使用 |
| mobile | 70 | `/mobile-device/i` | 移动设备 |
| design | 80 | `/design-studio\|cinlan-design/i` | 设计工作室 |

每个页面展示：
- 能力状态（ready/loading/attention/missing）
- 组件列表（模块名 + 实例数 + 运行状态）
- 刷新按钮（重新拉取 Host 投影）

## 关键文件差异

### SettingsRoot.tsx

| 差异点 | main (弹框) | integration (全页面) | staged-final (全页面) |
|--------|------------|---------------------|----------------------|
| 行数 | 224 | 226 | 177 |
| 组件 | `SettingsPanel` | `SettingsPage` | `SettingsPage` |
| role | `dialog` | `region` | `region` |
| 遮罩 | `.overlay` + `.mask` | 无 | 无 |
| 布局 | flex 居中 | grid 280px+1fr | grid 280px+1fr |
| 搜索 | ❌ | ✅ | ✅ |
| icon 渲染 | `navIcon()` 硬编码 | `navIcon()` 硬编码 | `renderSlot('settings.section.icon')` |
| 关闭按钮 | X 图标 + 蒙层点击 | 返回按钮 | 返回按钮 |
| 连接指示器 | ✅ | ✅ | ❌ |
| onboarding | ✅ | ✅ | ✅ |

### SettingsRoot.module.css

| 差异点 | main (弹框) | integration/staged-final (全页面) |
|--------|------------|-----------------------------------|
| 行数 | 237 | ~200 |
| `.overlay` | ✅ fixed 全屏 | ❌ |
| `.mask` | ✅ backdrop-filter blur | ❌ |
| `.panel` | ✅ 800px 圆角32 阴影 | ❌ |
| `.page` | ❌ | ✅ fixed inset:0 grid |
| `.search` | ❌ | ✅ 搜索框 |
| `.back` | ❌ | ✅ 返回按钮 |
| 响应式 | ❌ | ✅ 760px + 560px 断点 |

### shell-contract.ts

| 差异点 | main | integration | staged-final |
|--------|------|------------|-------------|
| `reconnect` | ✅ | ✅ | ❌ |
| `connectionState` | ✅ | ✅ | ❌ |
| `settings.section.icon` slot | ❌ | ❌ | ✅ |
| `t` locale 声明位置 | 末尾 | 末尾 | 中间 |

### ui-settings（base 层）

| 差异点 | main | integration | staged-final |
|--------|------|------------|-------------|
| `settings-contract.ts` | ✅ | ✅ | ❌ |
| `invariant.ts` | ❌ | ❌ | ✅ |
| `settings-scope.ts` | 11922 bytes | 11922 bytes | 11470 bytes |
| `settings-mirror.ts` | 8677 bytes | 8677 bytes | 8614 bytes |
| `slots.ts` | 7116 bytes | 7116 bytes | 7699 bytes |

## 迁移建议

要保留 staged-final-b84814d3 的全页面样式，需要迁移以下文件到 main：

### 必需文件

| 来源 | 文件 | 说明 |
|------|------|------|
| `ui-settings-general` | `SettingsRoot.tsx` | 全页面组件 |
| `ui-settings-general` | `SettingsRoot.module.css` | 全页面样式 |
| `ui-settings-general` | `shell-contract.ts` | 含 `settings.section.icon` slot |
| `ui-settings-general` | `invariant.ts` | 运行时不变量 |
| `ui-settings` | `slots.ts` | 含 icon slot 声明 |
| `ui-settings` | `settings-scope.ts` | scope 定义 |
| `ui-settings` | `settings-mirror.ts` | mirror 定义 |
| `ui-settings-cinlan-capabilities` | 整个包 | 5 个能力页面 |

### 注意事项

- staged-final 无 `ConnectionIndicator`，如需保留连接指示器，可从 integration 或 main 合入
- staged-final 的 `shell-contract.ts` 无 `reconnect`/`connectionState`，需确认 main 的其他组件是否依赖这些
- `settings.section.icon` slot 是新增的，需确认 `ui-settings` 的 `slots.ts` 中有对应声明
- 版本差异：staged-final 是 `0.1.0-rc.8`，main 是 `0.1.5-alpha.1`，需确认 slot 系统和 contract 类型兼容性
