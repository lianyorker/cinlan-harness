# Git 与源代码控制设置：对齐 Orca 的方案

目标是让 harness 的 工作区 → Git 与源代码控制 对齐 Orca（Cinlan IDE）的同名页面。阶段 0、1 已落地并实测，实施结果见文末。Orca 那页很全，但它大部分项目依赖桌面端才有的消费者；本方案按「消费者先于设置项」排序，先做不需要新宿主的部分。

## 现状核对（已 grep 证实）

| 能力 | harness 现状 | 消费者 |
|---|---|---|
| 分支前缀（git 用户名 / 自定义 / 无） | 有 | packages/workspace/worktree-task-git 的建分支路径 |
| 源代码管理分组顺序 | 有 | 客户端变更面板 |
| 默认对比基准 | 有 | packages/git/sidebar-git |
| 提交署名 | 有 | packages/git/sidebar-git |
| 保持本地 main 最新 | 有开关，**无消费者** | 无（types.ts 注释自述只有重置） |
| 自动重命名分支 | 无 | — |
| 源代码控制 AI（默认值 / 显示 AI 操作 / 8 个操作方案） | 无 | 无（无仓库内 AI 执行宿主） |
| 托管评审创建默认值 | 无 | 无（无 GitHub/GitLab 托管评审） |
| GitHub / GitLab API 预算 | 无 | 无（无 gh/glab 配额探测） |

## 阶段 0：把死开关做活（可立即完成）

refreshLocalBaseRefOnWorktreeCreate（设置页写「保持本地 main 最新」）今天只是一个能开能关、什么都不做的开关。两条出路，方案取前者：

1. **实现消费者**（推荐）：在 worktree-task-git 创建 worktree 之前，读取该偏好；为真时对当前本地默认分支（main/master）执行一次 fetch，并在「没有本地领先提交且工作区干净」时快进到上游。不满足条件就跳过更新，与 Orca 的描述一致（它明确写了 git diff main...HEAD 的语义）。
2. 撤掉设置项，字段保留只做兼容读取。

落点：packages/workspace/worktree-task-git/src/index.ts（决策点靠近它已有的建分支 switch），偏好读取沿用 git-settings 的既有 schema。验证：单测覆盖「干净且落后 → 快进」「本地领先 → 跳过」「工作区脏 → 跳过」「偏好关闭 → 不 fetch」，再加一条进入真实 cordis.yml 的组合测试。

## 阶段 1：纯本地 Git 行为（可立即完成）

「自动重命名分支」：Orca 在智能体于新工作区开工时，把自动生成的分支（如 Nautilus）改名为任务短名，且已推送的不再改名。harness 侧对应物是 worktree 任务创建时的分支命名链路：

- 新增偏好 autoRenameTaskBranch（默认关），与 branchPrefix 同属 git-source-control 命名空间。
- 重命名只发生在「分支由本工具创建、尚未推送」时；用 git branch -m 完成，失败保持原名并只记日志。
- 落点：packages/workspace/worktree-task-git + git-settings schema；设置页加一行开关（含说明「仅重命名由 Cinlan 创建且未推送的分支」）。

## 阶段 2：源代码控制 AI（需要先定执行宿主）

Orca 这一块是 8 个「操作方案」：Commit message、Pull request details、Branch name、Commit failure fixes、Push failure fixes、Broken checks fixes、Conflict resolution、Review comment resolution；每个都有预设（使用默认智能体 / 指定智能体）、CLI 参数、提示词模板、变量 chips（如 {basePrompt} {branch} {stagedFiles} {stagedPatch} {linkedIssue}）与保存按钮；上方还有「源代码控制 AI 默认值」和「显示源代码控制 AI 操作」。

harness 里**没有**能跑这些动作的宿主：需要一个「在仓库工作区里按模板跑一次智能体、把结果回填」的执行者。方案要点：

1. 定义宿主能力（新的 Service Definition）：输入 = 动作类型 + 渲染后的提示词 + 工作区与仓库范围，输出 = 结构化结果（提交信息 / PR 标题正文 / 分支名 / 修复补丁）。
2. 默认实现用现有 agent/subagent 能力跑一次会话；模型与 CLI 参数从偏好取，未配置时用会话默认。
3. 数据模型：每个动作一条记录（预设、CLI 参数、提示词模板），存 git-source-control 命名空间下的子对象；模板变量由宿主渲染，模型可见内容必须能从会话日志重建。
4. UI 落点：ui-git-settings 新增可折叠的「操作方案」区块，逐动作一行；搜索元数据同步。

这一步的工作量在宿主侧，不在设置页；先定宿主形态（新包还是复用 subagent）再动 UI，否则就是一排没有效果的开关。

## 阶段 3：托管评审创建默认值（需要托管评审能力）

