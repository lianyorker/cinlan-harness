# 集成（Integrations）迁移计划

## 1. 现状对比

### 1.1 Orca 的集成实现

Orca 的 `IntegrationsPane` 是一个源代码托管平台连接管理面板：

**前端 UI 组件：**
- `IntegrationsPane.tsx` — 集成面板容器，渲染三个集成卡片
- `cli-source-control-integration-cards.tsx` — GitHub 和 GitLab CLI 集成卡片
- `gitee-integration-card.tsx` — Gitee Token 集成卡片
- `integration-card-shell.tsx` — 集成卡片外壳组件（图标、名称、描述、状态徽章）
- `use-integration-provider-status-refresh.ts` — 自动刷新 Provider 状态的 hook
- `source-control-preflight-card-status.ts` — 预检状态管理 hook
- `integrations-pane-status.ts` — 集成状态计算（从 preflight 状态到 UI 状态）

**支持的集成：**
1. **GitHub** — 通过 `gh` CLI
   - 状态：`connected` / `not-installed` / `not-authenticated` / `unavailable` / `checking`
   - 认证命令：`gh auth login`
   - 安装链接：`https://cli.github.com`
2. **GitLab** — 通过 `glab` CLI
   - 状态：`connected` / `not-installed` / `not-authenticated` / `unavailable` / `checking`
   - 认证命令：`glab auth login`
   - 安装链接：`https://gitlab.com/gitlab-org/cli#installation`
3. **Gitee** — 通过环境变量 `CINLAN_GITEE_TOKEN`
   - 状态：`connected` / `not-configured` / `not-authenticated` / `unavailable` / `checking`
   - 认证方式：环境变量 Token
   - API：`https://gitee.com/api/v5`

**核心机制：**
- **Preflight 检查**：后端预检进程检测 CLI 安装和认证状态
- **自动刷新**：面板挂载时自动触发状态刷新
- **手动刷新**：每个卡片有"Re-check"按钮
- **状态展示**：每个卡片显示连接状态、账号信息、安装/认证引导

### 1.2 DSH 的集成现状

DSH **没有集成设置 UI**，但已有后端 Provider 基础设施：

**已有后端：**
- `work-items-github` — GitHub Work Items Provider（通过 GitHub REST API + Token 认证）
  - 使用 `GITHUB_TOKEN` 凭证引用
  - 支持读取和可选写入
  - 配置 owner/repository
- `work-items` — Work Items 服务框架
  - Provider 注册机制
  - 统一的 WorkItem 类型
- `webhook-github` — GitHub Webhook 处理
- `work-items-linear` — Linear Work Items Provider（参考实现）

**没有：**
- ❌ 集成设置页面
- ❌ GitHub/GitLab/Gitee 连接状态 UI
- ❌ Preflight 检查机制
- ❌ CLI 安装/认证引导
- ❌ GitLab Provider
- ❌ Gitee Provider

### 1.3 差距分析

| 能力 | Orca | DSH | 差距 |
|------|------|-----|------|
| GitHub 集成 UI | ✅ | ❌ | 需迁移 |
| GitLab 集成 UI | ✅ | ❌ | 需迁移 |
| Gitee 集成 UI | ✅ | ❌ | 需迁移 |
| Preflight 状态检查 | ✅ | ❌ | 需新建 |
| CLI 安装引导 | ✅ | ❌ | 需迁移 |
| CLI 认证引导 | ✅ | ❌ | 需迁移 |
| Token 认证 | ✅ | ✅ (GitHub) | DSH 已有 Token 机制 |
| 自动刷新 | ✅ | ❌ | 需迁移 |
| GitHub Provider | ✅ | ✅ | DSH 已有 |
| GitLab Provider | ✅ | ❌ | 需新建 |
| Gitee Provider | ✅ | ❌ | 需新建 |
| Work Items 集成 | ✅ | ✅ | DSH 已有框架 |

## 2. 迁移目标

1. 创建集成设置页面，注册 `settings.section` 插槽
2. 显示 GitHub、GitLab、Gitee 三个集成卡片
3. 每个卡片显示连接状态、安装/认证引导
4. 支持 Preflight 状态检查和手动刷新
5. 新建 GitLab 和 Gitee Work Items Provider（后端）
6. 将集成状态与 Work Items 功能关联

## 3. 迁移方案

### 3.1 新建 `ui-integrations` 客户端包

```
packages/client/ui-integrations/
├── src/
│   └── client/
│       ├── index.ts                       # 插件入口，注册 settings.section
│       ├── IntegrationsSection.tsx         # 集成设置页面
│       ├── IntegrationCard.tsx             # 通用集成卡片外壳
│       ├── GitHubIntegrationCard.tsx       # GitHub 卡片
│       ├── GitLabIntegrationCard.tsx       # GitLab 卡片
│       ├── GiteeIntegrationCard.tsx        # Gitee 卡片
│       ├── locales.ts                      # 中英文本地化
│       └── integration-status.ts           # 状态计算逻辑
├── tests/
│   └── apply.client.spec.ts
├── package.json
└── tsconfig.json
```

### 3.2 后端 Preflight 检查

**新建 `integration-preflight` 包或扩展现有 credentials 包：**

