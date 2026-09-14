# Git 和源代码控制（Git & Source Control）迁移计划

## 1. 现状对比

### 1.1 Orca 的 Git 和源代码控制实现

Orca 有多个 Git 相关设置面板：

**GitPane.tsx — Git 设置主面板：**
1. **分支前缀（Branch Prefix）** — 创建 worktree 时分支名前缀
   - 选项：`git-username` / `custom` / `none`
   - 自定义前缀输入框（带实时反馈）
   - 使用 Git 用户名时只读显示
2. **保持本地 main 最新（Keep Local Main Up To Date）** — 创建工作区时自动刷新远程基础分支
   - 开关：`refreshLocalBaseRefOnWorktreeCreate`
   - 安全 fast-forward 本地 main/master 分支
3. **源代码控制组顺序（Source Control Group Order）** — 变更面板中的组排列
   - 选项：`changes-first` / `staged-first` / `untracked-first`
4. **与上游比较（Compare Against Upstream）** — 比较基准选择
5. **从 Work 自动重命名分支（Auto Rename Branch From Work）** — 根据工作项自动命名分支
   - 依赖 Source Control AI 设置
6. **Cinlan IDE 署名（Attribution）** — 在提交、PR、Issue 中添加署名
   - 开关：`enableGitHubAttribution`
   - 关键词：github, gh, pr, issue, co-author, coauthored, attribution

**CommitMessageAiPane.tsx — Source Control AI 设置：**
1. **启用 AI 操作** — 开关
2. **操作配方默认值（Action Recipe Defaults）** — AI 操作的默认配方
3. **托管审查创建默认值（Hosted Review Creation Defaults）** — 托管审查的默认设置
4. **异步设置写入队列**

**GitProviderApiBudgetPane.tsx — Git Provider API 预算：**
1. **GitHub API 速率限制** — 显示剩余配额
2. **GitLab API 速率限制** — 显示剩余配额

### 1.2 DSH 的 Git 和源代码控制现状

DSH 的 Git 功能在 `ui-better-sidebar` 包中，作为侧边栏的一个面板：

**已有功能：**
- `GitView.tsx` — 源代码控制面板：状态列表（staged/unstaged）、暂存/取消暂存、提交（带消息框）、分支切换、类 VSCode 历史
- `DiffView.tsx` / `DiffTab.tsx` — Diff 视图
- `git.ts` — Git 操作后端逻辑
- 侧边栏设置页面（`SideCardSection.tsx`）— 管理侧边卡片显示内容

**已有设置页面：**
- `ui-better-sidebar` 注册了 `settings.section`（id: `better-sidebar`, order: 100）— 侧边卡片设置

**没有：**
- ❌ 独立的 Git 设置页面
- ❌ 分支前缀设置
- ❌ 保持本地 main 最新设置
- ❌ 源代码控制组顺序设置
- ❌ 与上游比较设置
- ❌ 自动重命名分支设置
- ❌ Cinlan IDE 署名设置
- ❌ Commit Message AI 设置
- ❌ Git Provider API 预算显示

### 1.3 差距分析

| 设置项 | Orca | DSH | 差距 |
|--------|------|-----|------|
| Git 面板（提交/暂存/历史） | ✅ | ✅ | 都有 |
| Diff 视图 | ✅ | ✅ | 都有 |
| 分支前缀 | ✅ | ❌ | 需迁移 |
| 保持本地 main 最新 | ✅ | ❌ | 需迁移 |
| 源代码控制组顺序 | ✅ | ❌ | 需迁移 |
| 与上游比较 | ✅ | ❌ | 需迁移 |
| 自动重命名分支 | ✅ | ❌ | 需迁移 |
| Cinlan IDE 署名 | ✅ | ❌ | 需迁移 |
| Commit Message AI | ✅ | ❌ | 需迁移 |
| Git Provider API 预算 | ✅ | ❌ | 需迁移 |
| 独立 Git 设置页面 | ✅ | ❌ | 需迁移 |

**关键差距：Git 设置散落在侧边栏中，需要迁移为独立设置页面。**

## 2. 迁移目标

1. 创建独立的 Git 和源代码控制设置页面
2. 将 Git 相关设置从侧边栏迁移到独立设置页面
3. 迁移所有 Orca Git 设置项
4. 添加 Commit Message AI 设置
5. 添加 Git Provider API 预算显示
6. 保持侧边栏中的 Git 操作面板不变

## 3. 迁移方案

### 3.1 新建 `ui-git-settings` 客户端包

```
packages/client/ui-git-settings/
├── src/
│   └── client/
│       ├── index.ts                    # 插件入口，注册 settings.section
│       ├── GitSettingsSection.tsx       # Git 设置页面
│       ├── BranchPrefixSetting.tsx      # 分支前缀设置
│       ├── KeepLocalMainSetting.tsx     # 保持本地 main 最新
│       ├── GroupOrderSetting.tsx        # 源代码控制组顺序
│       ├── CompareUpstreamSetting.tsx   # 与上游比较
│       ├── AutoRenameBranchSetting.tsx  # 自动重命名分支
│       ├── AttributionSetting.tsx      # Cinlan IDE 署名
│       ├── CommitMessageAiSetting.tsx  # Commit Message AI
│       ├── ApiBudgetDisplay.tsx         # Git Provider API 预算
│       ├── locales.ts                   # 中英文本地化
│       └── git-settings-types.ts        # 设置类型定义
├── tests/
│   └── apply.client.spec.ts
├── package.json
└── tsconfig.json
```

### 3.2 设置项实现

**分支前缀（BranchPrefixSetting）：**
- 三选一：`git-username` / `custom` / `none`
- 自定义前缀输入框
- 实时反馈（前缀预览）
- 读取 Git 用户名（通过 `git config user.name`）

