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

DSH 有强大的**后端编排引擎**，但**缺少前端 UI 和技能安装流程**：

**后端引擎：**
- `workflow-worker-thread` — Worker 线程工作流引擎，在 VM 上下文中执行模型编写的脚本
  - 支持并发 Agent 调用（`maxConcurrentAgents`）
  - 支持总 Agent 数限制（`maxTotalAgents`）
  - 支持 `parallel()`/`pipeline()` 调用
  - 同步超时和优雅释放
  - 工作流生命周期事件（start/phase/log/agent-start/agent-end/end）

- `subagent/continuation.ts` — 可继续子 Agent 编排管理器
  - 子会话生命周期管理
  - 持久化子 ID
  - 激活物化
  - 委派和消息路由

- `subagent/continuation-activation.ts` — 进程本地激活所有权管理
  - 准入控制
  - 父子驻留
  - 序列化交付
  - 结算和释放生命周期

- `coordination-subagent-executor` — 协调任务执行器
  - 启动子 Agent 并处理任务结果
  - 管理挂载/卸载生命周期

**已有能力：**
1. ✅ 工作流脚本执行（VM 沙箱、并发控制）
2. ✅ 子 Agent 委派和消息传递
3. ✅ 可继续子会话（跨轮次保持上下文）
4. ✅ 协调任务执行
5. ❌ 前端编排设置 UI
6. ❌ 技能安装流程
7. ❌ Agent 覆盖检测
8. ❌ 编排使用示例和文档

### 1.3 差距分析

| 能力 | Orca | DSH | 差距 |
|------|------|-----|------|
| 工作流脚本执行 | ❌ | ✅ | DSH 更强 |
| 子 Agent 委派 | ❌ | ✅ | DSH 更强 |
| 可继续子会话 | ❌ | ✅ | DSH 更强 |
| 并发控制 | ❌ | ✅ | DSH 更强 |
| 编排设置 UI | ✅ | ❌ | 需迁移 |
| 技能安装流程 | ✅ | ❌ | 需迁移 |
| Agent 覆盖检测 | ✅ | ❌ | 需迁移 |
| 使用示例 | ✅ | ❌ | 需迁移 |
| 内联终端 | ✅ | ❌ | 需迁移 |

## 2. 迁移目标

将 Orca 的编排前端体验迁移到 DSH，同时保留 DSH 已有的强大后端引擎。最终用户应能：
1. 在设置中看到编排设置页面
2. 一键安装编排技能到各个 Agent
3. 查看每个 Agent 的编排技能覆盖状态
4. 查看编排使用示例
5. 在安装过程中看到终端输出

## 3. 迁移方案

### 3.1 新建 `ui-orchestration` 客户端包

创建 `packages/client/ui-orchestration` 包，注册 `settings.section` 插槽。

**包结构：**
```
packages/client/ui-orchestration/
├── src/
│   └── client/
│       ├── index.ts                    # 插件入口，注册 settings.section
│       ├── OrchestrationSection.tsx     # 编排设置页面
│       ├── OrchestrationSetupCard.tsx   # 技能安装卡片
│       ├── AgentCoverageList.tsx       # Agent 覆盖状态列表
│       ├── locales.ts                  # 中英文本地化
│       └── install-commands.ts         # 安装命令定义
├── tests/
│   └── apply.client.spec.ts
├── package.json
└── tsconfig.json
```

### 3.2 技能安装命令

DSH 的技能安装需要适配其自身的包管理方式。Orca 使用 `cinlan skill install` 命令，DSH 应使用对应的 `dsh` CLI 或 `orca-cli` 命令。

**安装命令定义（参考 Orca 的 `agent-feature-install-commands.ts`）：**

```typescript
// 编排技能安装命令
const ORCHESTRATION_INSTALL_COMMAND = {
  install: 'cinlan skill install orchestration',
  update: 'cinlan skill update orchestration',
}
```

需要确认 DSH 是否有类似的技能安装机制，或者需要新建。

### 3.3 Agent 覆盖检测

**方案 A（推荐）：基于配置检测**

DSH 的 Agent 预设系统（`ui-agent-preset`）已经存在。编排覆盖检测可以：
1. 查询已注册的 Agent 预设列表
2. 检查每个预设是否包含编排相关的工具/能力
3. 显示覆盖状态

**方案 B：基于文件系统检测**

类似 Orca 的 `useInstalledAgentSkills`，检测技能文件是否存在。

### 3.4 UI 组件设计

**OrchestrationSection：**
- 标题：编排
 描述：多 Agent 协调和工作流自动化
- 图标：网络/编排图标

**OrchestrationSetupCard：**
- 安装/更新按钮
- 内联终端输出（复用 DSH 的终端组件）
- 前置检查状态
- 错误/加载状态

**AgentCoverageList：**
- Agent 列表，每个 Agent 显示 installed/missing 状态
- 刷新按钮
- 总计统计（已安装/缺失）

### 3.5 后端适配

DSH 已有的后端引擎不需要修改。前端只需：
1. 通过 `ctx.remote` 调用后端 API 检测技能状态
2. 通过终端能力执行安装命令
3. 通过 `ctx.settingsScope` 持久化编排相关设置

### 3.6 设置插槽注册

```typescript
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'orchestration',
  order: 30,  // 在 work-items (25) 之后
  label: () => t('nav'),
  locale: NS,
  inject: () => injected,
}, OrchestrationSection))
```

## 4. 实施阶段

### 阶段 1：基础 UI 框架（2-3 天）
- 创建 `ui-orchestration` 包
- 注册 `settings.section` 插槽
- 实现基本的 OrchestrationSection 组件
- 添加本地化文本

### 阶段 2：技能安装流程（2-3 天）
- 定义安装命令
- 实现 OrchestrationSetupCard
- 集成终端组件显示安装输出
- 实现安装/更新/刷新逻辑

### 阶段 3：Agent 覆盖检测（2-3 天）
- 实现 Agent 列表查询
- 实现覆盖状态检测
- 实现 AgentCoverageList 组件
- 添加刷新和统计

### 阶段 4：使用示例和文档（1-2 天）
- 添加编排使用示例
- 添加文档链接
- 添加帮助提示

### 阶段 5：测试和集成（1-2 天）
- 编写单元测试
- 集成到设置页面
- 端到端验证

## 5. 依赖项

- `@deepseek-ai/dsh-client-ui-settings` — 设置插槽声明
- `@deepseek-ai/dsh-client-ui-slots` — 插槽系统
- `@deepseek-ai/dsh-client-locale` — 本地化
- `@deepseek-ai/dsh-api-remotes` — 远程 API 调用
- `@deepseek-ai/dsh-client-ui-primitives` — UI 基础组件

## 6. 风险和注意事项

1. **技能安装机制差异**：Orca 使用 `cinlan skill install`，DSH 可能需要不同的命令。需要确认 DSH 的技能安装策略。
2. **Agent 预设集成**：DSH 的 Agent 预设系统与 Orca 不同，覆盖检测需要适配。
3. **终端集成**：DSH 的终端组件与 Orca 不同，内联终端需要适配。
4. **后端 API**：可能需要新增后端 API 来支持技能状态查询和安装。

## 7. 优先级评估

**迁移优先级：中**

理由：
- DSH 后端编排引擎已经强大，前端 UI 是补充而非核心
- 编排功能对普通用户不是日常使用路径
- 相比集成、Git 设置等高频功能，编排可以稍后迁移
- 但编排 UI 是展示 DSH 多 Agent 能力的重要入口，不应太晚

**建议迁移顺序：在安全研发和通用设置之后，集成之前。**