Orca 的 4 个复选项（默认草稿 / 可用时使用评审模板 / 打开 Create PR 时生成详细信息 / 创建后打开托管评审）都作用于「创建托管评审」这个动作。harness 没有 GitHub/GitLab 托管评审的创建链路，因此这一阶段的前置是：先有一处能创建 PR/MR 的能力（凭据、仓库归属、模板），再把 4 个偏好接上。

## 阶段 4：GitHub / GitLab API 预算（需要配额探测）

Orca 显示 REST / 搜索 / GraphQL 的剩余量与重置时间，并可「打开远程服务器」。harness 侧需要一个宿主探测：调用 gh api rate_limit（或 glab 等价命令），把结果映射成三类预算；探测失败时整块显示「预算不可用」而不是 0。这一阶段独立于阶段 2/3，可以先做。

## 建议的落地顺序

1. 阶段 0 + 阶段 1：两周内的自洽改动，不引入新 seam，设置页只加/改必要的行。
2. 阶段 4：单个宿主探测 + 一块只读面板，风险低。
3. 阶段 2：先定执行宿主，这是唯一需要跨包架构决策的部分。
4. 阶段 3：等托管评审能力出现后再接。

## 实施结果（2026-10-03）

### 阶段 0 · 保持本地 main 最新（已完成）

worktree-task-git 的创建路径改为：解析当前分支 → 按 refreshLocalBaseRefOnWorktreeCreate 刷新 → 再解析基准提交，因此 worktree 从**快进后**的提交切出（顺序是关键，先解析基准会让刷新失效）。刷新是 best effort：没有配置上游、fetch 失败（离线）、或分支有本地领先提交时不改动；工作区脏在更早的 status 检查就已拒绝。

设置页文案同步：runtimeNotice 删掉「本地基线刷新不可用」，keepLocalMainDescription 改为真实行为描述（中英）。

### 阶段 1 · 重命名任务分支（已完成）

新偏好 autoRenameTaskBranch（默认关，git-source-control 命名空间）。开启时分支用任务名 slug：dsh/task/fix-login-redirect；branchSlug 做 NFKD 归一、小写、非字母数字折叠为单横线、48 字符截断；名称没有可用字符（全 CJK）或分支重名时回退 dsh/task/<task-id>。UI 在 ui-git-settings 的 TOGGLES 表里加一行（锚点 git-rename-branch），中英文案与搜索元数据同步。

### 顺带修掉的既有缺陷

**1. Git 设置整页加载失败（界面显示「加载设置失败。」）**，两层原因叠加，与通知页、浮动工作区同族：

- Host git-settings 的 Config 直接用了偏好 schema，没有 volatile 字段；设置文档只发布含 volatile 的 schema，于是该命名空间从未被发布。
- web bundle 里这一行的 id 是 git-settings，而设置文档按**加载器行 id**建命名空间键，所有消费者（客户端页面、sidebar-git、worktree-task-git）读的都是 git-source-control，两边对不上。

修法：Config 改为 GitSourceControlSettingsSchema.volatile()；bundle 行 id 改为 git-source-control。修复后页面正常加载，七行偏好全部可见。

**2. worktree-task-git 测试夹具缺口**：设置替身只有 get()，缺 describe() 与 update()，导致 24 个既有用例失败（18 个 describe is not a function、6 个 update is not a function）。补齐后逐条验证恢复。

### 验证证据

- 新增用例：快进（远端前进后本地被快进且 worktree HEAD 等于新提交）、本地领先跳过、任务名 slug、非 ASCII 回退——全部通过。
- ui-git-settings 22/22 通过；git-settings 通过；tsc -b 干净；相关 bundle 重建、服务重启后于运行中的应用实测。
- 实测页面（工作区 → Git 与源代码控制）：分支前缀（含预览）、自定义前缀、保持本地 main 最新（新文案）、源代码控制组顺序、与上游比较、Cinlan IDE 署名、重命名任务分支。

### 仍未做

阶段 4（API 预算：sidebar-git owner 探测 gh/glab 配额 → sidebar-git-controller 加 @Remote('providerBudgets') → UI 只读面板）、阶段 2（源代码控制 AI：新开仓库 AI 操作服务包，复用 subagent 会话，再做 8 个操作方案 UI）、阶段 3（托管评审默认值，前置是 PR/MR 创建能力），以及 README 双语更新与 Agent Note。

## 与方向守卫的关系

本页与浮动工作区不同：那页的结论是「撤掉自建、只留官方」；这里 Orca 与 harness 是同族实现，Orca 更全，因此方向是**补齐**而不是替换。任何一步都遵守仓库约定：设置项必须先有当前消费者，不允许为了对齐 UI 先加空开关。

## 相关文档

- [设置与产品导航方向守卫](SETTINGS-DIRECTION.md)
- [浮动工作区改造分析](FLOATING-WORKSPACE-ANALYSIS.md)