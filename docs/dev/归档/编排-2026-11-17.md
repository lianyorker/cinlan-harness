# 编排（Orchestration）迁移计划

## 1. 现状对比

### 1.1 Orca 的编排实现

Orca 的自动编排是一个**前端技能安装 + 后端多 Agent 协调**的完整方案：

**前端 UI 组件：**
- `OrchestrationPane.tsx` — 编排设置面板，管理技能安装、技能检测、刷新、使用示例
- `OrchestrationSetupCard.tsx` — 紧凑的技能安装卡片，管理安装/更新命令、终端显示、前置检查
- `OrchestrationSkillAgentCoverage.tsx` — Agent 技能覆盖状态显示，展示每个 Agent 的就绪状态（installed/missing）

**技能安装机制：**
- `agent-feature-install-commands.ts` — 定义安装和更新命令常量，包括编排、逆向、计算机使用、临时 VM、CLI 技能等
- `useInstalledAgentSkills.ts` — React hook 查询已安装的 Agent 技能，管理发现目标、缓存、加载/错误状态
- `useActiveProjectSkillRuntime.ts` — 解析活动项目技能运行时上下文，包括 WSL 可用性、终端 shell 覆盖、安装禁用原因

**核心功能：**
1. **技能安装**：通过 CLI 命令安装编排技能到各个 Agent
2. **覆盖检测**：检测每个 Agent 是否已安装编排技能
3. **使用示例**：提供编排使用示例和文档链接
4. **终端集成**：内联终端控件显示安装过程

### 1.2 DSH 的编排实现

DSH 有强大的**后端编排引擎**，但**缺少前端 UI 入口**：

**后端引擎：**
- `workflow-worker-thread` — Worker 线程工作流引擎，在 VM 上下文中执行模型编写的脚本
  - 支持并发 Agent 调用（`maxConcurrentAgents`）
  - 支持总 Agent 数限制（`maxTotalAgents`）
  - 支持 `parallel()`/`pipeline()` 调用
  - 同步超时和优雅释放
  - 工作流生命周期事件（start/phase/log/agent-start/agent-end/end）

- `tool-workflow` — 模型面向的 `workflow` 工具，完整脚本编写契约和生命周期管理
- `subagent/continuation.ts` — 可继续子 Agent 编排管理器
- `coordination-subagent-executor` — 协调任务执行器
- `ui-workflow-run` — 工作流运行节点 UI（展开/折叠 phases 和 members）

**已有能力：**
1. ✅ 工作流脚本执行（VM 沙箱、并发控制）
2. ✅ 子 Agent 委派和消息传递
3. ✅ 可继续子会话（跨轮次保持上下文）
4. ✅ 协调任务执行
5. ✅ 工作流运行可视化（`ui-workflow-run`）
6. ✅ 编排设置 UI（`ui-orchestration` 包，settings.section order 30）
7. ✅ Agent 预设编排能力检测（读取预设组合，检测 `tool-workflow`）
8. ✅ 编排使用示例和文档

### 1.3 Windsurf 对比

Windsurf 采用单 Agent + 工具调用模型，无显式编排：
- 无 `workflow`/`parallel`/`pipeline` 等编排原语
- 无子 Agent 委派
- 无技能安装/管理
- 优势：简单任务极快，无编排开销
- 劣势：无法处理大规模并行、多阶段、多 Agent 协调的复杂任务

**结论：DSH 不应模仿 Windsurf 的单 Agent 模型。DSH 的编排引擎面向需要大规模并行的复杂任务，这是 DSH 的差异化优势。**

### 1.4 差距分析

| 能力 | Orca | DSH | 差距 |
|------|------|-----|------|
| 工作流脚本执行 | ❌ | ✅ | DSH 更强 |
| 子 Agent 委派 | ❌ | ✅ | DSH 更强 |
| 可继续子会话 | ❌ | ✅ | DSH 更强 |
| 并发控制 | ❌ | ✅ | DSH 更强 |
| 工作流运行可视化 | ❌ | ✅ | DSH 更强 |
| 编排设置 UI | ✅ | ✅ | 已实现 `ui-orchestration` |
| 技能安装流程 | ✅ | N/A | DSH 不需要（编排由 `tool-workflow` 提供） |
| Agent 覆盖检测 | ✅ | ✅ | 已实现（检测预设组合中 `tool-workflow`） |
| 使用示例 | ✅ | ✅ | 已实现 |

### 1.5 关键设计决策

**DSH 不需要技能安装流程。** Orca 的编排能力通过"安装技能到各 Agent"实现，但 DSH 的编排是**模型驱动的**——模型通过 `tool-workflow` 工具编写 workflow 脚本，引擎在 worker 线程中执行。编排能力由 Agent 预设包含 `tool-workflow` 工具即可获得，无需"安装"步骤。

**Agent 覆盖检测改为预设能力检测。** 检测每个 Agent 预设的组合（`agentPresets/read`，wire name 对应 host 的 `readDocument`）是否包含 `tool-workflow` 模块，而非检测技能文件是否存在。

## 2. 迁移目标

