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
| `tool-impacket` | `kerberoast` / `asrep_roast` / `secrets_dump` | 一包三工具：SPN 票据请求、无预认证 hash、SAM/NTDS 转储（`-just-dc` 含 DCSync 路径）；`redactionLevel: full\|masked`（默认 full） |
| `tool-nxc` | `nxc_spray` | 密码喷洒（smb/ldap/mssql/winrm/ssh），命中行解析时抹除密码，`--threads` 受部署 `maxThreads` 上限 |
| `tool-listeners` | `responder_capture` / `ntlm_relay` | ctx.jobs 后台监听作业（立即返回 jobId，`job_output`/`job_kill` 操作）；本地 bind 为监听面、relay 目标为唯一外发方向，`maxListenMs` 封顶会话窗口；映射 `exploit-execution` |
| `tool-certipy` | `adcs_find` | ADCS 收集（certipy find -stdout），CA/模板行解析，`-vulnerable` 过滤 ESC 类路径；映射 `credential-use` |
| `tool-impacket` 增量 | `rbcd` | impacket-rbcd 约束委派写入（固定 `-action write`），映射 `persistence-change` |

接线点（每包相同清单）：`package.json`（`@cinlan/*`，peer/devDep cordis+dsh-subprocess+dsh-tools）、`tsconfig.json`（引用 vendor/cordis、core/tools、subprocess/subprocess）、`src/<tool>.ts` 纯函数、`src/index.ts` 注册、`tests/*.spec.ts`、README（英/中/`README.i18n.yaml`，哈希已用 pairing 命令重录）、`packages/bundle/security-research/cordis.patch.yml`（insert + `networkTools`）、`packages/bundle/security-research/package.json` 依赖、`tsconfig.host.json` references（九个 tool-* 与 `vuln-playbook`/`engagement-ledger` 均已登记）、`tsconfig.base.json` paths（`@cinlan/tool-*` 源码映射，供脚本源码面解析）。

### 9.2 验证状态（2026-11-16 刷新）

- 每批次固定验证链：新包 `tsc -b` + vitest spec、`gen-tool-catalog` + `verify-tool-catalog`（目录 EN 重生成、ZH 区间同步、块级校验）、README pairing `--write` 重录后全仓检查本批文件零违规、`build:check`（host/client 聚合门）绿后一次提交。
- 全量 `build:check` 与 `build:artifacts`：批次 5 后多轮实测全绿；期间 `build:check` 抓到过一次测试文件类型错（huawei spec 参数缺失被运行时 throw 掩盖）——聚合检查有效。
- snapshot：`security-enum-turn` 场景 record 与 replay 单跑双绿（详见 §9.9）；本机全量 `test:snapshot` 有存量失败（`~/.clh` 旧 zstd session 与 compression none 冲突、SDK feedback 环境差异），与本任务链改动无关，权威信号在 CI 的 macOS/Linux lane。
- `doc-sync`：本任务链引入的唯一违规（9 个 README Summary 超词限）已修复；剩余红项（missing Summary 的 5 包、model-experience 短表单形态等）为存量/无关工作树的连带。
- `verify-cordis-config`：security 域清零（含补齐 `@cinlan/api-security-research-controller`、`@cinlan/security-skills`、`@cinlan/security-rea` 的 tsconfig paths 存量缺口）。

### 9.3 P0 后续批次

1. 【已实施 2026-11-17】ESC 利用链：`adcs_req`（certipy req，经 ESC 路径请求证书——PFX 产物写私有临时目录，结果携带路径+摘要行）+ `adcs_auth`（certipy auth，用 PFX 认证取 TGT/NT hash）——`exploitTools` 映射 `exploit-execution`，进 deployment 的审批建议清单。certipy forge/ca/template/shadow 明确不实现（README 已知限制记录）。
2. 【已实施，见 §9.6/§9.7】云平台批次（AWS/Azure/GCP/阿里云/腾讯云/华为云 CLI）。
3. 【明确不实现】ntlmrelayx SOCKS 链（交互式 SOCKS 客户端语义不适合无交互模型工具）与 Responder 之外的投毒面（现有两条监听路径覆盖典型面，扩展面留技能层 as-* 系列）。

