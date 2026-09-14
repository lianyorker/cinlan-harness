# 安全研发（Security Research）迁移计划

## 1. 现状对比

### 1.1 Orca 的安全研发实现

Orca 的安全研发是一个**技能安装面板**，功能较为简单：

**前端 UI 组件：**
- `SecurityResearchPane.tsx` — 安全研发设置面板，管理技能安装/更新命令、运行时状态、刷新、错误/加载状态
- `AgentSkillSetupPanel.tsx` — 可复用的 Agent 技能安装面板组件，处理安装/更新命令、内联终端控件、加载/错误状态

**核心功能：**
1. **技能安装**：通过 CLI 命令安装安全研发技能
2. **运行时检测**：检测 WSL 可用性、终端 shell 覆盖
3. **技能刷新**：检查技能是否最新
4. **内联终端**：显示安装过程

**安装命令（来自 `agent-feature-install-commands.ts`）：**
- 安装：`cinlan skill install reverse`
- 更新：`cinlan skill update reverse`

### 1.2 DSH 的安全研发实现

DSH 已有**远超 Orca 的完整安全研发体系**，但存在分支问题：

**前端 UI（`ui-settings-security` 包）：**
- `CapabilitySection.tsx` — 统一的能力设置页面，支持 security/browser/computer/mobile/design 五种能力
- `SecurityScopeEditor.tsx` — 授权范围编辑器，管理目标、动作、执行主机、证据保留策略
- `SecurityScopeAccessEditor.tsx` — 网络出口和凭证引用编辑
- `SecurityReportExport.tsx` — 安全报告导出（JSON/SARIF/Markdown）

**核心功能（已实现）：**
1. ✅ **Agent 预设检测**：通过 `ctx.remote.agentPresets.list()` 检测 `security-research` 预设是否存在
2. ✅ **条件注册**：仅当预设存在时才注册设置页面（`index.ts` 中的 `refresh` 逻辑）
3. ✅ **授权范围管理**：完整的评估范围编辑（engagement ID、grant ID、目标、动作、证据保留）
4. ✅ **安全报告导出**：JSON/SARIF/Markdown 格式
5. ✅ **技能计数**：显示已安装技能数量和完整性状态
6. ✅ **插件清单**：显示已加载的安全相关插件列表
7. ✅ **设备能力检测**：检测设备 Provider 就绪状态

**后端 API（通过 `ctx.remote.securityResearch`）：**
- `describe()` — 读取安全研发状态（预设存在性、范围状态、技能计数）
- `exportReport()` — 导出安全报告

**设置范围（`SecurityResearchScopeSettings`）：**
- `root.engagementId` — 授权 ID
- `root.grantId` — 授权 ID
- `root.authorizationRef` — 授权引用
- `root.notBefore` / `root.expiresAt` — 时间窗口
- `root.executionHostIds` — 执行主机列表
- `root.targets` — 评估目标（hostname/ip-address/url-prefix/artifact-scope/service）
- `root.excludedTargetIds` — 排除目标
- `root.egress` — 网络出口授权
- `root.credentials` — 凭证引用
- `root.actions` / `root.approvalRequiredActions` — 允许/需审批的动作
- `root.evidence` — 证据保留策略

### 1.3 差距分析

| 能力 | Orca | DSH | 差距 |
|------|------|-----|------|
| 技能安装 UI | ✅ | ❌ | DSH 无安装流程 |
| 内联终端 | ✅ | ❌ | DSH 无内联终端 |
| Agent 预设检测 | ❌ | ✅ | DSH 更强 |
| 授权范围管理 | ❌ | ✅ | DSH 远超 Orca |
| 安全报告导出 | ❌ | ✅ | DSH 独有 |
| 技能计数 | ❌ | ✅ | DSH 更强 |
| 插件清单 | ❌ | ✅ | DSH 独有 |
| 使用示例 | ✅ | ✅ | 都有 |
| 运行时检测 | ✅ | ✅ | 方式不同 |

**关键差距：DSH 缺少技能安装流程和内联终端。**

## 2. 当前问题

用户指出"已经实现了一半，分支不对"。分析代码后发现：

1. **条件注册问题**：`index.ts` 中 security 部分使用条件注册——仅当 `agentPresets.list()` 返回 `security-research` 预设时才注册设置页面。如果预设未正确安装或分支配置错误，整个设置页面不会出现。

2. **缺少安装入口**：Orca 有完整的技能安装 UI（安装按钮、终端输出、状态反馈），DSH 完全没有。用户无法从设置页面安装安全研发技能。

3. **依赖 Agent 预设**：DSH 的安全研发功能依赖 `security-research` Agent 预设。如果预设不存在，用户无法使用安全研发功能，也没有引导安装的 UI。

## 3. 迁移目标

1. **添加技能安装 UI**：将 Orca 的 `AgentSkillSetupPanel` 模式迁移到 DSH 的 `CapabilitySection` 中
2. **无条件注册**：安全研发设置页面应始终可见，在预设缺失时显示安装引导
3. **内联终端**：集成终端组件显示安装过程
4. **安装状态反馈**：安装/更新/刷新状态
5. **保持已有功能**：不破坏现有的授权范围编辑和报告导出

## 4. 迁移方案