在 DSH 设置中添加编排入口页面，展示编排能力和状态。最终用户应能：
1. 在设置中看到编排设置页面
2. 查看哪些 Agent 预设支持编排（包含 `workflow` 工具）
3. 查看编排使用示例和脚本编写指南
4. 了解 DSH 编排引擎的能力概览

## 3. 迁移方案

### 3.1 新建 `ui-orchestration` 客户端包

创建 `packages/client/ui-orchestration` 包，注册 `settings.section` 插槽。

**包结构：**
```
packages/client/ui-orchestration/
├── src/
│   ├── index.ts                        # Host 入口（空 apply）
│   ├── css-modules.d.ts
│   └── client/
│       ├── index.ts                    # 插件入口，注册 settings.section
│       ├── OrchestrationSection.tsx    # 编排设置页面
│       ├── OrchestrationSection.module.css
│       ├── locales.ts                  # 中英文本地化
│       └── view.ts                     # 预设编排能力检测
├── tests/
│   └── apply.client.spec.tsx
├── package.json
└── tsconfig.json
```

### 3.2 Agent 预设编排能力检测

通过 `agentPresets/list` 获取预设列表，`agentPresets/read`（wire name）读取组合文本，检测是否包含 `tool-workflow` 模块。

```typescript
async function detectOrchestrationCoverage(
  list: () => Promise<readonly AgentPresetRow[]>,
  read: (id: string) => Promise<AgentPresetDocument>,
): Promise<OrchestrationCoverage> {
  const presets = await list()
  const results = await Promise.all(presets.map(async (preset) => {
    if (preset.broken !== undefined) return { preset, status: 'broken' as const }
    const doc = await read(preset.id)
    const hasWorkflow = doc.content.includes('tool-workflow')
    return { preset, status: hasWorkflow ? 'ready' as const : 'missing' as const }
  }))
  return { presets: results }
}
```

### 3.3 UI 组件设计

**OrchestrationSection：**
- 标题：编排
- 描述：多 Agent 协调和工作流自动化
- 图标：网络/编排图标
- 内容：
  - 编排能力概览卡片（引擎状态、并发配置说明）
  - Agent 预设编排能力列表（每个预设显示 ready/missing/broken 状态）
  - 编排使用示例（workflow 脚本编写指南 + 文档链接）

**视觉参考：** 复用安全研发 `SkillInstallCard` 的状态药丸模式（not-installed/installed/failed → missing/ready/broken），保持设置页面视觉一致性。

### 3.4 后端适配

DSH 已有的后端引擎不需要修改。前端通过已有的 `agentPresets/list` 和 `agentPresets/read` Remote API 检测预设编排能力，无需新增后端 API。

### 3.5 设置插槽注册

```typescript
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'orchestration',
  order: 30,  // 在 agent-presets (20) 之后
  label: () => t('nav'),
  locale: NS,
  inject: () => injected,
}, OrchestrationSection))
```

## 4. 实施阶段

### 阶段 1：基础 UI 框架 ✅
- ✅ 创建 `ui-orchestration` 包（`package.json`、`tsconfig.json`、`tsdown.config.ts`）
- ✅ 注册 `settings.section` 插槽（order 30，在 agent-presets 20 之后）
- ✅ 实现 OrchestrationSection 组件（引擎概览 + 覆盖列表 + 使用示例）
- ✅ 添加中英文本地化（`settings.orchestration` 命名空间）

### 阶段 2：Agent 预设编排能力检测 ✅
- ✅ 实现预设列表查询和组合读取（`agentPresets/list` + `agentPresets/read`）
- ✅ 检测 `tool-workflow` 模块包含
- ✅ 实现预设编排能力列表 UI（ready/missing/broken 徽章）
- ✅ 添加刷新和统计（`coverageSummary`）

### 阶段 3：使用示例和文档 ✅
- ✅ 添加编排使用示例（workflow、parallel、pipeline）
- ✅ 使用 `IconBranchOutline16` 作为编排设置图标

### 阶段 4：测试和集成 ✅
- ✅ 编写客户端测试（9 项全部通过）
- ✅ typecheck 通过
- ⏳ web 端端到端验证

## 5. 依赖项

- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽声明
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-api-remotes` — 远程 API 调用（`agentPresets/list`、`agentPresets/read`）
- `@deepseek-ai/dsh-client-ui-primitives` — UI 基础组件

## 6. 风险和注意事项

1. **预设组合读取性能**：`read` 返回完整组合文本（`AgentPresetDocument`），对大量预设需并发读取 + 缓存。
2. **组合文本匹配精度**：`includes('tool-workflow')` 是简单字符串匹配，可能误匹配注释中的文本。可接受——组合文本中的注释本身代表编排意图。
3. **无技能安装**：与 Orca 不同，DSH 不需要技能安装流程。编排能力由 Agent 预设包含 `tool-workflow` 工具即可获得。

## 7. 优先级评估

**迁移优先级：高**

理由：
- DSH 后端编排引擎已经强大，前端 UI 是展示这一能力的重要入口
- 编排 UI 是 DSH 多 Agent 能力的用户可见窗口
- 安全研发已完成，编排是下一个优先项

**迁移顺序：安全研发之后，集成之前。**