**保持本地 main 最新（KeepLocalMainSetting）：**
- 开关：`refreshLocalBaseRefOnWorktreeCreate`
- 说明文字：创建工作区时自动刷新远程基础分支

**源代码控制组顺序（GroupOrderSetting）：**
- 三选一：`changes-first` / `staged-first` / `untracked-first`
- 分段控件

**与上游比较（CompareUpstreamSetting）：**
- 比较基准选择（upstream / local main）

**自动重命名分支（AutoRenameBranchSetting）：**
- 开关 + AI 提示词编辑
- 依赖 Work Items 集成

**Cinlan IDE 署名（AttributionSetting）：**
- 开关：`enableGitHubAttribution`
- 在提交、PR、Issue 中添加 Co-authored-by 署名

**Commit Message AI（CommitMessageAiSetting）：**
- 启用 AI 操作开关
- 操作配方默认值
- 托管审查创建默认值

**Git Provider API 预算（ApiBudgetDisplay）：**
- GitHub API 速率限制显示
- GitLab API 速率限制显示
- 依赖集成状态

### 3.3 后端设置存储

使用 `ctx.settingsScope` 持久化设置：

```typescript
const gitSettings = ctx.settingsScope.bind<GitSettings>({
  namespace: 'git-settings',
})

interface GitSettings {
  branchPrefix: 'git-username' | 'custom' | 'none'
  branchPrefixCustom: string
  refreshLocalBaseRefOnWorktreeCreate: boolean
  sourceControlGroupOrder: 'changes-first' | 'staged-first' | 'untracked-first'
  compareAgainstUpstream: boolean
  autoRenameBranchFromWork: boolean
  autoRenameBranchPrompt: string
  enableGitHubAttribution: boolean
  commitMessageAi: {
    enabled: boolean
    actionRecipeDefaults: string
    hostedReviewDefaults: string
  }
}
```

### 3.4 设置插槽注册

```typescript
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'git-source-control',
  order: 36,  // 在 integrations (35) 之后
  label: () => t('nav'),
  locale: NS,
  inject: () => injected,
}, GitSettingsSection))
```

### 3.5 侧边栏影响

侧边栏中的 Git 操作面板（`GitView.tsx`）保持不变。新建设置页面只管理 Git **配置**，不影响 Git **操作**。

侧边栏的 `ui-better-sidebar` 设置页面（`SideCardSection`）中的 Git 相关配置项应移除或保留链接到新设置页面。

### 3.6 与集成页面的关系

Git 设置页面中的部分功能依赖集成状态：
- **署名**需要 GitHub/GitLab 集成连接
- **API 预算**需要集成连接
- **自动重命名分支**需要 Work Items 集成

这些依赖关系应在 UI 中明确提示，并在集成未连接时禁用相关设置。

## 4. 实施阶段

### 阶段 1：基础框架和分支前缀 ✅
- ✅ 创建 `ui-git-settings` 包（package.json, tsconfig.json, tsdown.config.ts）
- ✅ 注册 `settings.section` 插槽（id: `git-source-control`, order: 36）
- ✅ 实现 GitSettingsSection 容器
- ✅ 实现 BranchPrefixSetting（三选一 + 自定义输入 + 预览）
- ✅ 添加本地化文本（中英文）

### 阶段 2：基础 Git 设置 ✅
- ✅ 实现 KeepLocalMainSetting（开关）
- ✅ 实现 GroupOrderSetting（分段控件）
- ✅ 实现 CompareUpstreamSetting（开关）
- ✅ 实现 AttributionSetting（开关 + 关键词提示）

### 阶段 3：AI 相关设置（待实施）
- ⏳ 实现 AutoRenameBranchSetting
- ⏳ 实现 CommitMessageAiSetting
- ⏳ 添加后端 AI 设置存储
- ⏳ 实现异步设置写入

### 阶段 4：API 预算显示（待实施）
- ⏳ 实现 ApiBudgetDisplay
- ⏳ 连接集成状态
- ⏳ 显示 GitHub/GitLab API 速率限制

### 阶段 5：侧边栏清理和测试 ✅
- ✅ 侧边栏卡片中无 Git 配置项，无需清理（SideCardSection 只管理 tab/viewer）
- ✅ 编写单元测试（4 项全部通过）
- ✅ typecheck + build 通过
- ✅ web 服务器验证启动

## 5. 依赖项

**前端：**
- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-client-ui-primitives` — UI 基础组件
- `@deepseek-ai/dsh-api-remotes` — 远程 API

**后端：**
- `ctx.settingsScope` — 设置持久化
- `ctx.remote` — Git 操作和集成状态

## 6. 风险和注意事项

1. **侧边栏解耦**：Git 设置从侧边栏迁移出来，需要确保不破坏现有侧边栏功能。
2. **设置同步**：Git 设置可能被多个组件使用（侧边栏 Git 面板、worktree 创建逻辑等），需要确保设置变更正确传播。
3. **AI 功能依赖**：Commit Message AI 和自动重命名分支依赖 LLM 能力和 Work Items 集成，可能需要后端支持。
4. **跨平台 Git**：Git 用户名读取和分支操作在不同平台上行为可能不同。
5. **与集成的协调**：署名和 API 预算功能依赖集成状态，需要与集成迁移协调顺序。

## 7. 优先级评估

**迁移优先级：高**

理由：
- Git 是开发工作流的核心，设置项影响日常使用
- 当前 Git 设置散落在侧边栏中，用户体验不佳
- 分支前缀和署名是高频使用的设置项
- 与集成功能紧密关联，应一起迁移

**建议迁移顺序：在集成之后立即迁移。署名和 API 预算依赖集成状态。**