### 4.1 修改条件注册逻辑

**当前逻辑（`index.ts`）：**
```typescript
// 仅当 security-research 预设存在时才注册
if (definition.id !== 'security') register(definition)
else ctx.effect(() => {
  // 条件注册：预设存在才显示
  const present = result?.ok === true && result.value.presets.some(preset => preset.id === 'security-research')
  if (present && release === undefined) release = register(definition)
  if (!present) { release?.(); release = undefined }
}, ...)
```

**修改为：始终注册 security 页面，在页面内部根据预设状态显示不同内容。**

```typescript
// 始终注册 security 页面
for (const definition of CAPABILITIES) {
  register(definition)  // 无条件注册所有能力页面
}
```

### 4.2 添加技能安装卡片

在 `CapabilitySection.tsx` 的 `SecurityResearchBody` 中，当预设缺失时显示安装卡片：

```typescript
function SecurityResearchBody(props: BodyProps): ReactNode {
  const { state, t } = props
  const security = state.phase === 'ready' ? state.security : undefined
  const presetPresent = security?.preset.present ?? false

  return <>
    {!presetPresent && (
      <SkillInstallCard
        title={t('securityInstallTitle')}
        description={t('securityInstallDescription')}
        installCommand="dsh --profile security-research"
        onInstall={...}
        t={t}
      />
    )}
    {/* 已有的 HeroHeader、SecurityScopeEditor、SecurityReportExport */}
  </>
}
```

### 4.3 新增 SkillInstallCard 组件

参考 Orca 的 `AgentSkillSetupPanel`，创建 DSH 版本的安装卡片：

```typescript
// packages/client/ui-settings-security/src/client/SkillInstallCard.tsx

function SkillInstallCard({ title, description, installCommand, t }: Props): ReactNode {
  return <div className={css.installCard}>
    <h3>{title}</h3>
    <p>{description}</p>
    <CopyText text={installCommand} t={t} />
    <p className={css.installHint}>{t('securityInstallHint')}</p>
  </div>
}
```

**设计决策：** DSH 使用 profile 启动模式（`dsh --profile security-research`）而非 Orca 的技能安装命令。安装卡片应：
1. 显示启动命令（可复制）
2. 说明在另一个终端运行
3. 提供文档链接

### 4.4 添加本地化文本

在 `locales.ts` 中添加：

```typescript
// 中文
securityInstallTitle: '安装安全研发能力',
securityInstallDescription: '安全研发 Agent 预设未安装。在另一个终端运行以下命令启动安全研发 profile。',
securityInstallHint: '启动后返回此页面配置授权范围。',
securityInstallCommand: 'dsh --profile security-research',

// 英文
securityInstallTitle: 'Install Security Research capability',
securityInstallDescription: 'The Security Research Agent preset is not installed. Run the following command in another terminal to start the security-research profile.',
securityInstallHint: 'Return to this page after startup to configure the authorization scope.',
securityInstallCommand: 'dsh --profile security-research',
```

### 4.5 后端适配

**当前后端 API 已足够：**
- `ctx.remote.agentPresets.list()` — 检测预设
- `ctx.remote.securityResearch.describe()` — 读取状态
- `ctx.remote.securityResearch.exportReport()` — 导出报告

**可能需要的新 API：**
- `ctx.remote.securityResearch.installPreset()` — 安装预设（可选，如果需要从 UI 触发安装）

但考虑到 DSH 的 profile 启动模式，从 UI 触发安装可能不适用。更好的方案是引导用户在终端运行命令。

## 5. 实施阶段

### 阶段 1：修复条件注册（1 天）
- 修改 `index.ts`，始终注册 security 设置页面
- 移除预设存在性条件注册逻辑
- 确保页面在预设缺失时也能显示

### 阶段 2：添加安装引导 UI（1-2 天）
- 创建 `SkillInstallCard` 组件
- 在 `SecurityResearchBody` 中根据预设状态显示安装卡片
- 添加本地化文本
- 添加复制命令功能

### 阶段 3：优化状态展示（1 天）
- 改进预设缺失时的状态展示
- 添加"检查再次"按钮
- 优化加载和错误状态

### 阶段 4：测试和验证（1 天）
- 测试预设存在时的正常流程
- 测试预设缺失时的安装引导
- 测试连接重置后的状态刷新

## 6. 依赖项

无需新增依赖，所有功能可在现有 `ui-settings-security` 包内完成。

## 7. 风险和注意事项

1. **分支问题**：用户提到"分支不对"，需要确认当前代码在正确分支上。可能需要合并或 rebase。
2. **预设安装方式**：DSH 使用 profile 启动而非技能安装，UI 需要适配这种模式。
3. **条件注册移除**：移除条件注册后，需要确保非安全研发用户不会看到无关的错误状态。
4. **向后兼容**：修改不能破坏现有的授权范围编辑和报告导出功能。

## 8. 优先级评估

**迁移优先级：高**

理由：
- 安全研发是用户核心使用场景之一
- 当前"实现了一半"的状态影响可用性
- 修复工作量小（主要是条件注册逻辑和安装引导 UI）
- 不需要大量新代码，主要是修改现有组件

**建议迁移顺序：最高优先级，在编排之后立即处理。**
