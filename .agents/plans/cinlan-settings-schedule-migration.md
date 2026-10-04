# 方案：Cinlan Automation 设置页改接官方 Schedule

状态：待执行。前置提交 `52deb53875`（本地 automation 已退出出厂 Web 组合，官方 schedule/ui-schedule 已挂载）。

## 1. 目标

Settings 里保留「自动化任务」入口，但后端从本地 `@deepseek-ai/dsh-automation`（官方 0.1.7 后下线、本地保留）换成官方 `@deepseek-ai/dsh-schedule`。出厂只保留一套任务能力，模型侧四个 `schedule_*` 工具与页面共用同一份任务存储。

## 2. 两套接口对照

官方任务面（浏览器侧 `ctx.remote.schedule`，类型来自 `@deepseek-ai/dsh-schedule/client`）：

| 方法 | 语义 |
|---|---|
| `catalog()` | 全部保留任务（Task Manager 页同源） |
| `list({ sessionId })` | 某会话的活跃提醒 |
| `create(request)` | 建任务：`title`、`prompt`、频率（after/at/every/daily/weekly/cron）与 IANA 时区 |
| `update(request)` | 改内容或改时间 |
| `delete({ sessionId, id })` | 删任务 |
| `history(request)` | 投递历史 |

本地自动化面（`ctx.automationClient`，来自 `@deepseek-ai/dsh-api-automation-controller/client`）：快照 `{ runtime, catalog, history }` + `refresh` / `create(draft)` / `update` / `delete` / `run`，草稿模型为 `AutomationDraft`（频率 cron/daily/weekly + 时区 + prompt + 运行目标）。

## 3. 必须确认的语义差异

1. **执行模型不同**：本地 automation 每次按 cron **新建一个工作区会话**并跑 agent；官方 schedule 把内容**投递进一个已存在的会话**（`sessionId` 必填）。迁移后 Settings 页只能管理"投递给哪个会话的什么提醒"，不能表达"定时起一个新会话跑任务"。
2. **没有启用/停用开关**：官方只有创建与删除。当前面板的 enable 开关需要去掉，或在 UI 上以"删除/重建"表达。
3. **没有「立即运行」**：官方只有投递历史，面板上的 run 按钮需要移除。
4. **任务对模型可见**：官方任务会通过 `schedule_*` 工具被模型读写，并受预设作用域限制（minimal/子代理不可用）；本地 automation 对模型不可见。改接后 Settings 里的任务与模型看到的是同一批。

若 1 是硬需求（定时起新会话），则该需求应作为"官方 schedule 之上的扩展"另行设计，而不是继续保留 automation 子系统。

## 4. 推荐方案（A：Settings 变成官方 Schedule 的任务编辑器）

新增 `packages/client/ui-settings-schedule`（从现有 `ui-settings-automation` 改写而来，包名与目录一并更名，避免与新语义混淆）：

- 数据面：`inject: ['slots', 'locale', 'settingsMetadata', 'remote', 'remote.schedule', 'layout', 'uiWorkspace']`；命令直接调 `ctx.remote.schedule.catalog/list/create/update/delete/history`。官方已有 `ui-schedule` 的 `createCatalogSource` 与 `ScheduleTaskTab` 可复用其**类型**（不能跨包运行时导入，按客户端规则只能 `import type`）。
- 界面：列表（标题、频率、下次触发、状态、所属会话）+ 新建/编辑表单（标题、提示词、频率五选一、时区、目标会话）+ 详情（投递历史）+ 删除。沿用 Cinlan Settings 现有分组与样式令牌。
- 与官方 `ui-schedule` 的关系：`ui-schedule` 提供侧栏 Task Manager 页与 Turn 卡片；Settings 页是同一 `catalog()` 的第二视图，不新增存储。
- 移除：`packages/api/automation-controller`、`packages/automation/automation`、`packages/client/ui-settings-automation`、`packages/api/remotes` 里的 `automationRemote`，以及 `packages/client/ui-plugin-manager/src/client/AutomationSection.tsx`（它切换的 `experimental-schedule-bundle` 已被官方退役）。
- 存量数据：本地 `~/.clh` 下的 automation 定义文件。建议**不自动导入**（语义不同，会误导），在升级指南里说明"旧自动化任务不再调度，需在 Settings 里重建为 Schedule 任务"；若要保平滑，另加一次性只读导入器，把 cron/daily/weekly 定义按"投递到默认会话"转换，此导入器需单独评审。

## 5. 分步实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | 新建 `ui-settings-schedule`（面板 + locale + 测试），先只读列表接 `catalog()` | `pnpm run test:gui`；页面上看到官方任务 |
| P2 | 增删改与详情（`create/update/delete/history`），处理错误码（`InvalidRuleError` 等） | 单测覆盖参数映射与错误分支；页面可建可删 |
| P3 | 移除 automation 三包与 remotes/patch 残项，更新 bundle patch 与 `package.json` 依赖 | `pnpm install`、`verify-cordis-config`、`verify-package-dependencies` |
| P4 | 升级指南（`docs/upgrade-guide/`）与双语文档；Settings 导航文案从"自动化"改为"定时任务" | `doc-sync`、`test:docs` |

## 6. 工作量与风险

- 规模：面板约 600 行（含 4 个组件、locale、presentation）重写为官方数据模型，测试约 5 个 spec；移除侧三包约 2400 行。
- 风险 1：语义降级（见 3.1/3.3）需要产品确认，否则用户会失去"定时跑 agent"和"立即运行"。
- 风险 2：官方 `remote.schedule` 的请求/响应类型随上游演进，Settings 页会成为新的上游耦合点。
- 风险 3：Settings 导航当前是 Cinlan 自建分组，新增页面需要同时更新分组元数据与 i18n 字典。
