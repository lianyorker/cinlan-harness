# 任务来源（Task Sources）迁移计划

## 1. 现状对比

### 1.1 Orca 的任务来源实现

Orca 的 `TasksPane` 管理任务来源 Provider：

**前端 UI 组件：**
- `TasksPane.tsx` — 任务来源设置面板
- 管理 GitHub 和 GitLab 两个任务来源 Provider

**核心功能：**
1. **Provider 列表** — 显示可用的任务来源（GitHub、GitLab）
2. **设置状态** — 显示每个 Provider 的连接状态（已连接/未配置）
3. **可见性切换** — 切换每个 Provider 在任务面板中的显示
4. **设置引导** — 链接到集成设置页面完成连接
5. **就绪检查** — 检查 Provider 是否已配置

**与集成的关系：**
- 任务来源依赖集成设置（GitHub/GitLab 连接）
- 未连接时显示"前往集成设置"链接
- 连接后可切换 Provider 可见性

### 1.2 DSH 的任务来源现状

DSH 已有完整的 Work Items 系统，但 UI 定位不同：

**已有后端：**
- `work-items` — Work Items 服务框架（Provider 注册、统一 WorkItem 类型）
- `work-items-github` — GitHub Provider（REST API + Token 认证）
- `work-items-linear` — Linear Provider
- `tool-work-items` — Work Items 工具（Agent 可调用）
- `work-items-controller` — API 控制器

**已有前端：**
- `ui-work-items` — Work Items 设置页面（`settings.section`, id: `work-items`, order: 25）
  - Provider 过滤器（GitHub / Linear）
  - 状态过滤器（open / closed / all）
  - 工作区上下文过滤
  - 搜索
  - 分页
  - Work Item 详情查看
  - 工作区/会话关联
  - 写入面板（WorkItemWritePanel）

- `ui-worktree-task` — Worktree 任务设置页面（`settings.section`, id: `worktree-task`, order: 16）
  - 管理 worktree 与任务的关联

### 1.3 差距分析

| 能力 | Orca | DSH | 差距 |
|------|------|-----|------|
| GitHub 任务来源 | ✅ | ✅ | 都有 |
| GitLab 任务来源 | ✅ | ❌ | 需新建 Provider |
| Gitee 任务来源 | ❌ | ❌ | — |
| Linear 任务来源 | ❌ | ✅ | DSH 独有 |
| Provider 可见性切换 | ✅ | ❌ | 需迁移 |
| 设置状态显示 | ✅ | ✅ | 都有 |
| 设置引导链接 | ✅ | ❌ | 需迁移 |
| 任务列表和详情 | ✅ | ✅ | DSH 更强 |
| 工作区关联 | ❌ | ✅ | DSH 独有 |
| 写入功能 | ❌ | ✅ | DSH 独有 |
| 独立设置页面 | ✅ | ✅ | 都有 |

**关键差距：**
1. DSH 缺少 GitLab 任务来源 Provider
2. DSH 缺少 Provider 可见性切换
3. DSH 缺少集成设置引导链接
4. DSH 的 Work Items 页面更偏操作（列表+关联+写入），Orca 的 Tasks 页面更偏配置（Provider 管理）

## 2. 迁移目标

1. 在现有 `ui-work-items` 中添加 Provider 管理功能
2. 添加 Provider 可见性切换
3. 添加集成状态显示和设置引导
4. 新建 GitLab Work Items Provider（后端）
5. 保持现有 Work Items 操作功能不变

## 3. 迁移方案

### 3.1 扩展 `ui-work-items` 页面

在现有 `WorkItemsSection` 顶部添加 Provider 管理区域：

```typescript
// 在 WorkItemsSection 中添加 Provider 管理区域
function ProviderManagementArea({ providers, t }: Props): ReactNode {
  return <div className={css.providerArea}>
    <h3>{t('providerManagement')}</h3>
    {providers.map(provider => <ProviderCard
      key={provider.id}
      name={provider.name}
      connected={provider.connected}
      visible={provider.visible}
      onToggleVisible={() => ...}
      onConfigure={() => ...}  // 跳转到集成设置
    />)}
  </div>
}
```

### 3.2 Provider 可见性

**后端：** 在 Work Items 设置中添加 Provider 可见性配置

```typescript
interface WorkItemsSettings {
  providerVisibility: {
    github: boolean
    gitlab: boolean
    linear: boolean
  }
}
```

**前端：** 每个 Provider 卡片有可见性开关，隐藏的 Provider 不出现在过滤器中。

### 3.3 集成状态显示

每个 Provider 卡片显示集成连接状态：
- 已连接 — 显示账号信息
- 未连接 — 显示"前往集成设置"按钮