```typescript
// 检查 CLI 工具安装和认证状态
interface PreflightStatus {
  gh: { installed: boolean; authenticated: boolean }
  glab: { installed: boolean; authenticated: boolean }
  gitee: { tokenConfigured: boolean; authenticated: boolean }
}
```

**实现方式：**
- 检测 CLI 是否安装：`which gh` / `which glab`
- 检测认证状态：`gh auth status` / `glab auth status`
- 检测 Token：检查 `GITEE_TOKEN` 环境变量
- 检测 Token 有效性：调用 Gitee API `/api/v5/user`

### 3.3 集成卡片设计

**通用卡片结构（参考 Orca 的 `IntegrationCardShell`）：**
- 图标 + 名称
- 描述（连接后显示账号信息）
- 状态徽章（connected / not-installed / not-authenticated / checking）
- 详情区域：
  - 未安装：安装链接 + Re-check
  - 未认证：认证命令 + Learn more + Re-check
  - 已连接：账号信息

**GitHub 卡片：**
- CLI 认证方式
- 安装命令：引导安装 `gh` CLI
- 认证命令：`gh auth login`

**GitLab 卡片：**
- CLI 认证方式
- 安装命令：引导安装 `glab` CLI
- 认证命令：`glab auth login`

**Gitee 卡片：**
- Token 认证方式
- 配置引导：设置 `GITEE_TOKEN` 环境变量
- API 验证：`https://gitee.com/api/v5`

### 3.4 后端 Provider 扩展

**GitLab Work Items Provider（新建 `work-items-gitlab` 包）：**
- 使用 GitLab REST API
- Token 认证（`GITLAB_TOKEN`）
- 配置 project（owner/project）
- 支持 merge requests、issues

**Gitee Work Items Provider（新建 `work-items-gitee` 包）：**
- 使用 Gitee Open API v5
- Token 认证（`GITEE_TOKEN`）
- 配置 project（owner/project）
- 支持 pull requests、issues

### 3.5 设置插槽注册

```typescript
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'integrations',
  order: 35,  // 在 orchestration (30) 之后
  label: () => t('nav'),
  locale: NS,
  inject: () => injected,
}, IntegrationsSection))
```

### 3.6 与 Work Items 关联

集成状态应影响 Work Items 功能：
- GitHub 集成连接后，Work Items GitHub Provider 可用
- GitLab 集成连接后，Work Items GitLab Provider 可用
- Gitee 集成连接后，Work Items Gitee Provider 可用

集成设置页面可以链接到任务来源设置页面（Tasks），反之亦然。

## 4. 实施阶段

### 阶段 1：后端 Preflight 检查（2-3 天）
- 新建 Preflight 检查服务
- 实现 CLI 安装检测
- 实现 CLI 认证检测
- 实现 Token 配置检测
- 添加 Remote API

### 阶段 2：集成设置 UI（2-3 天）
- 创建 `ui-integrations` 包
- 注册 `settings.section` 插槽
- 实现 IntegrationsSection 容器
- 实现通用 IntegrationCard 组件
- 添加本地化文本

### 阶段 3：GitHub 卡片（1-2 天）
- 实现 GitHubIntegrationCard
- 连接 Preflight API
- 显示安装/认证引导
- 实现刷新逻辑

### 阶段 4：GitLab 卡片（1-2 天）
- 实现 GitLabIntegrationCard
- 连接 Preflight API
- 显示安装/认证引导
- 实现刷新逻辑

### 阶段 5：Gitee 卡片（1-2 天）
- 实现 GiteeIntegrationCard
- 连接 Preflight API
- 显示 Token 配置引导
- 实现刷新逻辑

### 阶段 6：后端 Provider 扩展（3-4 天）
- 新建 `work-items-gitlab` 包
- 新建 `work-items-gitee` 包
- 实现各自的 API 客户端
- 注册到 Work Items 服务

### 阶段 7：测试和集成（1-2 天）
- 编写单元测试
- 集成到设置页面
- 端到端验证

## 5. 依赖项

**前端：**
- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-client-ui-primitives` — UI 基础组件
- `@deepseek-ai/dsh-api-remotes` — 远程 API

**后端：**
- `@deepseek-ai/dsh-credentials` — 凭证管理
- `@deepseek-ai/dsh-work-items` — Work Items 框架

## 6. 风险和注意事项

1. **CLI 检测跨平台**：`gh` 和 `glab` CLI 在 Windows/Linux/macOS 上的检测方式不同，需要适配。
2. **Token 安全**：Gitee Token 通过环境变量配置，不应在 UI 中显示 Token 值。
3. **Preflight 性能**：CLI 检测可能较慢，需要异步执行和缓存。
4. **Provider 依赖**：GitLab 和 Gitee Provider 需要新建，工作量较大。
5. **与任务来源的关系**：集成和任务来源紧密关联，需要协调迁移顺序。

## 7. 优先级评估

**迁移优先级：高**

理由：
- 集成是 Git 工作流的基础，影响 PR/MR 功能
- DSH 已有 GitHub Provider 后端，前端 UI 是主要差距
- GitLab 和 Gitee Provider 需要新建后端，工作量较大
- 与任务来源功能紧密关联，应一起迁移

**建议迁移顺序：在通用设置之后，Git 和源代码控制之前。后端 Provider 可并行开发。**
