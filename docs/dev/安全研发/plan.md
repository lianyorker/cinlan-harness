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
// 当前资源页实现：packages/client/ui-settings-security/src/client/SecurityResourcesSection.tsx；以下 SkillInstallCard 为历史方案。

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

### 阶段 1：修复条件注册 ✅

- `index.ts` 已无条件注册所有能力页面（`for (const definition of CAPABILITIES) register(definition)`）
- 移除了预设存在性条件注册逻辑
- 页面在预设缺失时也能显示

### 阶段 2：添加安装引导 UI ✅

- 参考 Orca `AgentSkillSetupPanel` 视觉模式，创建 `SkillInstallCard` 组件
- 卡片头部：icon + 标题 + 状态药丸（未安装/已安装/失败）
- 命令栏：显示 `dsh --profile security-research`，可复制
- 动作行：Recheck 按钮，触发状态刷新
- `SecurityResearchBody` 中根据 `presetMissing` / `presetBroken` 分别渲染安装卡片和修复引导卡片
- 添加了中英文本地化文本
- 预设缺失/损坏时隐藏授权范围编辑器和报告导出

### 阶段 3：优化状态展示 ✅

- 三态预设处理：`presetMissing`（安装卡片）、`presetBroken`（修复引导卡片）、`presetReady`（授权范围编辑器 + 报告导出）
- 预设损坏时显示修复引导卡片（`securityPresetBrokenTitle`），隐藏 scope editor
- `RefreshButton` 提供"重新检查"功能
- 加载和错误状态通过 `ViewState` phase 区分

### 阶段 4：测试和验证 ✅

- 测试预设存在时的正常流程（scope editor 可见）
- 测试预设缺失时的安装引导（install card 可见，scope editor 隐藏）
- 测试预设损坏时的修复引导（broken card 可见，scope editor 隐藏）
- 测试连接重置后的状态刷新
- 测试 scope 状态（configured/empty/missing/expired/not-yet-valid）
- 测试读取失败时的错误展示

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

## 9. P0 信息收集工具链集成（进行中）

按 `官方功能差距对比.md` 的 P0 项推进，目标模式：每个外部工具一个 `@cinlan/tool-<name>` 包（`ctx.tools.register` + `ctx.subprocess`），argv 构造与结果解析为纯函数（无二进制也可单测），授权统一由 `assessment-scope-tool-policy` 上游强制（`target_id` 匹配授权目标 + 工具名进 `networkTools`），包内不做 scope 检查。

### 9.1 已完成

| 包 | 工具名 | 说明 |
|----|--------|------|
| `tool-nmap` | `nmap_scan` | 端口扫描，`-oX -` XML 解析，禁止 `--script` |
| `tool-httpx` | `httpx_probe` | Web 存活/指纹探测，`-json` 行解析，`-no-color -silent` 固定 |
| `tool-subfinder` | `subfinder_enum` | 被动子域名枚举，`-json` 行解析，去重 |
| `tool-naabu` | `naabu_scan` | 快速端口发现，`-json` 行解析，`-silent -exclude-cdn` 固定，不做服务识别 |
| `tool-nuclei` | `nuclei_scan` | 模板化漏洞验证，`-json` 行解析，固定 `-ni`（无带外回调），不发出 `-dast`/payload 变异参数 |
| `tool-ffuf` | `ffuf_fuzz` | 目录/参数 Fuzz，`-json` stdout 单文档解析，`-ac` 默认开，无激进速率参数 |
| `tool-masscan` | `masscan_scan` | 大网段 SYN 限速扫描，`-oJ -` JSON 数组解析（容忍流式截断），速率受模型侧 `1..1000000` 校验与部署 `maxRate` 双重上限 |
| `tool-katana` | `katana_crawl` | URL 爬取发现，`-json` 行解析，固定 `-json -silent -no-color`，深度上限 5，并发受部署 `maxConcurrency` 上限 |
| `tool-gau` | `gau_urls` | 被动历史 URL 获取（wayback/commoncrawl/otx/urlscan 白名单），JSON 行/纯文本行兼容去重，纯被动不接触目标 |
| `tool-bloodhound` | `bloodhound_enum` | 目录收集 → mkdtemp 产物 → 分诊摘要（各收集器计数 + 可 Kerberoast/AS-REP Roast 账户清单）→ 自清理 |
| `tool-impacket` | `keroboast` / `asrep_roast` / `secrets_dump` | 一包三工具：SPN 票据请求、无预认证 hash、SAM/NTDS 转储（`-just-dc` 含 DCSync 路径）；`redactionLevel: full\|masked`（默认 full） |
| `tool-nxc` | `nxc_spray` | 密码喷洒（smb/ldap/mssql/winrm/ssh），命中行解析时抹除密码，`--threads` 受部署 `maxThreads` 上限 |