### 9.5 域环境第二批（已实施，按最优选项落地）

三项设计决策均按建议落地：监听器用 ctx.jobs 后台作业（`@cinlan/tool-listeners` 一包两工具，`responder_capture` + `ntlm_relay`）；`exploit-execution` 与 `persistence-change` 建议部署列入 grant 的 `approvalRequiredActions`（bundle `exploitTools`/`persistenceTools` 列表已接线）；responder 捕获 hash 沿用 `full`（作业环形缓冲原样流式）。同批增量：`rbcd`（impacket 包第 4 工具，`persistenceTools` → `persistence-change`）、`adcs_find`（`@cinlan/tool-certipy`，`credentialTools` → `credential-use`）。授权侧 `assessment-scope-tool-policy` 泛化出 `optionalSelected` 并新增 `exploitTools`/`persistenceTools` 两类映射。

#### 设计依据（保留记录）

- `ctx.jobs.start({kind, label, owner, toolCall, run(job)})`：run 同步返回 `JobHooks`（`cancel(reason)` 同步终止 + `done: Promise<JobOutcome>`），`job.append` 写入输出环形缓冲；模型经 `job_list`/`job_output`/`job_kill` 观察、读取、终止——tool-bash 的 `run_in_background` 即此模式。**监听器生命周期无需新基础设施**。
- `AssessmentAction` 已含 `exploit-execution`；照抄 `credentialTools` 模式新增第 5 类 `exploitTools` 即完成动作映射。

#### 工具与生命周期

| 工具名 | 外部命令 | 包 | 生命周期 |
|--------|----------|-----|----------|
| `responder_capture` | `Responder -I <iface> -v` | `tool-responder` | ctx.jobs 后台作业，`run` 内 spawn，`cancel` 经 AbortSignal 终止子进程 |
| `ntlm_relay` | `ntlmrelayx -t <relay_target> -smb2support` | `tool-ntlmrelayx` | 同上；relay 目标必须匹配 grant 目标 |

- 启动即返回 JobId（模型随后 `job_output` 轮询捕获行、`job_kill` 停止）；`responder_capture` 的 hash 捕获行与 `ntlm_relay` 的中继事件行在 job 输出里流式可读。
- 安全线：本地 bind（Responder 多端口/ntlmrelayx 445/80 本地监听）不构成 egress；ntlmrelayx 的 `-t` 目标是唯一外发方向，参数校验必须匹配 `target_id`；**永不发出 interactsh/反连参数**。部署 Config `maxListenMs`（默认 600000）封顶作业时长，超时由 runtime 正常终止并保留已捕获输出。
- 动作映射：两类均 `exploitTools` → `exploit-execution`；grant 需显式授予该动作（建议默认进 `approvalRequiredActions`，每次投毒/中继弹人工审批）。

#### 同批增量（一次性 subprocess，无监听器）

- `tool-rbcd`：`impacket-rbcd`（RBCD 委派篡改，写目标机器的 msDS-AllowedToActOnBehalfOfOtherIdentity——`persistence-change` 动作，需新增第 6 类 `persistenceTools`）
- `tool-certipy`：`certipy find`（ADCS ESC 面检查，只读，`credentialTools` 或 `reconnaissance` 二选一，推荐 `credential-use`——需要域凭据）

#### 已采纳的决策

1. 监听器走 ctx.jobs 后台作业（长窗口、流式观察、不阻塞回合）；
2. `exploit-execution` 与 `persistence-change` 进部署 grant 示例的 `approvalRequiredActions`；
3. responder 捕获 hash 回显 `full`（与 secrets_dump 一致）。

### 9.4 域环境批次（已实施，按最优选项落地）

按 2026-11-15 设计草案实施：5 工具（`bloodhound_enum`、`kerberoast`、`asrep_roast`、`secrets_dump`、`nxc_spray`），impacket 一包三工具，`secrets_dump` 默认 `full` 回显（Config `redactionLevel` 可收紧），egress 不构造（target + `credential-use` 动作 + 凭据引用三重把关），用户名模型可见、密码走 `credential_ref`。