```typescript
function ProviderCard({ name, connected, visible, onToggleVisible, onConfigure }: Props) {
  return <div className={css.providerCard}>
    <div className={css.providerHeader}>
      <span>{name}</span>
      <Badge status={connected ? 'connected' : 'disconnected'} />
    </div>
    {!connected && <Button onClick={onConfigure}>{t('goToIntegrations')}</Button>}
    {connected && <Switch checked={visible} onChange={onToggleVisible} />}
  </div>
}
```

### 3.4 新建 GitLab Work Items Provider

**新建 `work-items-gitlab` 包：**

```
packages/work-items/work-items-gitlab/
├── src/
│   └── index.ts    # GitLab Provider 实现
├── tests/
│   └── provider.spec.ts
├── package.json
└── tsconfig.json
```

**实现要点：**
- 使用 GitLab REST API v4
- Token 认证（`GITLAB_TOKEN`）
- 配置 project（owner/project）
- 支持 merge requests、issues
- 遵循 `WorkItemsProvider` 接口

### 3.5 设置页面结构调整

```
WorkItemsSection
├── Provider 管理区域（新增）
│   ├── GitHub Provider Card
│   ├── GitLab Provider Card
│   └── Linear Provider Card
├── 过滤器区域（已有）
├── 任务列表（已有）
└── 详情面板（已有）
```

## 4. 实施阶段

### 阶段 1：Provider 管理区域 ✅
- ✅ 在 `WorkItemsSection` 顶部添加 Provider 管理区域
- ✅ 实现 ProviderCard 组件（GitHub / GitLab / Linear 三卡片）
- ✅ 添加可见性开关（本地状态，阶段 4 持久化）
- ✅ 添加集成状态显示（通过 `integrationPreflight` 检查 GitHub / GitLab 连接）
- ✅ 添加本地化文本（中英文 `workItems` 命名空间扩展）

### 阶段 2：集成引导链接 ✅
- ✅ 添加"前往集成设置"按钮（未连接时显示，调用 `close()` 返回设置列表）
- ✅ 添加未连接状态提示（`goToIntegrationsHint`）
- ✅ 过滤器中隐藏不可见 Provider

### 阶段 3：GitLab Provider 后端 ✅
- ✅ 新建 `work-items-gitlab` 包（`packages/work-items/work-items-gitlab`）
- ✅ 实现 GitLab REST API v4 客户端（`PRIVATE-TOKEN` 认证、URL 编码项目路径）
- ✅ 实现 `WorkItemsProvider` 接口（list / get / writer）
- ✅ 注册到 Work Items 服务（`cinlan-work-items` bundle 已包含）
- ✅ 支持自托管 GitLab 实例（`origin` 配置项）
- ✅ 编写 11 项测试（覆盖写入、认证、分页、错误分类、生命周期）
- ✅ 更新核心类型 `WorkItemSource` / `WorkItemScope` 支持 `gitlab`
- ✅ 更新 `tool-work-items` 枚举和 scope 验证支持 `gitlab`

### 阶段 4：Provider 可见性持久化 ✅
- ✅ 新建 `WorkItemsSettings` 设置命名空间（`work-items` namespace）
- ✅ Host 端注册命名空间（`ctx.settings.register` + schemastery schema）
- ✅ Client 端绑定设置 scope（`ctx.settingsScope.bind`）
- ✅ 可见性开关通过 `settings.set()` 持久化（`githubVisible` / `gitlabVisible` / `linearVisible`）
- ✅ 过滤器中隐藏不可见 Provider

### 阶段 5：测试和集成（1 天）
- 编写单元测试
- 集成验证
- 端到端测试

## 5. 依赖项

**前端：**
- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-api-remotes` — 远程 API

**后端：**
- `@deepseek-ai/dsh-work-items` — Work Items 框架
- `@deepseek-ai/dsh-credentials` — 凭证管理

## 6. 风险和注意事项

1. **与集成迁移的依赖**：任务来源依赖集成设置，应在集成迁移完成后进行。
2. **现有功能保护**：扩展不能破坏现有 Work Items 列表、详情、关联、写入功能。
3. **Provider 可见性**：隐藏 Provider 后，已关联的 Work Item 应仍可访问。
4. **GitLab API 差异**：GitLab API 与 GitHub API 差异较大，Provider 实现需要适配。

## 7. 优先级评估

**迁移优先级：中**

理由：
- DSH 已有完整的 Work Items 功能，缺少的是 Provider 管理和 GitLab 支持
- Provider 可见性切换是体验优化，非核心功能
- GitLab Provider 后端工作量较大
- 与集成迁移紧密关联，应在集成之后进行

**建议迁移顺序：在 Git 和源代码控制之后，手机模拟器之前。**