接线点（每包相同清单）：`package.json`（`@cinlan/*`，peer/devDep cordis+dsh-subprocess+dsh-tools）、`tsconfig.json`（引用 vendor/cordis、core/tools、subprocess/subprocess）、`src/<tool>.ts` 纯函数、`src/index.ts` 注册、`tests/*.spec.ts`、README（英/中/`README.i18n.yaml`，哈希已用 pairing 命令重录）、`packages/bundle/security-research/cordis.patch.yml`（insert + `networkTools`）、`packages/bundle/security-research/package.json` 依赖、`tsconfig.host.json` references（九个 tool-* 与 `vuln-playbook`/`engagement-ledger` 均已登记）、`tsconfig.base.json` paths（`@cinlan/tool-*` 源码映射，供脚本源码面解析）。

### 9.2 验证状态

- 批次 1（六包）：`pnpm install`、README pairing 重录、lockfile 同步已完成；`docs/tool-catalog.md`/`tool-catalog.zh.md` 已随目录生成器登记 18 个工具包并重生成（双语配对校验绿）。
- 批次 2（masscan/katana/gau）：随包提交一并跑 `pnpm run test`（三个新包 spec）与 `pnpm run gen-tool-catalog`/`verify-tool-catalog`；全量 `pnpm run build` 仍需在普通终端执行（历史会话受限沙箱下 esbuild/tsx 的 service 子进程因 pipe stdio 被 EPERM 阻断）。

### 9.3 P0 后续批次

1. 域环境第二批：`Responder` / `ntlmrelayx`（需先设计 listener 生命周期：ctx.jobs 后台作业 + 本地 bind 白名单 + `exploit-execution` 动作）；委派攻击（rbcd）、ADCS（certipy）同批增量。

### 9.4 域环境批次（已实施，按最优选项落地）

按 2026-11-15 设计草案实施：5 工具（`bloodhound_enum`、`kerberoast`、`asrep_roast`、`secrets_dump`、`nxc_spray`），impacket 一包三工具，`secrets_dump` 默认 `full` 回显（Config `redactionLevel` 可收紧），egress 不构造（target + `credential-use` 动作 + 凭据引用三重把关），用户名模型可见、密码走 `credential_ref`。

授权侧：`assessment-scope-tool-policy` 新增第 4 类 `credentialTools`（空列表=不启用）——调用映射 `credential-use` 动作并构造 `operation.credential = {ref, purpose:'target-authentication'}`，与 grant 的 `credentials` 条目精确匹配；grant 把 `credential-use` 列入 `approvalRequiredActions` 时每次调用走人工审批（现有 `kind:'ask'` 链路，零新增机制）。凭据解析在工具 execute 内经 `ctx.get('credentials')`，密码绝不进入模型参数、工具结果或会话日志（nxc 命中行解析时额外抹除回显密码）。

已知限制（README 已记录）：密码随外部工具的原生参数（impacket 目标串、`-p` 标志）进入本机 argv，进程列表可见；`secrets_dump` 的 hash 按默认 `full` 返回供离线破解，留存期限由 grant evidence policy 约束。