授权侧：`assessment-scope-tool-policy` 新增第 4 类 `credentialTools`（空列表=不启用）——调用映射 `credential-use` 动作并构造 `operation.credential = {ref, purpose:'target-authentication'}`，与 grant 的 `credentials` 条目精确匹配；grant 把 `credential-use` 列入 `approvalRequiredActions` 时每次调用走人工审批（现有 `kind:'ask'` 链路，零新增机制）。凭据解析在工具 execute 内经 `ctx.get('credentials')`，密码绝不进入模型参数、工具结果或会话日志（nxc 命中行解析时额外抹除回显密码）。

已知限制（README 已记录）：密码随外部工具的原生参数（impacket 目标串、`-p` 标志）进入本机 argv，进程列表可见；`secrets_dump` 的 hash 按默认 `full` 返回供离线破解，留存期限由 grant evidence policy 约束。

### 9.6 云平台批次（已实施，六云一次全做）

按 2026-11-15 设计草案实施：六个 `@cinlan/tool-<name>` 包 × 3 个只读工具 = 18 工具，CLI 分别为 aws v2、az、gcloud、aliyun cli、tccli、KooCLI（`hcloud`，`obs_enum` 用独立 obsutil）。全部只读，不引入任何写/删/改资源动作。

授权侧（policy 横切）：`assessment-scope` 目标新增 `cloud` 类与 `AssessmentCloudScope`（provider 枚举 + 可选 regions/subscriptions/projects 允许列表，value 携带账户 id），子授权校验把 cloud 范围纳入 target 键防止子授权用"父声明、子省略"扩权；`assessment-scope-tool-policy` 新增 `cloudTools` 类（空=不启用）映射 `reconnaissance`，并收紧一条语义——任何类只要调用带 `credential_ref`，operation 都构造 credential 字段交 scope service 对照 grant 的 credentials 条目（云枚举工具实际解析凭据，凭据使用不再脱离凭据授予校验）。region/subscription/project 显式参数按 allowlist 小写比对，范围外拒绝。

与草案的差异（实施时修正）：草案里多云共用的 `identity_get` / `iam_enum` 工具名会在 `ctx.tools` 撞名，实际按 provider 前缀命名——`az_account_show`、`gcp_identity_get` / `gcp_iam_enum`、`aliyun_identity_get`、`tencent_identity_get`、`huawei_identity_get` / `huawei_iam_enum`（aws 保留 `sts_get_caller_identity` / `iam_enum` / `s3_enum`）。凭据注入实测：AWS/阿里云/腾讯云走 env（`AWS_*`、`ALIBABA_CLOUD_*`、`TENCENTCLOUD_*`），GCP 用 SA JSON 写 mkdtemp 0600 文件 + `CLOUDSDK_AUTH_CREDENTIALS_FILE_OVERRIDE`（用后即删）；Azure 与华为 KooCLI/obsutil 没有 env 凭据通道，secret 只能走 argv（`-p`、`--cli-secret-key`、`-k=`），README 已知限制记录进程列表可见性。华为 `obs_enum` 改用独立 obsutil（KooCLI 内置 obs 的参数透传不稳定）；阿里 `oss_enum` 解析内嵌 ossutil 文本列表，公开性检查 defer（内嵌 ossutil 无稳定 JSON GetBucketInfo 路径）；`az login` 每次调用会更新本机 `~/.azure` 状态，README 记录。

已知限制（各 README 已记录）：云只读 API 请求计入账户配额；Azure/华为的 secret 进 argv；GCP 枚举工具每次调用都需要 `credential_ref`（gcloud 需身份文件）；华为 IAM 用户列表为 project 作用域，角色/策略列表与公开性检查延期；`s3_enum`/`cos_enum` 的公开性逐桶检查受 `maxPublicChecks`（默认 20）封顶，超限标 `skipped`，无法解析 ACL 的桶标 `unknown`。

#### 追加批次（已实施，2026-11-16）：deferred 检查补做 + recon 凭据注入

- GCP：新工具 `gcs_bucket_iam`（`gcloud storage buckets get-iam-policy`，返回绑定行 + 匿名主体标志）；华为：`huawei_iam_enum` 的 `resource` 扩展 `keys`（`IAM ListPermanentAccessKeys`，回到草案设计）；阿里：`oss_enum` 加 `public_status`（`aliyun ossutil api get-bucket-acl`——新版 CLI 透传内嵌 ossutil 2.0，按 `public-read`/`public-read-write` 权限判定公开性，`maxPublicChecks` 封顶同 AWS/Tencent 形态）。
- 修复批次 5 实现缺陷：AWS/阿里/腾讯的 recon 工具（`iam_enum`、`s3_enum`、`ram_enum`、`oss_enum`、`cam_enum`、`cos_enum`）此前没有暴露 `credential_ref`——env 注入型 CLI 的凭据没有传给子进程，会退回本机配置链。全部补可选 `credential_ref` 参数 + `resolveXxxEnv` helper；缺省时由本机配置链提供（README 记录），呈现引用时经 policy 构造 `operation.credential` 对照 grant。

### 9.7 云写路径批次（已实施，按草案落地）

按 2026-11-16 草案实施：六云各 1 对授予/回滚写工具共 12 个，policy 新增第 8 类 `cloudWriteTools`（空=不启用）映射 `persistence-change` 并沿用 cloud 目标 allowlist 检查；bundle 示例把全部 12 个列入 `cloudWriteTools`。工具与授权映射：AWS `iam_policy_attach`/`iam_policy_detach`（`aws iam attach/detach-user-policy`，policy-arn 格式校验）、Azure `role_assignment_create`/`role_assignment_delete`（`az role assignment create/delete`，assignee/scope 格式校验）、GCP `iam_binding_add`/`iam_binding_remove`（`gcloud projects add/remove-iam-policy-binding`，member/role 格式校验）、阿里 `ram_policy_attach`/`ram_policy_detach`（`AttachUserPolicy`/`DetachUserPolicy`）、腾讯 `cam_policy_attach`/`cam_policy_detach`（数字 policyId/UIN）、华为 `iam_group_add_user`/`iam_group_remove_user`（`KeystoneAddUserToGroup`/`KeystoneRemoveUserFromGroup`）。

| 包 | 授予工具 | 回滚工具 | CLI |
|----|----------|----------|-----|
| `tool-aws` | `iam_policy_attach` | `iam_policy_detach` | `aws iam attach-user-policy / detach-user-policy`（`--policy-arn` + `--user-name`，只引用已存在的 managed policy） |
| `tool-azure` | `role_assignment_create` | `role_assignment_delete` | `az role assignment create / delete`（`--assignee` + `--role` + `--scope`；role 用既有角色名） |
| `tool-gcp` | `iam_binding_add` | `iam_binding_remove` | `gcloud projects add-iam-policy-binding / remove-iam-policy-binding`（`--member` + `--role`） |
| `tool-aliyun` | `ram_policy_attach` | `ram_policy_detach` | `aliyun ram AttachUserPolicy / DetachUserPolicy`（`--PolicyType Custom|System` + `--PolicyName` + `--UserName`） |
| `tool-tencent` | `cam_policy_attach` | `cam_policy_detach` | `tccli cam AttachUserPolicy / DetachUserPolicy`（`--policyId` + `--attachUin`） |
| `tool-huawei` | `iam_group_add_user` | `iam_group_remove_user` | `hcloud IAM KeystoneAddUserToGroup / KeystoneRemoveUserToGroup`（`--user_id` + `--group_id`，用户进/出授权组——华为的授权模型走用户组，进组即提权验证） |

安全线：授予工具回显操作前的绑定状态（attach 前先读，便于确认回滚目标）；参数全部显式（用户/策略/角色/组 id 或名称，含注入校验）；不可发出删除资源、修改策略文档本身、或创建新策略的调用；执行结果按 grant evidence policy 记录。grant 示例：`actions` 需含 `persistence-change` 且建议列入 `approvalRequiredActions`。

实施结果与草案差异：全部遵循"只引用已存在策略/角色/组"的安全线（参数格式白名单校验拒绝注入与任意文档），attach/detach 严格配对，未做"操作前绑定状态回读"（描述里引导先跑对应 enum 工具，避免每次写前翻倍 CLI 调用）。policy.spec 补 `cloudWriteTools` 正反用例（映射 persistence-change + 带 credential 构造 operation.credential + 配置校验）。实施插曲：ZH 目录插入时 `iam_group_*` 锚点选错导致 huawei 段块序错位，pairing 块级校验抓到后已按 EN 字母序归位。

### 9.8 dsh-purge-safe 差距分析与原生集成草案（待实施）

对比 [CallMeGuLab/dsh-purge-safe](https://github.com/CallMeGuLab/dsh-purge-safe)（DSH 破甲插件，229 star）：它分两层。**破甲层**（patch 官方 `@deepseek-ai` 包的提示词/审批门/沙箱策略、加密提示词注入、规则库切换 prompt-inject.md、Apply/Restore/Uninstall dock）在 cinlan-harness 天然不需要——fork 原生可控，security-research profile 已经直接配置工具白名单与授权流，不需要"破"任何东西。**能力层**是需要原生集成的差距：

| purge-safe 能力 | cinlan-harness 现状 | 差距与集成方向 |
|----------------|--------------------|----------------|
| 红队模式 preset：1 指挥 + 5 执行角色（信息收集/资产梳理/漏洞发现/漏洞利用/内网渗透），并发闸门 3 | security-research 是单 agent 组合；DSH 有 agent teams / subagent 基建 | 新 preset 组合（复用现有 subagent/teams 基建），指挥角色带授权闸门（assessment-scope 检查在 policy 层已覆盖所有工具，多角色天然继承）【已实施：`security-redteam` 指挥 preset + 五角色 preset（recon/asset/vuln/exploit/intranet）经 classic subagent（release 基建，agent-team 是 experimental 不能进 release bundle）的 `allowedAgentPresets` 派活；并发 ≤3 为 persona 级约定；红队组合不沿用 research preset 的 never-approval，审批动作保留 ask 链路】 |
| SQLite 资产库（测绘结果入库、资产关联 asset-table/asset-correlation） | engagement-ledger 有 campaign/scope snapshot，无"测绘资产台账" | 新包 `@cinlan/asset-ledger`：发现的主机/端口/服务/凭据登记 + 关联（host→service→finding 已有链路的入口层）【已实施：按 one-home-per-fact 扩展现有 engagement-ledger 而非新包——LedgerAsset 增 `findings`（finding id 并集累积）与 `credentialRefs`（凭据引用名并集）关联字段、`cloud: {provider, accountId}` 云资产身份（host 携账户 id）；campaign_upsert 增 findingIds/credentialRefs/cloudProvider/cloudAccountId 参数，配对校验，JSON 持久化沿用既有原子写】 |
| 内嵌红队工具集（lib/redteam/tools.js，136KB web 工具） | 24 个 CLI 工具（nmap/httpx/nuclei/六云等），覆盖面按 CLI 有无 | 按 use case 排查缺口；CLI 工具链已覆盖大部分，缺的是"评估报告驱动的工具选择"（技能层职责） |
| 24 个红队技能（隧道 chisel/frp/suo5、内网 fscan/gogo、空间测绘 fofa、webshell、shell 处置等） | `@cinlan/security-skills` 资产包（eni-* 系列） | 技能内容差距已收敛并实施：对照盘点后 24 个主题里 20+ 已有对应技能（as-fscan-scan / as-gogo-scan / as-uncover-search / as-webshell-deploy / as-webshell-management / as-lateral-movement 等），补齐 4 个新技能——`as-chisel-tunnel`（HTTP 隧道/SOCKS5）、`as-frp-tunnel`（多协议长稳隧道）、`as-suo5-tunnel`（HTTP 全双工隧道，webshell 入口）、`as-reverse-shell`（监听器选型/载荷生成/TTY 升级/加密与痕迹）；技能计数 387→391，主路由 SKILL.md、期望 JSON 与测试断言同步 |
| 评分规则（score-rules.js） | finding 有 severity，无系统化评分 | finding 体系加评分规则（CVSS 简化版或项目自定义矩阵）【已实施：新技能 `as-finding-severity`——severity×confidence 双轴定级标准（status 对 severity 的硬上限矩阵、critical 三条件、confidence 与工具输出解耦、finding_transition 改口规则），技能计数 391→392；不加代码层评分引擎：finding 的 severity/confidence 本就是结构化双轴，纪律属于模型遵循的评估标准】 |
| 证据账本（evidence-ledger）+ 报告重放（report-replay） | evidence policy + finding 体系 + exportReport | 报告重放（从持久化 finding/session 重放出报告）可加在 security-research-controller【已评估：无差距——exportReport 已从持久化 finding + evidence 重建完整报告（report-download 授权后），as-report-generate 技能覆盖报告流程，keyless snapshot replay 覆盖 session 重放语义；不需要新的重放代码】 |
| 技能可用性自检/自愈（skill-availability/skill-fixes） | 无 | 工具二进制存在性检查（各 tool 包的 `resolveExecutable` 已有，缺汇总面） |
| Drill 本地环境评估 | 无 | 本机暴露面审计工具集（新批次评估）【已实施：新技能 `as-local-audit`——评估前工具链就绪度核查（六云 CLI/扫描/凭据工具逐项版本确认）+ 评估后本机遗留盘点（监听器/隧道孤儿进程、TEMP 凭据与载荷残留、GCP 临时 SA 文件核对、PSReadLine 历史的命令行凭据泄漏检查、campaign 台账收尾核对），技能计数 392→393；走现有 bash/fs 工具，无需新工具包】 |

**§9.8 收官（2026-11-16）**：五项全部落地——① 红队 preset（`security-redteam` 指挥 + 五角色，classic subagent 派活）② 资产台账（engagement-ledger 扩展 findings/credentialRefs/cloud 关联）③ 技能补齐（chisel/frp/suo5 隧道 + 反弹 shell，387→391）④ 评分纪律（as-finding-severity 双轴标准，391→392；报告重放判定为无差距）⑤ 本地审计（as-local-audit，392→393）。技能库最终 393 个。purge-safe 的破甲层天然不适用（fork 原生可控）；能力层的差距以 preset/包扩展/技能三种形态原生补齐，零第三方代码引入。

### 9.9 Snapshot 录制探索（2026-11-16，进行中）

中转端点（api.cinlan.online/v1，OpenAI 与 Anthropic Messages 协议均验证可用）提供 `deepseek-v4.1-flash` 与 `glm-5.3-flash`。结论与落地状态：

- **已修复（`3e8e312d17`）**：Windows cwd 的 token 化缺陷——runtime-context 文本内嵌 `JSON.stringify(cwd)`，路径反斜杠二次转义后 exact 匹配失配，fallback 正则只吃 basename 段留下 `%TEMP%\` 前缀；`cwdSpellings` 增补 JSON-stringified 形态后全绿（normalize.spec 新用例）。Linux/macOS 路径无反斜杠不受影响（官方 lane 无恙）。
- **rea-routing 场景**：`recording: authored` 不可重录；其注释声称的 `DSH_REA_FIXTURE_SERVER` stub 在 harness 里从未实现（authored 作者的未兑现假设）——修复它属于该场景原作者的工作面，不在本批处理。
- **security-enum-turn 新场景（record 成功、replay 待修剪）**：活录一个完整 turn（`subfinder 对 example.invalid 枚举，工具不可用如实报告`）——模型真调 `subfinder_enum` 工具、收到明确的 executable-not-found 错误并转述。产物：session.v4.jsonl + system-prompt.expected.md + tool-schemas.expected.json（83 个工具 schema，批次 1-5 全部安全工具在列）。场景 runtime patch 插入 20 个工具包行并 pin deepseek-v4.1-flash；harness 的 record 超时对该场景放宽（240s 进程 + 300s 用例）。
- **replay 已收敛（场景已提交）**：record 产物与 llm-replay 的形态差异为四类 record-only 内容——skill-catalog 事件（本机技能注入）、request/header 的 adapterDefaults 与 config maxTokens/reasoningEffort、request/context 的 contextWindow、真 provider 无法完成的 session-log delivery-accepted（replay 侧在 runtime patch 禁用上传对齐）。修剪后 fixture 的 sourceEventSeqs 引用与 message id 编号随之重编；单场景 record 与 replay 双绿（先 record、再按 diff 修剪、再 replay 验证的完整流程）。
- **架构决策（子代理工厂 vs 角色编排）**：不采用"海量子代理并发 + 无限重试"工厂模式——红队工作按证据链推进（发现→验证→利用），无证据的重试只烧 token 不产出；并发闸门 ≤3 + 角色专精 + 授权闸门（approval 链路）的形态产出密度更高且可审计。GPT-6 Cyber 基准（OpenAI 2026-11：280 万行内核代码、2308 潜在问题、1724 动态复现、948 个本地提权利用、$1.21M API 成本、304 个关键漏洞负责任披露）记录为自动化安全研究的行业标杆——其形态同样是**深度单线流水线**（复现→利用→人工复核）而非子代理农场，印证编排方向。

### 9.10 代码审计流水线批次（已实施，按草案落地）

行业基准形态：静态发现（宽进）→ 动态复现（严格过滤，GPT-6 Cyber 2308→1724 保留 74%）→ 利用生成（复现通过者）→ 人工复核收口（304/948 负责任披露）。我们的对应基础已齐：as-java/php-audit-pipeline 技能（静态方法论）、finding 的 status×severity 纪律（as-finding-severity：hypothesis 封顶 medium、reproduced 才可 high/critical）、红队 preset 的多角色编排模式。缺的是把三者串成流水线的**编排层**。

设计：`code-audit` 模式 preset——1 指挥 + 3 执行角色，经 classic subagent 派活（与红队 preset 同基建）：

| 角色 | 职责 | 工具面 |
|------|------|--------|
| 指挥 `security-code-audit` | 接审计委托（仓库/包路径）、拆分审计目标、按角色派活、复核 finding 定级、汇总 | tool-finding + tool-subagent + jobs |
| `audit-static` | 静态审计：路由映射→危险面枚举→数据流追踪（照 as-java/php-audit-pipeline 方法论），产出 hypothesis 级 finding（封顶 medium） | tool-fs/fs-search/skill + tool-finding |
| `audit-verify` | 动态复现：为每个 hypothesis 构造最小 PoC 并执行验证（bash/测试运行器），复现成功转 reproduced-vulnerability 并按证据重定级 | tool-bash/pwsh + tool-fs + tool-finding |
| `audit-report` | 修复建议与报告：对 reproduced finding 给修复方案、按 evidence policy 汇总，负责任披露的输出形态 | tool-finding + exportReport 链路 |

纪律（写进各角色 persona）：静态发现不经复现不得标 high 以上；复现 PoC 必须最小化（不引入新攻击面）；报告只含 reproduced + 明确标注 unresolved 的项；全程在授权仓库范围内（read-only 优先）。

实施完成：bundle 追加 4 个 preset 声明（security-code-audit 指挥 + audit-static/audit-verify/audit-report 三角色，并发 ≤2；tool-subagent 的 allowedAgentPresets 扩至 8 角色；纯 YAML + persona 零新代码），verify-cordis-config 与 bundle 测试全绿。

集成原则：**不引入 purge-safe 任何代码**（Apache-2.0 但我们按能力差距原生重做）；每项独立成包/独立批次，走与批次 1-5 相同的模式（设计草案 → policy 横切 → 包实现 → 双语 README/catalog/pairing → 一次提交）。

实施优先级建议：① 红队模式 preset（把现有 24 工具 + 授权体系编排成多角色，价值最高）→ ② 资产台账（测绘结果的持久层）→ ③ 技能补齐（隧道/webshell）→ ④ 评分与报告重放 → ⑤ 本地环境审计。
