<!-- 英文源文件由 scripts/gen-tool-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-tool-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/tool-catalog.md` 重新记录配对。 -->

# 工具 Schema 目录

[English](tool-catalog.md) | 中文

已发布插件向 `ctx.tools` 提供的所有面向模型的工具：模型通过系统提示词组装获得的 `name`、`description` 和 JSON Schema `parameters`。本目录是[子系统页面](subsystems/core.zh.md)（类型及每页生成的 `cordis-surface` 接线区域）的补充；本页列出的是向 agent（智能体）提供的*工具*。

英文源文件由系统**生成**，并通过 `pnpm run verify-tool-catalog`（`doc-sync`（文档同步门禁）的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。与 Cordis 目录（纯源码 AST 处理）不同，英文生成器会在真实上下文中**启动**每个工具插件并读取 `ctx.tools.schemas()`，因为工具 schema 无法通过静态分析完全确定，例如运行时展开的枚举、拼接的描述、由配置决定的名称以及使用原始 JSON Schema 的 MCP 工具。完整性守卫会 glob 匹配 `packages/*/tool-*`；如果生成器的启动 manifest（元数据清单）遗漏任何包，检查就会失败，因此新工具不会在无人察觉的情况下缺少文档。

范围：`packages/*/tool-*` 下已发布的产品工具，每个工具均使用其**默认**配置启动；但如果某个 Config 字段是**必填项**且没有默认值，生成器就必须作出选择，对应包的说明会记录本页展示的是哪个分支。注册的工具**名称**可以是加载时配置，例如 `tool-subagent` 的 `toolName`，因此部署可能以不同名称或额外名称提供某个包；如果存在随产品发布的别名，对应包的说明会予以记录。`examples/` 中的演示工具（例如 `echo`）不在范围内，这与 Cordis 目录仅涵盖包的范围一致。

<a id="tool-package-map"></a>

## 工具包映射

下表将模型可见的工具名称与其背后的插件包和服务 seam 对应起来。各包章节随后给出确切的 JSON Schema。

| 工具包 | 模型可见名称 | 依赖 | 写入／影响 | 随产品发布的别名 | 部署说明 |
| --- | --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-mcp-resources` | `list_mcp_resource_templates`、`list_mcp_resources`、`read_mcp_resource` | `ctx.tools`、`ctx.mcpResources` | `tool/call`、`tool/result` | - | - |
| `@deepseek-ai/dsh-tool-ask-user` | `ask_user_question` | `ctx.tools`、`ctx.userQuestions` | `tool/call`、`tool/result after a UI/provider answers the question` | - | ask_user_question 会暂停工具调用，直到当前 UI 提供方返回人类答案。 |
| `@deepseek-ai/dsh-tools` | `run_code` | `ctx.tools`、`ctx.codeRuntime (execution time)`、`ctx.systemPrompt` | `tool/call`、`one tool/ptc-dispatch-start + tool/ptc-dispatch pair per bridged sub-call`、`tool/result` | - | 在 `mode: ptc`／`mode: both` 下，它由工具注册表所有，作为可过滤能力层之外的保留传输机制（参见 PTC mode Agent Note）。在 `ptc` 下，它是注册表对协议格式（wire format）的唯一贡献；其他可见能力在使用已加载运行时语言生成的 SDK 章节中声明。程序通过 binding 调用这些能力，调用按照原生并发约定调度：启动顺序和策略遵循提交顺序，并发安全的函数体最多重叠执行 `maxParallelSubCalls` 个。调用会重新进入完整且受守卫保护的工具流水线，并将每个嵌套执行关联到此外层结果。 |
| `@deepseek-ai/dsh-plan-mode` | `exit_plan_mode` | `ctx.tools`、`ctx.systemPrompt`、`ctx.userQuestions (execution time, opportunistic)` | `tool/call`、`plan/mode inactive on an approved review`、`tool/result` | - | 规划未激活时，exit_plan_mode 仍保留在面向模型的 schema 中，这样状态转换不会在规划策略变更之外额外造成工具目录变动。其执行路径会拒绝规划模式之外的调用；在规划模式下，它通过用户交互 seam 提交计划（批准／根据反馈继续规划），批准后会在步骤边界记录规划模式已停用。 |
| `@deepseek-ai/dsh-tool-bash` | `bash` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | bash 工具是 bash 执行器 seam 面向模型的消费方。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；禁用 `enableRunInBackground` 配置（默认为 true）后，该参数会被完全移除。 |
| `@deepseek-ai/dsh-tool-present` | `present` | `ctx.tools`、`ctx.fs`、`ctx.sessionProjections` | `tool/call`、`deliverables/presented after a successful final result`、`tool/result` | - | 交付物归调用方 Session 所有；Web ui-deliverables 提供源文件打开入口和卡片。 |
| `@deepseek-ai/dsh-tool-pwsh` | `pwsh` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | pwsh 工具是 Windows 组合中 bash 执行器 seam 的 PowerShell 方言消费方（由 `@deepseek-ai/dsh-pwsh-local` 等 PowerShell 执行器为 `ctx.shell` 提供后端）；除沙箱接口外，它逐项对应 bash 工具调用。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具收集／停止；托管的 `DSH_*` 环境来自 `@deepseek-ai/dsh-shell-env`。每次调用都在新进程中运行，不使用持久 PTY 会话。路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`。 |
| `@deepseek-ai/dsh-tool-cordis` | `cordis_define`、`cordis_inspect_list`、`cordis_inspect_query`、`cordis_inspect_self`、`cordis_run`、`cordis_stop`、`cordis_undefine` | `ctx.tools`、`ctx.dynamicCordisRunner` | `tool/call`、`tool/result`、`process-local dynamic package lifecycle` | - | 不在任何随产品发布的树中，需要显式选择启用；动态 Package 代码可以访问真实运行时，见 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。该工具集注入 `@deepseek-ai/dsh-cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，后者拥有定义注册表和 vm 沙箱；组合缺少它时这些工具不会激活。运行中的 Package 在停止、undefine 或 DSH 重启前可以注册**额外的**模型可见工具；发生这类工具集变化时，系统会记录完整且有变动的请求头。 |
| `@deepseek-ai/dsh-tool-bash-persistent` | `bash` | `ctx.tools`、`ctx.terminals`、`an owning Agent at execution time` | `tool/call`、`PTY shell state`、`tool/result` | - | 一个按所有者隔离的持久 bash 工具；部署组合提供 PTY 后端，并可覆盖面向模型的环境描述。 |
| `@deepseek-ai/dsh-tool-pwsh-persistent` | `pwsh` | `ctx.tools`、`ctx.terminals`、`an owning Agent at execution time` | `tool/call`、`PTY shell state`、`tool/result` | - | 一个按所有者隔离的持久 pwsh 工具，持久 bash 工具的 Windows 对应物；部署组合提供 pwsh 方言的 PTY 后端，并可覆盖面向模型的环境描述。 |
| `@deepseek-ai/dsh-tool-str-replace-editor` | `str_replace_editor` | `ctx.tools`、`ctx.fs` | `tool/call`、`fs/observed after view presence/absence, edit absence, or successful mutation`、`tool/result` | - | 基于文件系统 seam 的独立查看／创建／唯一字面量替换／按行插入工具；可与任何 shell 或终端接口组合。 |
| `@deepseek-ai/dsh-tool-fs` | `edit`、`read`、`read_image`、`write` | `ctx.tools`、`ctx.fs`、`ctx.systemPrompt`、`ctx.attachments (image-tool registration)`、`ctx.llm + an image-capable route (image-tool execution)` | `tool/call`、`fs/write-intent or fs/edit-intent for mutations`、`fs/observed after read presence/absence or successful file operation`、`durable attachment (read_image)`、`tool/result` | - | 先读后写／编辑策略由 `@deepseek-ai/dsh-fs-observation-policy` 添加；它是一个 `fs/*` 事件门禁插件，不会改变 schema。加载这些工具的部署按预期也应加载该插件。没有 `ctx.attachments` 时图片工具不会注册；其 schema 与路由无关，执行时除非确切路由的模型声明图片输入，否则拒绝。 |
| `@deepseek-ai/dsh-tool-fs-search` | `glob`、`grep` | `ctx.tools`、`ctx.subprocess`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | glob 和 grep 是无条件可用的发现工具，通过 ctx.subprocess spawn 随包提供的 ripgrep 二进制文件（`@vscode/ripgrep`），并作为普通前台调用运行，绝不作为后台任务；无需在宿主机安装 `rg`，也不经过 shell 层。本目录使用 `sampleOverCapGlobResults: true`；部署必须显式选择该行为。结果超过上限时，会通过可选的 ctx.spillStore 后端保存完整的格式化列表；在共置部署中，如果后端公开本地路径，返回的定位信息可供后续读取／搜索。 |
| `@deepseek-ai/dsh-tool-terminal` | `terminal_close`、`terminal_list`、`terminal_open`、`terminal_read`、`terminal_send`、`terminal_signal` | `ctx.tools`、`ctx.terminals`、`ctx.systemPrompt`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | 这 6 个终端工具需要选择启用，用于补充一次性 bash／文件系统工具。`terminal_send(run_in_background: true)` 会注册到 `ctx.jobs`；schema 不包含 TUI、具名按键序列、BEL、调整尺寸、自动启动和跨 agent 共享。 |
| `@deepseek-ai/dsh-tool-browser` | `browser_back`, `browser_click`, `browser_close`, `browser_downloads`, `browser_forward`, `browser_history`, `browser_home`, `browser_list`, `browser_navigate`, `browser_network`, `browser_open`, `browser_save_download`, `browser_screenshot`, `browser_search`, `browser_snapshot`, `browser_upload` | `ctx.tools`, `ctx.browser`, `ctx.attachments`, `ctx.systemPrompt`, `ctx.llm for screenshot execution`, `ctx.fs for workspace-file upload` | `tool/call`, `durable image attachment from browser_screenshot`, `tool/result` | - | 十六个持久浏览器工具在选定 Browser Provider 中维护页面及观察句柄。截图执行还需要支持图像的模型路由。 |
| `@deepseek-ai/dsh-tool-browser-element-capture` | `browser_capture_element`、`browser_select_element` | `ctx.tools`、`ctx.browser`、`ctx.coordination`、`ctx.systemPrompt`、`an image-capable route for capture execution` | `tool/call`、`durable verified crop attachment through Coordination`、`tool/result` | - | 这两个工具组成选择与捕获工作流。schema 使用默认 60000 ms 超时与 PNG 输出；执行需要带元素捕获功能的 Browser provider 及匹配的 Coordination executor。 |
| `@deepseek-ai/dsh-tool-computer-use` | `computer_accessibility`, `computer_keyboard`, `computer_list_apps`, `computer_list_windows`, `computer_observe`, `computer_pointer` | `ctx.tools`, `ctx.computerUse`, `ctx.attachments`, `ctx.systemPrompt` | `tool/call`, `tool/result`, `optional image attachments` | - | 设备工具按需启用。每次桌面操作使用当前 observation；截图需要支持图像的模型路由和允许截图的 attachment 策略。 |
| `@deepseek-ai/dsh-tool-mobile-device` | `mobile_button`, `mobile_list_devices`, `mobile_observe`, `mobile_touch`, `mobile_type` | `ctx.tools`, `ctx.mobileDevice`, `ctx.attachments`, `ctx.systemPrompt` | `tool/call`, `tool/result`, `optional image attachments` | - | 移动设备工具使用归一化坐标和一次性 observation token。device-control profile 中的设备输入需要明确的策略审批。 |
| `@deepseek-ai/dsh-tool-coordination` | `coordination_add_task`、`coordination_cancel`、`coordination_send_message`、`coordination_start`、`coordination_status`、`coordination_wait` | `ctx.tools`、`ctx.agents`、`ctx.coordination` | `tool/call`、`process-local task graph state and executor messages`、`tool/result` | - | 六个 task-graph 工具归当前 Session 所有。目录使用默认 subagent executor 名称与有界等待默认值；启动 task 需要已注册的 executor。 |
| `@deepseek-ai/dsh-tool-git` | `git_diff`、`git_log`、`git_status` | `ctx.tools`、`ctx.agents`、`ctx.git` | `tool/call`、`tool/result` | - | 目录使用 local provider、显式 executable 与上述有界限制展示三个只读 Git 工具；部署可以选择其他 provider 配置。 |
| `@deepseek-ai/dsh-tool-goal` | `create_goal`、`get_goal`、`update_goal` | `ctx.tools`、`ctx.agents`、`ctx.goals`、`ctx.systemPrompt`、`a calling Agent in an authorized open turn` | `tool/call`、`goal/change for mutations`、`tool/result` | - | create、edit、pause 和 resume 要求直接来自人类的根权限；complete 和 blocked 也接受确切的当前 Goal Round。blocked 的默认下限是 3 个获准的 Round。 |
| `@deepseek-ai/dsh-schedule` | `schedule_create`、`schedule_delete`、`schedule_list` | `ctx.tools`、`ctx.sessions`、Session 持久化、未来创建的 live 根 Agent | `tool/call`、`schedule/change create or delete`、`tool/result` | - | 仅在选择启用的 Schedule 插件加载后创建的 live 根 Agent scope 内注册。版本 1 接受 after_seconds、显式绝对 at 和有界固定速率 every_seconds，并披露 session-local 交付；管理读取与变更必须通过共享的 Session 持久化 barrier。 |
| `@deepseek-ai/dsh-tool-lsp` | `lsp` | `ctx.tools`、`ctx.lsp`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | lsp 工具将提供方选择和语言服务器子进程置于 ctx.lsp 之后，因此其模型可见 schema 在更换提供方时保持稳定。运行时要求已注册提供方，例如 `@deepseek-ai/dsh-lsp-stdio`；如果没有提供方，查询会返回结构化 `LSP_UNAVAILABLE` 错误，而不会改变 schema。 |
| `@deepseek-ai/dsh-tool-ralph` | `ralph` | `ctx.tools`、`ctx.workflowEngine`、`ctx.subagents`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents every fresh round)` | `tool/call`、`tool/result`、`workflow and child session events during execution` | - | 固定的前台工作流会在每个 Round 启动一个全新的结构化子级；模型只能选择不可变目标和可选的 Round 上限。 |
| `@deepseek-ai/dsh-tool-skill` | `skill` | `ctx.tools`、`ctx.agents`、`ctx.skills` | `tool/call`、`tool/result`、`user/message replacement catalogs via agent.inject()` | - | - |
| `@deepseek-ai/dsh-tool-session-query` | `session_event_read`、`session_event_search`、`session_event_trace`、`session_search`、`session_trace` | `ctx.tools`、`ctx.systemPrompt`、`ctx.sessionQuery`、`a calling Agent for workspace authority` | `tool/call`、`tool/result` | - | 这 5 个只读工具会隐藏提供方游标，并根据不可变的调用 agent 会话为每个结果授权。该包需要选择启用；需要强制截止时间或限制行内输出的组合还会挂载通用超时或 spill 策略。 |
| `@deepseek-ai/dsh-tool-subagent` | `list_subagent_models`、`subagent` | `ctx.tools`、`ctx.subagents`、`ctx.systemPrompt`、`用于模型发现和所选路由校验的 ctx.llm` | `tool/call`、`tool/result`、`child session events through the chosen provider` | `subagent`、`subagent_fork` | 注册的委派工具名称取决于加载时 `toolName` 配置（默认为 `subagent`）；上述默认 schema 关闭模型选择，而发现 schema 则展示为已启用 Session 中可用的固定配套工具。Web preset 会在每个新顶层 Session 创建时读取插件页偏好，并为其子 Session 保留该决定；`subagent_fork` 始终使用固定路由。每个实例通过 `modelSelectionSettings`、`backgroundMode` 与 `enableRunInBackground` 独立控制是否读取模型选择设置及其后台行为。 |
| `@deepseek-ai/dsh-tool-subagent-control` | `interrupt_agent`、`list_agents`、`send_message` | `ctx.tools`、`ctx.subagents`、`ctx.agents and ctx.sessionProjections (list_agents only)` | `tool/call`、`tool/result`、`child session events through ctx.subagents` | - | 这些是控制可继续后台 subagent 的全局命名工具：绑定提供方的 `tool-subagent` 实例注册不同的委派工具；本包注册一次 `send_message` 和 `interrupt_agent`，另由 `list_agents` 通过单独加载的 `/list-agents` 插件提供，其目录行使用 sessionProjections 和实时 Agent 注册表。 |
| `@deepseek-ai/dsh-tool-jobs` | `job_kill`、`job_list`、`job_output` | `ctx.tools`、`ctx.jobs`、`ctx.systemPrompt` | `tool/call`、`tool/result`、`user/message via agent.inject() for background completion notices` | - | 与任务种类无关的后台任务控制器：后台 bash 命令、PTY 发送和 subagent 都通过相同的 3 个工具读取、列出和终止。加载该插件会挂接控制器，从而启用生产方的 `ctx.jobs.start()`。 |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | `interrupt_agent`、`list_agents`、`send_message`、`spawn_teammate`、`team_task_create`、`team_task_get`、`team_task_list`、`team_task_update`、`wait_agent` | `ctx.tools`、`ctx.systemPrompt`、`ctx.agentTeams`、`an exact live Team member Agent` | `tool/call`、`team/member`、`team/message/queued`、`team/message/delivered`、`team/task`、`tool/result` | - | 这 9 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 dsh-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。 |
| `@deepseek-ai/dsh-tool-todo` | `todo_write` | `ctx.tools`、`owning Agent session` | `tool/call`、`todo/write`、`tool/result` | - | todo_write 是会话所有的状态；UI 将最新的 todo/write 事件渲染为检查清单。`allowParallelInProgress` 是没有默认值的必填项，因此本目录明确选择 `true`，对应描述允许同时存在多个 `in_progress` 项。选择 `false` 的部署会获得同一工具，但描述会要求只能有 1 个活动任务。 |
| `@deepseek-ai/dsh-tool-workflow` | `workflow` | `ctx.tools`、`ctx.workflowEngine`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents the script children)` | `tool/call`、`tool/result` | - | - |
| `@deepseek-ai/dsh-tool-finding` | `finding_export`、`finding_query`、`finding_record`、`finding_transition` | `ctx.tools`、`ctx.findings`、`ctx.artifacts`、`ctx.executionHost`、当前会话权限所需的调用 Agent | `tool/call`、`finding/change`、报告 Artifact、`tool/result` | - | 四个 finding 工具使用当前 Session 和 Artifact 提供方；报告 provenance 绑定当前 execution host，reproduction 和 remediation 状态转换要求类型化证据。 |
| `@deepseek-ai/dsh-tool-vuln-kb` | `vuln_query`、`vuln_read` | `ctx.tools`、`ctx.vulnKb`、执行时配置的漏洞知识库提供方 | `tool/call`、`tool/result` | - | vuln_query 和 vuln_read 暴露提供方结果，不判断可利用性，也不授予评估权限；目录启动使用 NVD+OSV 适配器且不会发起网络请求。 |
| `@deepseek-ai/dsh-tool-work-items` | `work_items_cancel_write`, `work_items_confirm_write`, `work_items_get`, `work_items_list`, `work_items_list_writes`, `work_items_prepare_write` | `ctx.tools`, `ctx.workItems`, `ctx.systemPrompt`, `ctx.storageDomain 用于写入预览和回执` | `tool/call`, `持久化写入预览和回执`, `tool/result` | - | Provider 写入默认关闭。启用后仍需持久化预览和独立确认；不确定结果绝不自动重发。 |
| `@deepseek-ai/dsh-tool-web` | `web_fetch`、`web_search` | `ctx.tools`、`ctx.web`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | web_search 和 web_fetch 将提供方选择置于 ctx.web 之后，使模型可见 schema 在更换后端时保持稳定。 |

<a id="deepseek-aidsh-mcp-resources"></a>

## `@deepseek-ai/dsh-mcp-resources`

### `list_mcp_resource_templates`

列出 MCP 服务器的一页参数化资源 URI 模板。将返回的 nextCursor 作为 cursor 传入，以继续获取下一页。

```json
{
  "type": "object",
  "properties": {
    "server": {
      "type": "string",
      "description": "Configured MCP server name."
    },
    "cursor": {
      "type": "string",
      "description": "Continuation cursor returned by this server."
    }
  },
  "required": [
    "server"
  ]
}
```

来源：[`packages/mcp/mcp-resources/src/tools.ts`](../packages/mcp/mcp-resources/src/tools.ts)

### `list_mcp_resources`

列出 MCP 服务器的一页可用资源。将返回的 nextCursor 作为 cursor 传入，以继续获取下一页。

```json
{
  "type": "object",
  "properties": {
    "server": {
      "type": "string",
      "description": "Configured MCP server name."
    },
    "cursor": {
      "type": "string",
      "description": "Continuation cursor returned by this server."
    }
  },
  "required": [
    "server"
  ]
}
```

来源：[`packages/mcp/mcp-resources/src/tools.ts`](../packages/mcp/mcp-resources/src/tools.ts)

### `read_mcp_resource`

按 URI 从指定服务器读取 MCP 资源。使用列表返回的 URI 或展开后的资源模板。

```json
{
  "type": "object",
  "properties": {
    "server": {
      "type": "string",
      "description": "Configured MCP server name."
    },
    "uri": {
      "type": "string",
      "description": "Resource URI to read."
    }
  },
  "required": [
    "server",
    "uri"
  ]
}
```

来源：[`packages/mcp/mcp-resources/src/tools.ts`](../packages/mcp/mcp-resources/src/tools.ts)

<a id="deepseek-aidsh-tool-ask-user"></a>

## `@deepseek-ai/dsh-tool-ask-user`

### `ask_user_question`

继续操作前，如果需要确认、选择或缺失的信息，请向用户提出简明问题。发送一个或多个问题，每个问题都带一个稳定 id，该 id 会在答案中原样返回。

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "description": "Questions to ask the user before continuing.",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string",
            "description": "Stable id for this question; echoed in the answer."
          },
          "question": {
            "type": "string",
            "description": "The specific question to ask the user."
          },
          "header": {
            "type": "string",
            "description": "Optional short heading for the question, such as \"Confirm\" or \"Choose Mode\"."
          },
          "options": {
            "type": "array",
            "description": "Optional choices to show the user. If you recommend one, put it first and append \"(Recommended)\" to that label.",
            "items": {
              "type": "object",
              "additionalProperties": true,
              "properties": {
                "label": {
                  "type": "string",
                  "description": "Short user-facing option label."
                },
                "description": {
                  "type": "string",
                  "description": "One sentence explaining the tradeoff or impact."
                }
              },
              "required": [
                "label"
              ]
            }
          },
          "multi_select": {
            "type": "boolean",
            "description": "Whether the user may select more than one option. Defaults to false."
          }
        },
        "required": [
          "id",
          "question"
        ]
      }
    }
  },
  "required": [
    "questions"
  ]
}
```

来源：[`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)

ask_user_question 会暂停工具调用，直到当前 UI 提供方返回人类答案。

<a id="deepseek-aidsh-tools"></a>

## `@deepseek-ai/dsh-tools`

### `run_code`

针对可用工具执行 TypeScript 程序。接受两个必填参数：`code`，即异步函数的**函数体**（仅使用可擦除语法；支持顶层 `await` 和 `return`）；以及 `description`，简要说明该程序做什么。请根据系统提示词中的声明，以 `await tools.name(args)` 形式调用工具。只有打印或返回的内容属于程序输出，请谨慎筛选。含图片的子工具结果会在运行结束后附加。

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "The program: the body of an async TypeScript function."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\"."
    }
  },
  "required": [
    "code",
    "description"
  ]
}
```

来源：[`packages/core/tools/src/ptc.ts`](../packages/core/tools/src/ptc.ts)

在 `mode: ptc`／`mode: both` 下，它由工具注册表所有，作为可过滤能力层之外的保留传输机制（参见 PTC mode Agent Note）。在 `ptc` 下，它是注册表对协议格式的唯一贡献；其他可见能力在使用已加载运行时语言生成的 SDK 章节中声明。程序通过 binding 调用这些能力，调用按照原生并发约定调度：启动顺序和策略遵循提交顺序，并发安全的函数体最多重叠执行 `maxParallelSubCalls` 个。调用会重新进入完整且受守卫保护的工具流水线，并将每个嵌套执行关联到此外层结果。

<a id="deepseek-aidsh-plan-mode"></a>

## `@deepseek-ai/dsh-plan-mode`

### `exit_plan_mode`

仅在规划模式下使用。提交计划供用户评审，并在获批后退出规划模式。发送**完整的** Markdown 计划，以一个为计划命名的 # 标题开头。用户可以批准（从你的下一步骤起执行计划），也可以要求继续规划；其反馈会通过工具结果返回，请修改后再次提交。

```json
{
  "type": "object",
  "properties": {
    "plan": {
      "type": "string",
      "description": "The complete plan, as markdown, starting with a # heading that names it."
    }
  },
  "required": [
    "plan"
  ]
}
```

来源：[`packages/plan/plan-mode/src/index.ts`](../packages/plan/plan-mode/src/index.ts)

规划未激活时，exit_plan_mode 仍保留在面向模型的 schema 中，这样状态转换不会在规划策略变更之外额外造成工具目录变动。其执行路径会拒绝规划模式之外的调用；在规划模式下，它通过用户交互 seam 提交计划（批准／根据反馈继续规划），批准后会在步骤边界记录规划模式已停用。

<a id="deepseek-aidsh-tool-bash"></a>

## `@deepseek-ai/dsh-tool-bash`

### `bash`

执行 bash 命令（`bash -c`）并返回 stdout/stderr。每次调用都在新 shell 中运行：调用之间不保留任何状态（cwd、变量、函数），请传入 `workdir`，不要使用 `cd`。非零退出会报告为 `[exit code: N]`。当前 harness 环境信息通过托管的 `$DSH_*` 变量公开，需要时请检查这些变量。命令可能在文件沙箱中运行；被阻止的文件操作报告为 `[sandbox: file access denied under <mode> mode]`，这是策略拒绝，而不是命令缺陷，请勿换一种方式重试。较长的输出会截断，只保留尾部；如可用，完整输出会保存到文件并报告其路径。对于长时间运行的命令，请设置 `run_in_background: true`：调用会立即返回 job id；使用 `job_output` 读取输出，使用 `job_kill` 停止任务。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"npm install\" → \"Install package dependencies\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

来源：[`packages/shell/tool-bash/src/index.ts`](../packages/shell/tool-bash/src/index.ts)

bash 工具是 bash 执行器 seam 面向模型的消费方。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；禁用 `enableRunInBackground` 配置（默认为 true）后，该参数会被完全移除。

<a id="deepseek-aidsh-tool-present"></a>

## `@deepseek-ai/dsh-tool-present`

### `present`

将已存在且可通过 Session 文件系统访问的文件声明为最终交付物。当你创建或更新的文件是用户要求接收的输出时，必须在写入后、最终回复前调用 present，包括通过 Bash 或代码执行创建的文件。在回复中提及路径不能代替此调用。文件必须已经存在。用户打开的是当前源文件；其内容不会被复制或保留。

```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "path": {
            "type": "string",
            "description": "Path of an existing regular file. Relative paths use the Session working directory."
          },
          "description": {
            "type": "string",
            "description": "Brief description for the user."
          }
        },
        "required": [
          "path"
        ]
      }
    }
  },
  "required": [
    "files"
  ]
}
```

来源：[`packages/deliverables/tool-present/src/index.ts`](../packages/deliverables/tool-present/src/index.ts)

交付物归调用方 Session 所有；Web ui-deliverables 提供源文件打开入口和卡片。

<a id="deepseek-aidsh-tool-pwsh"></a>

## `@deepseek-ai/dsh-tool-pwsh`

### `pwsh`

执行 PowerShell 命令（`pwsh -Command`）并返回 stdout/stderr。每次调用都在新的 pwsh 进程中运行：调用之间不保留任何状态（cwd、变量、函数），请传入 `workdir`，不要使用 `cd`。路径采用 Windows 原生形式（`C:\...`）；使用 `$env:NAME` 读取环境变量。非零退出会报告为 `[exit code: N]`。当前 harness 环境信息通过托管的 `$env:DSH_*` 变量公开，需要时请检查这些变量。命令可能在文件沙箱中运行；被阻止的文件操作报告为 `[sandbox: file access denied under <mode> mode]`，这是策略拒绝，而不是命令缺陷，请勿换一种方式重试。较长的输出会截断，只保留尾部；如可用，完整输出会保存到文件并报告其路径。在 Windows 上，被强制终止的命令会以 `[exit code: 1]` 结算且不带信号标记，请将其视为中断，而不是命令失败。对于长时间运行的命令，请设置 `run_in_background: true`：调用会立即返回 job id；使用 `job_output` 读取输出，使用 `job_kill` 停止任务。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"Get-Process\" → \"List running processes\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

来源：[`packages/shell/tool-pwsh/src/index.ts`](../packages/shell/tool-pwsh/src/index.ts)

pwsh 工具是 Windows 组合中 bash 执行器 seam 的 PowerShell 方言消费方（由 `@deepseek-ai/dsh-pwsh-local` 等 PowerShell 执行器为 `ctx.shell` 提供后端）；除沙箱接口外，它逐项对应 bash 工具调用。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具收集／停止；托管的 `DSH_*` 环境来自 `@deepseek-ai/dsh-shell-env`。每次调用都在新进程中运行，不使用持久 PTY 会话。路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`。

<a id="deepseek-aidsh-tool-cordis"></a>

## `@deepseek-ai/dsh-tool-cordis`

### `cordis_define`

定义一个不可变的 Cordis Package。新建 Plugin 时使用 kind:"new"，只提供 3 至 6 位小写英文字母组成的语义前缀；Host 返回最终 pluginId 和 packageId。修改现有 Plugin 时使用 kind:"existing" 并传入精确 pluginId，以追加 Package 而不覆盖旧版本。code.host 与 code.client 至少提供一个；每个值都是返回 Cordis Plugin 的 plain JavaScript 函数体，不经过 TypeScript、JSX 或 import 转换。依赖 Service、Event、Builtin、Slot 或 token 前先查询 Inspect。Define 只校验参数和语法并记录源码，不申请审批、不执行 apply，也不改变 currentPackageId。成功后用返回的 ID 调用 cordis_run。

```json
{
  "type": "object",
  "properties": {
    "plugin": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "new"
            },
            "idPrefix": {
              "type": "string",
              "description": "Suggested semantic prefix of 3–6 lowercase English letters; the Host adds a unique numeric suffix."
            }
          },
          "required": [
            "kind",
            "idPrefix"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "existing"
            },
            "pluginId": {
              "type": "string",
              "description": "Exact ID of an existing Plugin; the new Package is appended to that instance."
            }
          },
          "required": [
            "kind",
            "pluginId"
          ]
        }
      ]
    },
    "name": {
      "type": "string",
      "description": "Short, readable Package name."
    },
    "purpose": {
      "type": "string",
      "description": "One-sentence, user-facing description of the Package purpose."
    },
    "code": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "host": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the Host-half Cordis Plugin."
        },
        "client": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the browser Client-half Cordis Plugin."
        }
      }
    }
  },
  "required": [
    "plugin",
    "name",
    "purpose",
    "code"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_list`

列出 Host 当前已知的全部 Cordis Inspect Provider，包括本地 Host Provider 和 Client 最近同步的 manifest。每项包含所属平台、用途、只读方法及输入／输出 schema。创建或修改 Package 前先调用本 Tool，再从结果中选择 cordis_inspect_query 的 provider 和 method。不要猜测名称，也不要把 Inspect method 当作 Plugin 代码可调用的业务 Service。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_query`

执行 Inspect Provider 显式声明的只读查询。platform、provider 和 method 必须来自 cordis_inspect_list，input 必须符合该方法的 schema。在 cordis_define 前用本 Tool 读取精确 Service 方法、Event mode、Builtin 签名、Tool schema、主题 token，或实时 Slot 树及 props。Host 查询在本地执行；Client 查询等待首个有效页面响应，在页面回答或 Tool 被取消前保持 pending。本 Tool 不能调用业务 Service 方法或修改运行时。查询 Service.listService 和 Event.listEvents 时，先不传 input 浏览紧凑签名目录，再查询精确 service 或 event 获取结构化约定和引用类型。查询 Slots.listSubTree 时，先不传 root 浏览紧凑树，再查询精确 root 获取完整注册约定和 props。

```json
{
  "type": "object",
  "properties": {
    "platform": {
      "type": "string",
      "description": "Runtime platform that owns the Provider.",
      "enum": [
        "host",
        "client"
      ]
    },
    "provider": {
      "type": "string",
      "description": "Exact Provider ID returned by cordis_inspect_list."
    },
    "method": {
      "type": "string",
      "description": "Exact method name declared by the Provider manifest."
    },
    "input": {
      "description": "Optional query input; it must satisfy the method input schema."
    }
  },
  "required": [
    "platform",
    "provider",
    "method"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_self`

按逐层增加的详细程度检查当前 Session 拥有的动态 Cordis 对象。不传 ID 时只列 Plugin 摘要；只传 pluginId 时返回版本指针、最新 Run 和全部 Package 摘要；只有同时传 pluginId 与 packageId 才返回该不可变 Package 的 Host/Client 源码和运行诊断。packageId 不能单独传入。处理 @pluginId、修复异步失败或定义更新版本前，先查询精确 Package。本 Tool 只读，不执行代码，也不改变版本指针。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define or injected by @pluginId; omit it to list every current Plugin."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID owned by pluginId; when specified, source and diagnostics are returned."
    }
  }
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_run`

激活动态 Plugin 的一个精确 Package。首次激活、重启 currentPackageId 或回退使用 mode:"run"；已有 current 时，即使 Plugin 当前已停止，切换到其他 Package 也使用 mode:"update"。未授权的 Client Package 创建审批请求并返回 awaiting-approval；已授权的 Package 返回 starting，并在浏览器中异步继续。两种结果都不会在 Tool 内等待最终结局。currentPackageId 只在完整成功后改变；失败时保留旧 current 和目标 next。异步成功、拒绝或技术失败通过状态与 steering 报告。技术失败后，用 cordis_inspect_self 读取诊断，修正同一 Plugin 并自主重试。用户拒绝后不要再次申请审批。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID to activate under that Plugin."
    },
    "mode": {
      "type": "string",
      "description": "Use run for the first activation, restarting current, or rollback; use update to switch from current to a different Package.",
      "enum": [
        "run",
        "update"
      ]
    }
  },
  "required": [
    "pluginId",
    "packageId",
    "mode"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_stop`

停止动态 Plugin 的当前 Run，并取消尚未完成的审批或激活请求。保留 Plugin、全部不可变 Package、授权、currentPackageId 和 nextPackageId，以便之后直接运行或更新。停止已处于停止状态的 Plugin 会幂等成功。临时禁用副作用使用本 Tool；永久移除使用 cordis_undefine。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to stop."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_undefine`

永久移除当前 Session 拥有的动态 Plugin。如果它正在运行或等待审批，先停止并取消请求，再删除全部 Package、授权和版本指针。返回后，其 pluginId、packageIds、@ 引用和 Package 业务视图均失效；历史卡片只保留“Plugin 已移除”记录。需要保留版本以便重启或回退时不要调用本 Tool，应改用 cordis_stop。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to remove permanently."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

不在任何随产品发布的树中，需要显式选择启用；动态 Package 代码可以访问真实运行时，见 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。该工具集注入 `@deepseek-ai/dsh-cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，后者拥有定义注册表和 vm 沙箱；组合缺少它时这些工具不会激活。运行中的 Package 在停止、undefine 或 DSH 重启前可以注册**额外的**模型可见工具；发生这类工具集变化时，系统会记录完整且有变动的请求头。

<a id="deepseek-aidsh-tool-bash-persistent"></a>

## `@deepseek-ai/dsh-tool-bash-persistent`

### `bash`

在持久 bash shell 中运行命令。包括当前目录和已导出环境变量在内的状态会在此 agent 的多次调用之间保留。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

来源：[`packages/shell/tool-bash-persistent/src/index.ts`](../packages/shell/tool-bash-persistent/src/index.ts)

一个按所有者隔离的持久 bash 工具；部署组合提供 PTY 后端，并可覆盖面向模型的环境描述。

<a id="deepseek-aidsh-tool-pwsh-persistent"></a>

## `@deepseek-ai/dsh-tool-pwsh-persistent`

### `pwsh`

在持久 PowerShell shell 中运行命令。包括当前目录和已导出环境变量在内的状态会在此 agent 的多次调用之间保留。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

来源：[`packages/shell/tool-pwsh-persistent/src/index.ts`](../packages/shell/tool-pwsh-persistent/src/index.ts)

一个按所有者隔离的持久 pwsh 工具，持久 bash 工具的 Windows 对应物；部署组合提供 pwsh 方言的 PTY 后端，并可覆盖面向模型的环境描述。

<a id="deepseek-aidsh-tool-str-replace-editor"></a>

## `@deepseek-ai/dsh-tool-str-replace-editor`

### `str_replace_editor`

用于查看、创建和编辑文件的自定义编辑工具：

* 状态会在命令调用以及与用户的讨论之间持久保留
* 如果 `path` 是文件，`view` 会显示应用 `cat -n` 后的结果。如果 `path` 是目录，`view` 会列出最多向下 2 层的非隐藏文件和目录
* 如果指定的 `create` 命令目标 `path` 已作为文件存在，则不能使用该命令
* 如果 `command` 产生较长输出，输出会被截断并标记为 `<response clipped>`
* 当前命令不使用某个参数时，值为 `null` 的占位参数视为未提供。必填参数仍须提供值；删除匹配内容时应省略 `str_replace.new_str`，而不是将其设为 `null`

使用 `str_replace` 命令时请注意：

* `old_str` 参数应与原文件中一行或多行连续内容**完全**匹配。请留意空白字符！
* 如果 `old_str` 参数在文件中不唯一，则不会执行替换。请确保在 `old_str` 中包含足够的上下文，使其唯一
* `new_str` 参数应包含用于替换 `old_str` 的已编辑行

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
      "enum": [
        "view",
        "create",
        "str_replace",
        "insert"
      ]
    },
    "path": {
      "type": "string",
      "description": "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`."
    },
    "file_text": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required string parameter of `create` command, with the content of the file to be created. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "insert_line": {
      "oneOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required integer parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "new_str": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Optional string parameter of `str_replace` command containing the new string (if omitted, no string will be added). Required string parameter of `insert` command containing the string to insert. A null placeholder is accepted only by commands that do not use this parameter."
    },
    "old_str": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required string parameter of `str_replace` command containing the string in `path` to replace. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "view_range": {
      "oneOf": [
        {
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        {
          "type": "null"
        }
      ],
      "description": "Optional parameter of `view` command when `path` points to a file. If omitted or null, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file."
    }
  },
  "required": [
    "command",
    "path"
  ]
}
```

来源：[`packages/fs/tool-str-replace-editor/src/index.ts`](../packages/fs/tool-str-replace-editor/src/index.ts)

基于文件系统 seam 的独立查看／创建／唯一字面量替换／按行插入工具；可与任何 shell 或终端接口组合。

<a id="deepseek-aidsh-tool-fs"></a>

## `@deepseek-ai/dsh-tool-fs`

### `edit`

通过替换字面量文本来编辑现有 UTF-8 文本文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to edit, resolved by the filesystem backend."
    },
    "old_string": {
      "type": "string",
      "description": "Literal text to replace. Must match exactly."
    },
    "new_string": {
      "type": "string",
      "description": "Literal replacement text. Use an empty string to delete the match."
    },
    "replace_all": {
      "type": "boolean",
      "description": "Replace all matches. Defaults to false; when false, old_string must appear exactly once."
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read`

读取 UTF-8 文本文件，并返回带行号的内容。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to read, resolved by the filesystem backend."
    },
    "offset": {
      "type": "number",
      "description": "1-based first line to return. Defaults to 1."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of lines to return. Defaults to 2000."
    }
  },
  "required": [
    "file_path"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read_image`

读取 PNG/JPEG/WebP/GIF 文件并返回图像本身。无扩展名的路径同样被接受；格式按文件内容检测，因此规范化附件路径可以直接传入，无需复制或重命名。Harness 会在下一次模型请求前校验并缩小受支持的大图，因此仅为查看图片时应直接使用此工具，无需安装图片库或创建缩略图。可以用小批次并发读取彼此独立的文件。要求当前模型接受图像输入。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to the image file, resolved by the filesystem backend."
    }
  },
  "required": [
    "file_path"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `write`

创建或完全替换 UTF-8 文本文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to write, resolved by the filesystem backend."
    },
    "content": {
      "type": "string",
      "description": "Full UTF-8 text content to write."
    }
  },
  "required": [
    "file_path",
    "content"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

先读后写／编辑策略由 `@deepseek-ai/dsh-fs-observation-policy` 添加；它是一个 `fs/*` 事件门禁插件，不会改变 schema。加载这些工具的部署按预期也应加载该插件。没有 `ctx.attachments` 时图片工具不会注册；其 schema 与路由无关，执行时除非确切路由的模型声明图片输入，否则拒绝。

<a id="deepseek-aidsh-tool-fs-search"></a>

## `@deepseek-ai/dsh-tool-fs-search`

### `glob`

查找路径匹配 glob 模式的文件。只返回匹配的文件路径，绝不返回目录；包括隐藏文件和被忽略的文件，但排除 VCS 元数据目录。最多按修改时间顺序返回 100 条路径；如果结果更多，则改为返回从顶层条目中抽样的 100 条路径，说明已抽样，并报告完整排序列表的保存位置。该工具不枚举目录条目。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Glob pattern to match file paths against (e.g. \"**/*.ts\", \"src/**/*.test.js\"). A pattern with no \"/\" matches the basename at any depth, so \"*\" and \"*.ts\" both search the whole tree; include a separator to anchor the depth."
    },
    "path": {
      "type": "string",
      "description": "Directory to search in. Defaults to the session workspace; a relative path resolves against it."
    }
  },
  "required": [
    "pattern"
  ]
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

### `grep`

使用 ripgrep 正则表达式搜索文件内容。返回带行号的匹配行，并按文件分组。前 250 条匹配会直接返回；结果达到上限时会报告完整匹配列表的保存位置。如需周边上下文，请对匹配的文件使用 read。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Regular expression to search for (ripgrep syntax)."
    },
    "path": {
      "type": "string",
      "description": "File or directory to search. Defaults to the session workspace; a relative path resolves against it."
    },
    "include": {
      "type": "string",
      "description": "One glob filter for which files to search (e.g. \"*.ts\", \"*.{js,jsx}\"). Not a list; negation is not supported."
    }
  },
  "required": [
    "pattern"
  ]
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

glob 和 grep 是无条件可用的发现工具，通过 ctx.subprocess spawn 随包提供的 ripgrep 二进制文件（`@vscode/ripgrep`），并作为普通前台调用运行，绝不作为后台任务；无需在宿主机安装 `rg`，也不经过 shell 层。本目录使用 `sampleOverCapGlobResults: true`；部署必须显式选择该行为。结果超过上限时，会通过可选的 ctx.spillStore 后端保存完整的格式化列表；在共置部署中，如果后端公开本地路径，返回的定位信息可供后续读取／搜索。

<a id="deepseek-aidsh-tool-terminal"></a>

## `@deepseek-ai/dsh-tool-terminal`

### `terminal_close`

关闭一个持久终端，并等待其捕获且所有的进程树完全退出。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_list`

列出当前 agent 所有的持久终端会话。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_open`

通过已注册的后端类型创建按所有者隔离的持久终端会话。需要在多次工具调用之间保留 shell 或 REPL 状态时，请使用此工具。

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "Registered terminal backend type, usually \"shell\"."
    },
    "name": {
      "type": "string",
      "description": "Optional owner-local display name such as \"main\" or \"gdb\"."
    },
    "cwd": {
      "type": "string",
      "description": "Initial working directory. Defaults to the deployment workspace root."
    }
  },
  "required": [
    "type"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_read`

从持久终端读取一页有界的保留输出，不发送输入。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "offset": {
      "type": "number",
      "description": "Newest-relative line offset (default 0)."
    },
    "count": {
      "type": "number",
      "description": "Requested line count (default 500; backend caps apply)."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_send`

向持久终端发送文本。默认会提交 Enter，并等待提示符、stdin 等待、输出静默、超时或会话退出。后台模式会返回供 job_output／job_kill 使用的 job id。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id returned by terminal_open or terminal_list."
    },
    "text": {
      "type": "string",
      "description": "UTF-8 text to write to the terminal."
    },
    "submit": {
      "type": "boolean",
      "description": "Submit Enter after text (default true). Set false for control characters or incomplete REPL input."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Return a job id immediately; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "sessionId",
    "text"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_signal`

向持久终端当前的前台进程组发送允许的信号。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "signal": {
      "type": "string",
      "description": "Signal to deliver. Shell-targeted SIGKILL is rejected; use terminal_close.",
      "enum": [
        "SIGINT",
        "SIGTERM",
        "SIGKILL",
        "SIGTSTP",
        "SIGHUP"
      ]
    }
  },
  "required": [
    "sessionId",
    "signal"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

这 6 个终端工具需要选择启用，用于补充一次性 bash／文件系统工具。`terminal_send(run_in_background: true)` 会注册到 `ctx.jobs`；schema 不包含 TUI、具名按键序列、BEL、调整尺寸、自动启动和跨 agent 共享。

<a id="deepseek-aidsh-tool-browser"></a>

## `@deepseek-ai/dsh-tool-browser`

### `browser_back`

将一个持久浏览器页面后退一步。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_click`

点击最新 browser_snapshot 观察中的元素。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    },
    "observation_id": {
      "type": "string",
      "description": "Observation id returned by the latest browser_snapshot for this page."
    },
    "element_id": {
      "type": "string",
      "description": "Element id from that exact browser_snapshot observation."
    }
  },
  "required": [
    "page_id",
    "observation_id",
    "element_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_close`

关闭一个持久浏览器页面。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_downloads`

列出属于一个打开页面的已捕获下载。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_forward`

将一个持久浏览器页面前进一步。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_history`

读取一个持久页面的有界访问记录。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum entries from 1 through 100."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_home`

在新的持久页面中打开配置的 Browser 主页。

```json
{
  "type": "object",
  "properties": {}
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_list`

列出持久浏览器页面及其稳定页面 id。

```json
{
  "type": "object",
  "properties": {}
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_navigate`

将一个持久页面导航到 HTTP 或 HTTPS URL。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    },
    "url": {
      "type": "string",
      "description": "Absolute HTTP or HTTPS destination URL."
    }
  },
  "required": [
    "page_id",
    "url"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_network`

读取一个持久页面捕获的有界网络请求元数据。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum entries from 1 through 100."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_open`

在新的持久浏览器页面中打开 HTTP 或 HTTPS URL。

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "Absolute HTTP or HTTPS URL to open."
    }
  },
  "required": [
    "url"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_save_download`

将一个已完成的浏览器下载持久化为文件附件；只返回元数据，不返回文件内容。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    },
    "download_id": {
      "type": "string",
      "description": "Download id returned by browser_downloads."
    }
  },
  "required": [
    "page_id",
    "download_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_screenshot`

捕获当前浏览器视口并以图像返回。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_search`

在新持久页面中使用配置的 Browser 搜索引擎搜索。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search text."
    }
  },
  "required": [
    "query"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_snapshot`

读取持久页面的无障碍树和新鲜元素 id。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

### `browser_upload`

将工作区文件设置到浏览器文件输入框。页面 input/change 事件可能上传数据。需要新鲜 browser_snapshot。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    },
    "observation_id": {
      "type": "string",
      "description": "Latest page observation."
    },
    "element_id": {
      "type": "string",
      "description": "File input element from that observation."
    },
    "file_path": {
      "type": "string",
      "description": "File inside the calling Session workspace."
    }
  },
  "required": [
    "page_id",
    "observation_id",
    "element_id",
    "file_path"
  ]
}
```

来源： [`packages/browser/tool-browser/src/index.ts`](../packages/browser/tool-browser/src/index.ts)

十六个持久浏览器工具在选定 Browser Provider 中维护页面及观察句柄。截图执行还需要支持图像的模型路由。

<a id="deepseek-aidsh-tool-browser-element-capture"></a>

## `@deepseek-ai/dsh-tool-browser-element-capture`

### `browser_capture_element`

使用 `browser_snapshot` id 或 `browser_select_element` selection id 捕获经过验证的裁剪图像。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent browser page id."
    },
    "observation_id": {
      "type": "string",
      "description": "Exact observation_id returned by browser_snapshot; use with element_id."
    },
    "element_id": {
      "type": "string",
      "description": "Element id from the same browser_snapshot observation."
    },
    "selection_id": {
      "type": "string",
      "description": "Temporary selection id returned by browser_select_element."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser-element-capture/src/index.ts`](../packages/browser/tool-browser-element-capture/src/index.ts)

### `browser_select_element`

在持久浏览器页面上显示临时 hover highlight，并等待用户选择一个元素。

```json
{
  "type": "object",
  "properties": {
    "page_id": {
      "type": "string",
      "description": "Persistent page id returned by browser_list or browser_open."
    }
  },
  "required": [
    "page_id"
  ]
}
```

来源： [`packages/browser/tool-browser-element-capture/src/index.ts`](../packages/browser/tool-browser-element-capture/src/index.ts)

这两个工具组成选择与捕获工作流。schema 使用默认 60000 ms 超时与 PNG 输出；执行需要带元素捕获功能的 Browser provider 及匹配的 Coordination executor。

<a id="deepseek-aidsh-tool-computer-use"></a>

## `@deepseek-ai/dsh-tool-computer-use`

### `computer_accessibility`

Perform a secondary accessibility action or set one element value using an exact observation.

```json
{
  "type": "object",
  "properties": {
    "app_id": {
      "type": "string",
      "description": "Application id returned by computer_list_apps."
    },
    "window_id": {
      "type": "string",
      "description": "Window id returned by computer_list_windows or computer_observe."
    },
    "observation_id": {
      "type": "string",
      "description": "Exact observation id returned by the latest computer_observe or action for this window."
    },
    "restore_window": {
      "type": "boolean",
      "description": "Bring the exact target window forward before acting."
    },
    "action": {
      "type": "string",
      "enum": [
        "secondary_action",
        "set_value"
      ]
    },
    "element_id": {
      "type": "string"
    },
    "action_name": {
      "type": "string",
      "description": "Provider-advertised action name for secondary_action."
    },
    "value": {
      "type": "string",
      "description": "Exact value for set_value."
    }
  },
  "required": [
    "app_id",
    "window_id",
    "observation_id",
    "action",
    "element_id"
  ]
}
```

来源：[`packages/computer-use/tool-computer-use/src/index.ts`](../packages/computer-use/tool-computer-use/src/index.ts)

### `computer_keyboard`

Type, paste, press one key, or press one hotkey using one exact desktop observation.

```json
{
  "type": "object",
  "properties": {
    "app_id": {
      "type": "string",
      "description": "Application id returned by computer_list_apps."
    },
    "window_id": {
      "type": "string",
      "description": "Window id returned by computer_list_windows or computer_observe."
    },
    "observation_id": {
      "type": "string",
      "description": "Exact observation id returned by the latest computer_observe or action for this window."
    },
    "restore_window": {
      "type": "boolean",
      "description": "Bring the exact target window forward before acting."
    },
    "action": {
      "type": "string",
      "enum": [
        "type_text",
        "paste_text",
        "press_key",
        "hotkey"
      ]
    },
    "text": {
      "type": "string",
      "description": "Literal text for type_text or paste_text."
    },
    "key": {
      "type": "string",
      "description": "Single key or modifier chord for press_key or hotkey."
    }
  },
  "required": [
    "app_id",
    "window_id",
    "observation_id",
    "action"
  ]
}
```

来源：[`packages/computer-use/tool-computer-use/src/index.ts`](../packages/computer-use/tool-computer-use/src/index.ts)

### `computer_list_apps`

List local desktop applications available to Computer Use.

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/computer-use/tool-computer-use/src/index.ts`](../packages/computer-use/tool-computer-use/src/index.ts)

### `computer_list_windows`

List current windows for one desktop application.

```json
{
  "type": "object",
  "properties": {
    "app_id": {
      "type": "string",
      "description": "Application id returned by computer_list_apps."
    }
  },
  "required": [
    "app_id"
  ]
}
```

来源：[`packages/computer-use/tool-computer-use/src/index.ts`](../packages/computer-use/tool-computer-use/src/index.ts)

### `computer_observe`

Read one desktop application accessibility tree and fresh element ids.

```json
{
  "type": "object",
  "properties": {
    "app_id": {
      "type": "string",
      "description": "Application id returned by computer_list_apps."
    },
    "window_id": {
      "type": "string",
      "description": "Optional window id; omit only when the application has one unambiguous window."
    },
    "restore_window": {
      "type": "boolean",
      "description": "Bring the target window forward before observing it."
    }
  },
  "required": [
    "app_id"
  ]
}
```

来源：[`packages/computer-use/tool-computer-use/src/index.ts`](../packages/computer-use/tool-computer-use/src/index.ts)

### `computer_pointer`

Click, scroll, or drag using one exact desktop observation.

```json
{
  "type": "object",
  "properties": {
    "app_id": {
      "type": "string",
      "description": "Application id returned by computer_list_apps."
    },
    "window_id": {
      "type": "string",
      "description": "Window id returned by computer_list_windows or computer_observe."
    },
    "observation_id": {
      "type": "string",
      "description": "Exact observation id returned by the latest computer_observe or action for this window."
    },
    "restore_window": {
      "type": "boolean",
      "description": "Bring the exact target window forward before acting."
    },
    "action": {
      "type": "string",
      "enum": [
        "click",
        "scroll",
        "drag"
      ]
    },
    "element_id": {
      "type": "string",
      "description": "Element id for click/scroll or drag start."
    },
    "to_element_id": {
      "type": "string",
      "description": "Element id for drag destination."
    },
    "x": {
      "type": "number",
      "description": "Window-local x for click/scroll or drag start."
    },
    "y": {
      "type": "number",
      "description": "Window-local y for click/scroll or drag start."
    },
    "to_x": {
      "type": "number",
      "description": "Window-local drag destination x."
    },
    "to_y": {
      "type": "number",
      "description": "Window-local drag destination y."
    },
    "direction": {
      "type": "string",
      "enum": [
        "up",
        "down",
        "left",
        "right"
      ]
    },
    "pages": {
      "type": "integer"
    },
    "click_count": {
      "type": "integer"
    },
    "mouse_button": {
      "type": "string",
      "enum": [
        "left",
        "right",
        "middle"
      ]
    },
    "modifiers": {
      "type": "string",
      "description": "One provider-supported modifier chord."
    }
  },
  "required": [
    "app_id",
    "window_id",
    "observation_id",
    "action"
  ]
}
```

来源：[`packages/computer-use/tool-computer-use/src/index.ts`](../packages/computer-use/tool-computer-use/src/index.ts)

设备工具按需启用。每次桌面操作使用当前 observation；截图需要支持图像的模型路由和允许截图的 attachment 策略。

<a id="deepseek-aidsh-tool-mobile-device"></a>

## `@deepseek-ai/dsh-tool-mobile-device`

### `mobile_button`

Press one provider-supported device navigation button using an exact observation.

```json
{
  "type": "object",
  "properties": {
    "device_id": {
      "type": "string",
      "description": "Exact device id returned by the latest mobile_observe."
    },
    "observation_id": {
      "type": "string",
      "description": "One-use observation id returned by the latest mobile_observe for this device."
    },
    "button": {
      "type": "string"
    }
  },
  "required": [
    "device_id",
    "observation_id",
    "button"
  ]
}
```

来源：[`packages/mobile-device/tool-mobile-device/src/index.ts`](../packages/mobile-device/tool-mobile-device/src/index.ts)

### `mobile_list_devices`

List exact local Android emulator and iOS simulator device ids.

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/mobile-device/tool-mobile-device/src/index.ts`](../packages/mobile-device/tool-mobile-device/src/index.ts)

### `mobile_observe`

Read one fresh mobile-device tree and optional native PNG image.

```json
{
  "type": "object",
  "properties": {
    "device_id": {
      "type": "string",
      "description": "Exact device id returned by mobile_list_devices. Omit to use the saved default device; it must be currently available and there is no fallback."
    }
  }
}
```

来源：[`packages/mobile-device/tool-mobile-device/src/index.ts`](../packages/mobile-device/tool-mobile-device/src/index.ts)

### `mobile_touch`

Tap or swipe with normalized coordinates using one exact observation.

```json
{
  "type": "object",
  "properties": {
    "device_id": {
      "type": "string",
      "description": "Exact device id returned by the latest mobile_observe."
    },
    "observation_id": {
      "type": "string",
      "description": "One-use observation id returned by the latest mobile_observe for this device."
    },
    "action": {
      "type": "string",
      "enum": [
        "tap",
        "swipe"
      ]
    },
    "x": {
      "type": "number",
      "description": "Normalized tap x from 0 to 1."
    },
    "y": {
      "type": "number",
      "description": "Normalized tap y from 0 to 1."
    },
    "from_x": {
      "type": "number",
      "description": "Normalized swipe start x from 0 to 1."
    },
    "from_y": {
      "type": "number",
      "description": "Normalized swipe start y from 0 to 1."
    },
    "to_x": {
      "type": "number",
      "description": "Normalized swipe destination x from 0 to 1."
    },
    "to_y": {
      "type": "number",
      "description": "Normalized swipe destination y from 0 to 1."
    }
  },
  "required": [
    "device_id",
    "observation_id",
    "action"
  ]
}
```

来源：[`packages/mobile-device/tool-mobile-device/src/index.ts`](../packages/mobile-device/tool-mobile-device/src/index.ts)

### `mobile_type`

Type literal text through stdin using one exact mobile observation.

```json
{
  "type": "object",
  "properties": {
    "device_id": {
      "type": "string",
      "description": "Exact device id returned by the latest mobile_observe."
    },
    "observation_id": {
      "type": "string",
      "description": "One-use observation id returned by the latest mobile_observe for this device."
    },
    "text": {
      "type": "string"
    }
  },
  "required": [
    "device_id",
    "observation_id",
    "text"
  ]
}
```

来源：[`packages/mobile-device/tool-mobile-device/src/index.ts`](../packages/mobile-device/tool-mobile-device/src/index.ts)

移动设备工具使用归一化坐标和一次性 observation token。device-control profile 中的设备输入需要明确的策略审批。

<a id="deepseek-aidsh-tool-coordination"></a>

## `@deepseek-ai/dsh-tool-coordination`

### `coordination_add_task`

向 live coordination run 添加一个 task。其 dependency 与 parent 必须已属于该 run。

```json
{
  "type": "object",
  "properties": {
    "run_id": {
      "type": "string",
      "description": "Run id returned by coordination_start."
    },
    "task": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "task_id": {
          "type": "string",
          "description": "Optional stable id. Assign ids to tasks referenced by dependencies."
        },
        "label": {
          "type": "string",
          "description": "Short task label."
        },
        "prompt": {
          "type": "string",
          "description": "Standalone instructions for the task executor."
        },
        "dependencies": {
          "type": "array",
          "description": "Task ids that must succeed first.",
          "items": {
            "type": "string"
          }
        },
        "executor": {
          "type": "string",
          "description": "Registered executor kind. Omit to use the configured default."
        },
        "parent_task_id": {
          "type": "string",
          "description": "Optional acyclic parent task for subtree cancellation."
        }
      },
      "required": [
        "label",
        "prompt"
      ]
    }
  },
  "required": [
    "run_id",
    "task"
  ]
}
```

来源： [`packages/coordination/tool-coordination/src/index.ts`](../packages/coordination/tool-coordination/src/index.ts)

### `coordination_cancel`

取消一个所属 run；也可取消一个所属 task 的 parent subtree，以及因已取消 dependency 而传递性阻塞的 task。运行中的 executor 通过 `AbortSignal` 接收原因。

```json
{
  "type": "object",
  "properties": {
    "run_id": {
      "type": "string",
      "description": "Run id to cancel; mutually exclusive with task_id."
    },
    "task_id": {
      "type": "string",
      "description": "Task id whose parent-subtree and dependency-blocked descendants should be cancelled; mutually exclusive with run_id."
    },
    "reason": {
      "type": "string",
      "description": "Optional cancellation reason."
    }
  }
}
```

来源： [`packages/coordination/tool-coordination/src/index.ts`](../packages/coordination/tool-coordination/src/index.ts)

### `coordination_send_message`

提交一条发给所属 task 的 message。message listener 决定是否交付；coordination record 本身并不表示 executor 支持 live steering。

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Recipient task id."
    },
    "message": {
      "type": "string",
      "description": "Non-empty message for the task."
    }
  },
  "required": [
    "task_id",
    "message"
  ]
}
```

来源： [`packages/coordination/tool-coordination/src/index.ts`](../packages/coordination/tool-coordination/src/index.ts)

### `coordination_start`

启动后台 task DAG。独立 task 可以并发运行；dependency task 仅在每个具名 dependency 成功后启动。保留返回的 run id 与 task id，以便查询状态、发送 message、取消和等待。

```json
{
  "type": "object",
  "properties": {
    "tasks": {
      "type": "array",
      "description": "Complete initial task graph.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "task_id": {
            "type": "string",
            "description": "Optional stable id. Assign ids to tasks referenced by dependencies."
          },
          "label": {
            "type": "string",
            "description": "Short task label."
          },
          "prompt": {
            "type": "string",
            "description": "Standalone instructions for the task executor."
          },
          "dependencies": {
            "type": "array",
            "description": "Task ids that must succeed first.",
            "items": {
              "type": "string"
            }
          },
          "executor": {
            "type": "string",
            "description": "Registered executor kind. Omit to use the configured default."
          },
          "parent_task_id": {
            "type": "string",
            "description": "Optional acyclic parent task for subtree cancellation."
          }
        },
        "required": [
          "label",
          "prompt"
        ]
      }
    }
  },
  "required": [
    "tasks"
  ]
}
```

来源： [`packages/coordination/tool-coordination/src/index.ts`](../packages/coordination/tool-coordination/src/index.ts)

### `coordination_status`

读取一个所属 coordination run 及其全部 task，或读取一个所属 task。该调用绝不等待。

```json
{
  "type": "object",
  "properties": {
    "run_id": {
      "type": "string",
      "description": "Run id to inspect; mutually exclusive with task_id."
    },
    "task_id": {
      "type": "string",
      "description": "Task id to inspect; mutually exclusive with run_id."
    }
  }
}
```

来源： [`packages/coordination/tool-coordination/src/index.ts`](../packages/coordination/tool-coordination/src/index.ts)

### `coordination_wait`

等待一个所属 run 或 task 进入 terminal 状态，最长不超过配置的 timeout cap。超时会返回带 `timedOut: true` 的当前状态，并让工作继续运行。

```json
{
  "type": "object",
  "properties": {
    "run_id": {
      "type": "string",
      "description": "Run id to wait for; mutually exclusive with task_id."
    },
    "task_id": {
      "type": "string",
      "description": "Task id to wait for; mutually exclusive with run_id."
    },
    "timeout_ms": {
      "type": "integer",
      "description": "Optional positive wait duration, capped by deployment configuration."
    }
  }
}
```

来源： [`packages/coordination/tool-coordination/src/index.ts`](../packages/coordination/tool-coordination/src/index.ts)

六个 task-graph 工具归当前 Session 所有。目录使用默认 subagent executor 名称与有界等待默认值；启动 task 需要已注册的 executor。

<a id="deepseek-aidsh-tool-git"></a>

## `@deepseek-ai/dsh-tool-git`

### `git_diff`

读取 calling agent workspace repository 的有界 diff observation。该工具绝不修改 repository。

```json
{
  "type": "object",
  "properties": {
    "max_bytes": {
      "type": "integer",
      "description": "Optional positive byte cap within the configured provider limit."
    }
  }
}
```

来源： [`packages/git/tool-git/src/index.ts`](../packages/git/tool-git/src/index.ts)

### `git_log`

以有界结构化条目读取 calling agent workspace repository 的近期 commit。该工具绝不修改 repository。

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "integer",
      "description": "Optional positive entry limit within the configured provider limit."
    }
  }
}
```

来源： [`packages/git/tool-git/src/index.ts`](../packages/git/tool-git/src/index.ts)

### `git_status`

读取 calling agent workspace repository 的结构化 branch、divergence 与 working-tree 计数。该工具绝不修改 repository。

```json
{
  "type": "object",
  "properties": {}
}
```

来源： [`packages/git/tool-git/src/index.ts`](../packages/git/tool-git/src/index.ts)

目录使用 local provider、显式 executable 与上述有界限制展示三个只读 Git 工具；部署可以选择其他 provider 配置。

<a id="deepseek-aidsh-tool-goal"></a>

## `@deepseek-ai/dsh-tool-goal`

### `create_goal`

当当前直接人类请求是需要跨自主 Goal Round 持续推进的长期目标时，创建一个持久化的同会话完成目标。即使用户没有明确说「创建目标」，你也可以推断其意图。不要用于简单的单轮工作。执行时会拒绝非人类权限和 subagent 权限。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The concrete completion objective inferred from the direct human request."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Optional positive safe-integer limit on automatic continuation rounds."
    }
  },
  "required": [
    "objective"
  ]
}
```

来源： [`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `get_goal`

读取当前同会话目标，包括准确的 id/revision、objective、phase、已完成的 continuation round、round 上限、可用时的阻塞原因，以及是否已启用下一次 continuation。更新目标前调用此工具。

```json
{
  "type": "object",
  "properties": {}
}
```

来源： [`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `update_goal`

更新准确的当前 goal revision。edit、pause 和 resume 要求直接来自顶层人类请求。在当前 goal 的自动 continuation 中，complete 和 blocked 也可以使用。达到配置的最小 round 数之前会拒绝 blocked；模型必须判断同一阻塞条件是否持续，并在 blocked_reason 中说明。

```json
{
  "type": "object",
  "properties": {
    "goal_id": {
      "type": "string",
      "description": "Exact id returned by get_goal."
    },
    "revision": {
      "type": "number",
      "description": "Exact positive revision returned by get_goal."
    },
    "action": {
      "type": "string",
      "description": "edit | pause | resume | complete | blocked",
      "enum": [
        "edit",
        "pause",
        "resume",
        "complete",
        "blocked"
      ]
    },
    "objective": {
      "type": "string",
      "description": "Replacement objective; valid only with action edit."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Replacement cap; valid only with action edit."
    },
    "blocked_reason": {
      "type": "string",
      "description": "Concrete blocking condition; required only with action blocked."
    }
  },
  "required": [
    "goal_id",
    "revision",
    "action"
  ]
}
```

来源： [`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

create、edit、pause 和 resume 要求直接来自人类的 root 权限；complete 和 blocked 也接受准确的当前 goal round。blocked 的默认下限是 3 个获准 round。

<a id="deepseek-aidsh-schedule"></a>

## `@deepseek-ai/dsh-schedule`

### `schedule_create`

在当前会话创建一条提醒。提供非空 prompt 和恰好一个 selector：正的安全整数 after_seconds 延迟、严格 offset date-time 或本地日期时间对象 at，或至少为 300 的安全整数 every_seconds。固定速率提醒保持创建时对齐，跳过错过的发生，并为每条逾期规则批量保留最新一次发生。交付限定于当前会话：只有会话存活时提醒才会按时运行，否则会保持逾期直到会话恢复。

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Reminder content to present when the target becomes due."
    },
    "after_seconds": {
      "type": "number",
      "description": "Positive safe-integer delay in seconds."
    },
    "every_seconds": {
      "type": "number",
      "description": "Fixed-rate safe-integer interval in seconds, at least 300."
    },
    "at": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "date": {
              "type": "string"
            },
            "time": {
              "type": "string"
            },
            "time_zone": {
              "type": "string"
            }
          },
          "required": [
            "date",
            "time",
            "time_zone"
          ]
        }
      ],
      "description": "Absolute target as strict offset RFC 3339 or local date/time with an explicit IANA zone."
    }
  },
  "required": [
    "prompt"
  ]
}
```

来源： [`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_delete`

使用 schedule_create 或 schedule_list 返回的准确 id，删除当前会话中的一条活动提醒。未知或已完成的 id 返回 deleted false。

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Exact session-local schedule id."
    }
  },
  "required": [
    "id"
  ]
}
```

来源： [`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_list`

按创建顺序列出当前会话的所有活动提醒，包括准确 id、UTC 目标、scheduled 或 overdue 状态，以及 session-local 交付模式。

```json
{
  "type": "object",
  "properties": {}
}
```

来源： [`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

只在选择启用 Schedule plugin 后创建的活动 root Agent scope 中注册。版本 1 接受 after_seconds、明确的绝对 at 和有界固定速率 every_seconds，并披露 session-local 交付；管理读取和变更需要共享的 Session persistence barrier。

<a id="deepseek-aidsh-tool-lsp"></a>

## `@deepseek-ai/dsh-tool-lsp`

### `lsp`

查询语言服务器以进行精确的代码导航。operation 为 goToDefinition、findReferences、goToImplementation、hover 之一。line 和 character 是从 1 开始的 UTF-16 光标坐标。findReferences 包含声明。

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "goToDefinition, findReferences, goToImplementation, or hover.",
      "enum": [
        "goToDefinition",
        "findReferences",
        "goToImplementation",
        "hover"
      ]
    },
    "file_path": {
      "type": "string",
      "description": "The source file to query, relative to the workspace or absolute."
    },
    "line": {
      "type": "number",
      "description": "One-based line of the cursor."
    },
    "character": {
      "type": "number",
      "description": "One-based UTF-16 column of the cursor."
    }
  },
  "required": [
    "operation",
    "file_path",
    "line",
    "character"
  ]
}
```

来源： [`packages/lsp/tool-lsp/src/index.ts`](../packages/lsp/tool-lsp/src/index.ts)

lsp 工具将提供方选择和语言服务器子进程置于 ctx.lsp 之后，因此其模型可见 schema 在不同提供方之间保持稳定。运行时需要已注册的提供方（例如 `@deepseek-ai/dsh-lsp-stdio`）；没有提供方时，查询返回结构化的 `LSP_UNAVAILABLE` 错误，而不会改变 schema。

<a id="deepseek-aidsh-tool-ralph"></a>

## `@deepseek-ai/dsh-tool-ralph`

### `ralph`

围绕一个不可变目标运行前台 fresh-agent Ralph loop。仅在直接人类明确要求 Ralph 或 fresh-agent iteration 时使用。每个 round 都会打开没有父会话或旧 child session 的新 child；共享 workspace 作为长期记忆，round 之间只传递有界结构化报告。worker 报告完成、具体阻塞或达到 round 上限时调用返回。普通的长期同会话工作应使用 goal 工具。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The immutable completion objective for every fresh Ralph round."
    },
    "maxRounds": {
      "type": "number",
      "description": "Optional positive safe-integer round cap, bounded by the deployment ceiling."
    }
  },
  "required": [
    "objective"
  ]
}
```

来源： [`packages/workflow/tool-ralph/src/index.ts`](../packages/workflow/tool-ralph/src/index.ts)

固定的前台工作流每个 round 启动一个全新的结构化 child；模型只能选择不可变目标和可选的 round 上限。

<a id="deepseek-aidsh-tool-skill"></a>

## `@deepseek-ai/dsh-tool-skill`

### `skill`

加载可用 skill 的完整说明。处理明确点名或明显匹配某个 skill 的任务前，使用会话 skill catalog 中的准确 skill 名称调用此工具。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The exact skill name from the available skills list."
    }
  },
  "required": [
    "name"
  ]
}
```

来源： [`packages/skill/tool-skill/src/index.ts`](../packages/skill/tool-skill/src/index.ts)

<a id="deepseek-aidsh-tool-session-query"></a>

## `@deepseek-ai/dsh-tool-session-query`

### `session_event_read`

Read one full unabridged event and optional neighboring raw-event summaries from an authorized session.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    },
    "before": {
      "type": "integer",
      "description": "Number of preceding raw events to summarize. Omit for none."
    },
    "after": {
      "type": "integer",
      "description": "Number of following raw events to summarize. Omit for none."
    }
  },
  "required": [
    "seq"
  ]
}
```

来源： [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_search`

Search prior events in one authorized session; the current session excludes the step performing this call.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "query": {
      "type": "string",
      "description": "Literal full-text query over the target session."
    },
    "seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

来源： [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_trace`

Read every direct replacement and relationship to a cited source event for one event in an authorized session.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    }
  },
  "required": [
    "seq"
  ]
}
```

来源： [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_search`

Search prior sessions in the caller workspace and return the strongest matching event from each session.

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Literal full-text query over prior session history."
    },
    "session_ids": {
      "type": "array",
      "description": "Optional session ids to include.",
      "items": {
        "type": "string"
      }
    },
    "created_at_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time lower bound."
    },
    "created_at_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time upper bound."
    },
    "parent_session_ids": {
      "type": "array",
      "description": "Optional direct parent session ids.",
      "items": {
        "type": "string"
      }
    },
    "include_root_sessions": {
      "type": "boolean",
      "description": "Include sessions with no parent in the parent filter."
    },
    "availability": {
      "type": "array",
      "description": "Require at least one selected source availability.",
      "items": {
        "type": "string",
        "enum": [
          "live",
          "persisted"
        ]
      }
    },
    "event_seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "event_seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "event_time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "event_time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "event_surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

来源： [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_trace`

Read the authorized session lineage around one session, including complete visible ancestor and descendant relationships.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    }
  }
}
```

来源： [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

这 5 个只读工具隐藏提供方游标，并根据不可变的调用 agent session 为每个结果授权。该包需要选择启用；需要强制截止时间或限制行内输出的组合还会挂载通用 timeout 或 spill 策略。

<a id="deepseek-aidsh-tool-subagent"></a>

## `@deepseek-ai/dsh-tool-subagent`

### `list_subagent_models`

发现 subagent 的 LLM 路由，不改变当前 Agent。不带参数调用以列出已注册提供方，带 `provider` 列出其声明的模型，或同时带 `provider` 和 `model` 检查准确模型及其 reasoning effort。目录成员关系仅供参考：适配器可能接受未列出的 model id。将返回的 id 用于委派工具的 `provider`、`model` 和 `reasoning_effort` 字段。

```json
{
  "type": "object",
  "properties": {
    "provider": {
      "type": "string",
      "description": "Registered LLM provider id. Omit to list providers."
    },
    "model": {
      "type": "string",
      "description": "Exact model id to inspect. Requires provider; omit to list that provider's advertised models."
    }
  }
}
```

来源： [`packages/subagent/tool-subagent/src/list-models.ts`](../packages/subagent/tool-subagent/src/list-models.ts)

### `subagent`

Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation's context. The subagent returns its result, not its intermediate steps. Give it a complete, standalone prompt: it does not see this conversation. This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "A short (3-5 word) description of the delegated task, for display."
    },
    "prompt": {
      "type": "string",
      "description": "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "description",
    "prompt"
  ]
}
```

来源： [`packages/subagent/tool-subagent/src/index.ts`](../packages/subagent/tool-subagent/src/index.ts)

注册的委派名称是加载时的 `toolName` 配置（默认值为 `subagent`）；上面的默认 schema 关闭模型选择，而 discovery schema 作为启用 Session 中可用的固定 companion 展示。Web preset 为每个新的顶层 Session 读取 Plugins 偏好，并为其 child Session 保留该决定；`subagent_fork` 始终使用固定路由。每个实例通过 `modelSelectionSettings`、`backgroundMode` 和 `enableRunInBackground` 独立控制是否读取模型选择设置及后台行为。

<a id="deepseek-aidsh-tool-subagent-control"></a>

## `@deepseek-ai/dsh-tool-subagent-control`

### `interrupt_agent`

Request cancellation of a background agent's current turn by its agent id. The target may be your direct child or a deeper agent created under you. Only the current turn stops: messages already queued for the agent stay parked until a later send_message, agents it started keep running, and the agent itself stays available for follow-ups. This call returns as soon as the stop request is accepted, so the target may keep running briefly; interrupting an agent that already finished is an accepted no-op.

```json
{
  "type": "object",
  "properties": {
    "agent_id": {
      "type": "string",
      "description": "The agent id of the running agent to interrupt."
    }
  },
  "required": [
    "agent_id"
  ]
}
```

来源： [`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

### `list_agents`

List your continuable background subagents by durable id and label. Use it to recall which ones you started, not to poll for completion — you are told when one finishes. Status comes from the live registry: running means the agent is working right now, idle means it is loaded but between turns (it may be waiting on agents it started), and ready means it exists only in storage — resumable, not terminal, and not a result waiting to be collected; a `send_message` steers a running child at its nearest step boundary or starts a turn for an idle or ready child, and a direct child remains a `send_message` candidate in every status. The snapshot is not a delivery promise — `send_message` performs the authoritative check and may still fail. Children that could not be read are reported as diagnostics instead of being silently dropped. Scope `descendants` walks the whole tree below you in stable pre-order, annotating each entry with its durable direct-parent session id and depth. You may use `send_message` only for depth-1 entries; deeper entries are candidates for `interrupt_agent` only.

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "description": "children (default) lists direct children only; descendants walks the complete tree below you.",
      "enum": [
        "children",
        "descendants"
      ]
    }
  }
}
```

来源： [`packages/subagent/tool-subagent-control/src/list-agents.ts`](../packages/subagent/tool-subagent-control/src/list-agents.ts)

### `send_message`

按 agent id 向直接可继续 child 发送消息。如果当前是驻留的可继续 child，也可以将直接 parent 作为目标。目标仍在工作时，消息会在最近步骤调整它；目标 idle 时，消息会开启一个 turn。此调用不返回 agent 答案，只确认消息已交付。失败表示消息未交付。

```json
{
  "type": "object",
  "properties": {
    "agent_id": {
      "type": "string",
      "description": "The agent id of your direct continuable child, or your direct parent when you are a resident continuable child."
    },
    "message": {
      "type": "string",
      "description": "The message to deliver to the agent."
    }
  },
  "required": [
    "agent_id",
    "message"
  ]
}
```

来源： [`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

针对可继续后台 subagent 的全局命名控制工具：绑定提供方的 `tool-subagent` 实例注册不同的委派工具；本包注册一次 `send_message` 和 `interrupt_agent`，另由单独加载的 `/list-agents` plugin 提供 `list_agents`（其目录行使用 sessionProjections 和实时 Agent registry）。

<a id="deepseek-aidsh-tool-jobs"></a>

## `@deepseek-ai/dsh-tool-jobs`

### `job_kill`

Request cancellation of a running background job by job id. Returns immediately; the job settles as killed once its work actually stops.

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "reason": {
      "type": "string",
      "description": "Optional short reason, recorded in the log and forwarded to the job."
    }
  },
  "required": [
    "job_id"
  ]
}
```

来源： [`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_list`

列出后台 job（运行中和已完成）的 id、kind 和 status。

```json
{
  "type": "object",
  "properties": {}
}
```

来源： [`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_output`

Read a background job. Stream jobs return only output since the previous read; final-output jobs return their result after settlement. Every response ends with `[status: ...]`. Reads are non-blocking unless `wait: true`, which waits up to the configured cap.

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "wait": {
      "type": "boolean",
      "description": "Block until the job reaches a terminal status or the timeout expires. A timed-out wait returns [status: running] and leaves the job alive."
    },
    "timeout_ms": {
      "type": "number",
      "description": "Max wait in milliseconds (only meaningful with wait: true). Defaults to the configured wait timeout; capped by the configured maximum."
    }
  },
  "required": [
    "job_id"
  ]
}
```

来源： [`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

与任务 kind 无关的后台 job 控制器：后台 bash 命令、PTY send 和 subagent 都通过相同的三个工具读取、列出和终止。加载 plugin 会连接控制器，从而启用生产方的 `ctx.jobs.start()`。

<a id="deepseek-aidsh-experimental-tool-agent-team"></a>

## `@deepseek-ai/dsh-experimental-tool-agent-team`

### `interrupt_agent`

中断一个 teammate 的当前 turn，同时保留其待处理 inbox。仅 Team Lead 可用。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Teammate name."
    }
  },
  "required": [
    "target"
  ]
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `list_agents`

列出 Lead 和每个持久 teammate 的当前运行时状态。

```json
{
  "type": "object",
  "properties": {}
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `send_message`

向另一个 Team member 发送一条持久消息。运行中的目标在最近步骤边界接收消息；idle 目标开启一个 turn；inactive teammate 冷恢复。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Team member name, or lead."
    },
    "message": {
      "type": "string",
      "description": "Self-contained message for the target."
    }
  },
  "required": [
    "target",
    "message"
  ]
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `spawn_teammate`

创建一个命名的持久 teammate。只有 Team Lead 可以调用此工具。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Unique lower-kebab-case teammate name."
    },
    "description": {
      "type": "string",
      "description": "Short description of the delegated responsibility."
    },
    "prompt": {
      "type": "string",
      "description": "Complete initial task for the teammate."
    },
    "context": {
      "type": "string",
      "description": "fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.",
      "enum": [
        "fresh",
        "fork"
      ]
    }
  },
  "required": [
    "name",
    "description",
    "prompt"
  ]
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_create`

在共享 Team task board 上创建一项没有 owner 的 pending task。

```json
{
  "type": "object",
  "properties": {
    "subject": {
      "type": "string",
      "description": "Concise task title."
    },
    "description": {
      "type": "string",
      "description": "Complete task details and acceptance criteria."
    },
    "blocked_by": {
      "type": "array",
      "description": "Task ids that must complete first.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Advisory workspace-relative file or directory prefixes this task expects to modify.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "subject",
    "description"
  ]
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_get`

在更改或执行共享 task 前，读取该 task 的完整最新值。

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Shared task id."
    }
  },
  "required": [
    "task_id"
  ]
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_list`

列出共享 task，包括 readiness、owner、revision、blocker 和 write-scope warning。

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Optional exact status filter.",
      "enum": [
        "pending",
        "in_progress",
        "completed"
      ]
    },
    "owner": {
      "type": "string",
      "description": "Optional member-name filter; use unowned for tasks without an owner."
    },
    "ready": {
      "type": "boolean",
      "description": "Optional readiness filter."
    },
    "cursor": {
      "type": "integer",
      "description": "Zero-based result offset. Defaults to 0."
    },
    "limit": {
      "type": "integer",
      "description": "Number of rows, 1 through 100. Defaults to 50."
    }
  }
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_update`

使用 team_task_get 或 team_task_list 返回的最新 revision，对共享 task action 执行 compare-and-set。

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Shared task id."
    },
    "expected_revision": {
      "type": "integer",
      "description": "Current task revision used as the CAS precondition."
    },
    "action": {
      "type": "string",
      "description": "Task transition to apply.",
      "enum": [
        "claim",
        "release",
        "edit",
        "set_dependencies",
        "complete",
        "reopen",
        "reassign",
        "delete"
      ]
    },
    "subject": {
      "type": "string",
      "description": "Replacement title for edit."
    },
    "description": {
      "type": "string",
      "description": "Replacement details for edit."
    },
    "blocked_by": {
      "type": "array",
      "description": "Complete blocker list for set_dependencies.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Replacement advisory write scopes for edit.",
      "items": {
        "type": "string"
      }
    },
    "owner": {
      "type": "string",
      "description": "Member name for Lead-only reassign; omit to unassign."
    }
  },
  "required": [
    "task_id",
    "expected_revision",
    "action"
  ]
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `wait_agent`

等待此调用开始后下一次 teammate 状态、mailbox 或共享 task 变化。它不会唤醒 inactive member；没有其他 member 正在运行或 provisioning 时立即返回 noProgress。唤醒或超时后重新列出状态，不要轮询。

```json
{
  "type": "object",
  "properties": {
    "timeout_ms": {
      "type": "integer",
      "description": "Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000."
    }
  }
}
```

来源： [`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

这 9 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 dsh-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。

<a id="deepseek-aidsh-tool-todo"></a>

## `@deepseek-ai/dsh-tool-todo`

### `todo_write`

记录并更新当前工作的结构化任务列表。每次调用都要发送**完整列表**，它会**替换**之前的列表，不支持局部更新或逐项编辑。请用它规划多步骤工作并展示进度：开始前为每个具体步骤添加一项 todo。将当前正在处理的每项 todo 标记为 `in_progress`；确实并行运行时（例如并发 subagent 或后台命令）可同时标记多项，顺序工作则标记 1 项。只要工作尚未完成，就应至少有一项任务为 `in_progress`。某项 todo 完成后立即标记为 `completed`，不要批量标记完成；只有全部工作完成后，才可以没有 `in_progress` 项。简单的单步骤任务无需使用列表。状态：`pending`（未开始）、`in_progress`（正在处理）、`completed`（已完成）。

```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "description": "The COMPLETE task list, replacing any previous list.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "content": {
            "type": "string",
            "description": "What the task is — a short imperative line."
          },
          "status": {
            "type": "string",
            "description": "pending (not started) | in_progress (now) | completed (done).",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ]
          }
        },
        "required": [
          "content",
          "status"
        ]
      }
    }
  },
  "required": [
    "todos"
  ]
}
```

来源：[`packages/todo/tool-todo/src/index.ts`](../packages/todo/tool-todo/src/index.ts)

todo_write 是会话所有的状态；UI 将最新的 todo/write 事件渲染为检查清单。`allowParallelInProgress` 是没有默认值的必填项，因此本目录明确选择 `true`，对应描述允许同时存在多个 `in_progress` 项。选择 `false` 的部署会获得同一工具，但描述会要求只能有 1 个活动任务。

<a id="deepseek-aidsh-tool-workflow"></a>

## `@deepseek-ai/dsh-tool-workflow`

### `workflow`

运行用于大规模编排 subagent 的 JavaScript 工作流脚本。当工作会分散到许多相互独立的部分时，请使用此工具，例如审查大量文件、执行迁移、开展多角度研究或对发现进行对抗式验证；此时应将编排写成脚本，而不是逐轮委派。

工作流的身份通过 `meta` 参数以 JSON 形式传入：必填的 `name`（简短 kebab-case）和 `description` 字符串，以及可选的 `whenToUse` 字符串和 `phases` 数组（`{title, detail?, provider?, model?}`）。`script` 参数只能是纯 JavaScript **函数体**，不能是 TypeScript，也不能包含 `export const meta` 语句；meta 是参数而非代码。脚本支持顶层 await；请以 `return <value>` 结尾，该值必须可以 JSON 序列化，并作为此工具的结果。

脚本函数体提供以下钩子：

- `agent(prompt, opts?): Promise<any>`：运行一个 subagent 直至完成。不提供 `opts.schema` 时，解析为子级最终文本；提供 `opts.schema` 时，它必须是以对象为根、且**只能**使用 type/properties/required/additionalProperties/items/enum/const/oneOf 的 JSON Schema，不支持 pattern/format/数值边界，此时解析为通过校验的对象。子级失败时解析为 `null`，可使用 `.filter(Boolean)` 过滤。其他选项包括 `label`（显示名称）、`phase`（进度组），以及相互独立的 `provider`／`model` LLM（大语言模型）目标覆盖项，两者可单独提供。其他任何选项（`effort`／`isolation`／`agentType`）都会明确报错。
- `pipeline(items, ...stages): Promise<any[]>`：让每个条目分别经过各阶段，阶段之间**没有**屏障；多阶段工作优先使用它。每个阶段接收 `(prev, item, index)`。普通的阶段异常会将该**条目**变为 `null`，并跳过它的剩余阶段。
- `parallel(thunks): Promise<any[]>`：并发运行零参数函数并等待**全部**完成。它会形成屏障，仅当某个阶段确实需要汇总全部先前结果时使用。抛出异常的 thunk 解析为 `null`。
- `phase(title)`：开始一个进度阶段；`log(message)`：说明进度；`args`：工具调用的 `args` 输入，原样提供。

如果误用钩子（参数错误、未知选项、不受支持的 schema、触发上限），抛出的错误**总会**终止脚本，绝不会退化为单个条目的 `null`。

约束：并发上限和 agent 总数上限均会生效；不提供文件系统、网络、定时器或 Node.js API。具体工作由 agent 完成，脚本只负责编排。该运行在前台执行：整个脚本完成后，调用才会返回。

```json
{
  "type": "object",
  "properties": {
    "script": {
      "type": "string",
      "description": "The plain-JS workflow script body (top-level await allowed; NO `export const meta` statement; end with `return <json-value>`)."
    },
    "meta": {
      "type": "object",
      "description": "The workflow identity block (plain JSON — never code).",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string",
          "description": "Short kebab-case workflow name."
        },
        "description": {
          "type": "string",
          "description": "One-line description of what the workflow does."
        },
        "whenToUse": {
          "type": "string",
          "description": "Optional guidance on when this workflow applies."
        },
        "phases": {
          "type": "array",
          "description": "Optional phase declarations matched by phase() calls.",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "title": {
                "type": "string",
                "description": "The phase title phase() calls match by exact string."
              },
              "detail": {
                "type": "string",
                "description": "Optional one-line description of the phase."
              },
              "provider": {
                "type": "string",
                "description": "Optional provider override this phase is expected to use."
              },
              "model": {
                "type": "string",
                "description": "Optional model override this phase is expected to use."
              }
            },
            "required": [
              "title"
            ]
          }
        }
      },
      "required": [
        "name",
        "description"
      ]
    },
    "args": {
      "type": "object",
      "description": "Optional JSON input exposed to the script as the `args` global (wrap a bare list as a field, e.g. {\"files\": [...]}).",
      "additionalProperties": true
    }
  },
  "required": [
    "script",
    "meta"
  ]
}
```

来源：[`packages/workflow/tool-workflow/src/index.ts`](../packages/workflow/tool-workflow/src/index.ts)

<a id="deepseek-aidsh-tool-finding"></a>

## `@deepseek-ai/dsh-tool-finding`

### `finding_export`

将当前会话中所有匹配的 finding 以确定性的 JSON、Markdown 或 SARIF 2.1.0 导出，并发布一个报告 Artifact。

```json
{
  "type": "object",
  "properties": {
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "states": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "observation",
          "hypothesis",
          "reproduced-vulnerability",
          "remediation",
          "unresolved"
        ]
      }
    },
    "severities": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "informational",
          "low",
          "medium",
          "high",
          "critical"
        ]
      }
    },
    "ruleIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "targetIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "format": {
      "type": "string",
      "enum": [
        "json",
        "markdown",
        "sarif"
      ]
    }
  },
  "required": [
    "format"
  ]
}
```

来源： [`packages/security/tool-finding/src/index.ts`](../packages/security/tool-finding/src/index.ts)

### `finding_query`

读取当前会话 finding 的有界确定性分页结果；执行状态转换前使用准确的 id 和 revision。

```json
{
  "type": "object",
  "properties": {
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "states": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "observation",
          "hypothesis",
          "reproduced-vulnerability",
          "remediation",
          "unresolved"
        ]
      }
    },
    "severities": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "informational",
          "low",
          "medium",
          "high",
          "critical"
        ]
      }
    },
    "ruleIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "targetIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "cursor": {
      "type": "string"
    },
    "limit": {
      "type": "integer"
    },
    "detail": {
      "type": "string",
      "enum": [
        "summary",
        "full"
      ]
    }
  }
}
```

来源： [`packages/security/tool-finding/src/index.ts`](../packages/security/tool-finding/src/index.ts)

### `finding_record`

记录一个类型化的当前会话安全 finding。服务派生 id 和 fingerprint；重复身份只增加一次 occurrence，不会提升状态。

```json
{
  "type": "object",
  "properties": {
    "ruleId": {
      "type": "string",
      "description": "Stable detector or rule identifier."
    },
    "title": {
      "type": "string"
    },
    "summary": {
      "type": "string"
    },
    "state": {
      "type": "string",
      "enum": [
        "observation",
        "hypothesis",
        "reproduced-vulnerability"
      ]
    },
    "severity": {
      "type": "string",
      "enum": [
        "informational",
        "low",
        "medium",
        "high",
        "critical"
      ]
    },
    "confidence": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "targets": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "host",
              "service",
              "url",
              "repository",
              "package",
              "file",
              "component",
              "other"
            ]
          },
          "displayName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "kind",
          "displayName"
        ]
      }
    },
    "locations": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "code"
                ]
              },
              "targetId": {
                "type": "string"
              },
              "uri": {
                "type": "string"
              },
              "startLine": {
                "type": "integer"
              },
              "startColumn": {
                "type": "integer"
              },
              "endLine": {
                "type": "integer"
              },
              "endColumn": {
                "type": "integer"
              }
            },
            "required": [
              "kind",
              "targetId",
              "uri"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "dependency"
                ]
              },
              "targetId": {
                "type": "string"
              },
              "ecosystem": {
                "type": "string"
              },
              "packageName": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "manifestUri": {
                "type": "string"
              }
            },
            "required": [
              "kind",
              "targetId",
              "ecosystem",
              "packageName"
            ]
          }
        ]
      }
    },
    "cweIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "cveIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "cvss": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "string",
          "enum": [
            "3.1",
            "4.0"
          ]
        },
        "vector": {
          "type": "string"
        },
        "score": {
          "type": "number"
        }
      },
      "required": [
        "version",
        "vector",
        "score"
      ]
    },
    "assumptions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "reachability": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "unknown"
              ]
            }
          },
          "required": [
            "kind"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "unreachable"
              ]
            },
            "reason": {
              "type": "string"
            }
          },
          "required": [
            "kind",
            "reason"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "reachable"
              ]
            },
            "entrypoint": {
              "type": "string"
            },
            "pathEvidence": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "artifactId": {
                  "type": "string"
                },
                "mediaType": {
                  "type": "string"
                },
                "kind": {
                  "type": "string"
                },
                "bytes": {
                  "type": "integer"
                },
                "sha256": {
                  "type": "string"
                },
                "createdAt": {
                  "type": "string"
                },
                "provenance": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "producerId": {
                      "type": "string"
                    },
                    "executionHostId": {
                      "type": "string"
                    },
                    "sessionId": {
                      "type": "string"
                    },
                    "taskId": {
                      "type": "string"
                    },
                    "engagementId": {
                      "type": "string"
                    },
                    "scopeRef": {
                      "type": "string"
                    },
                    "source": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "producerId",
                    "executionHostId"
                  ]
                },
                "retention": {
                  "type": "string",
                  "enum": [
                    "ephemeral",
                    "session",
                    "task",
                    "engagement",
                    "pinned",
                    "managed"
                  ]
                },
                "redaction": {
                  "type": "string",
                  "enum": [
                    "none",
                    "redacted",
                    "unknown"
                  ]
                },
                "name": {
                  "type": "string"
                }
              },
              "required": [
                "artifactId",
                "mediaType",
                "kind",
                "bytes",
                "sha256",
                "createdAt",
                "provenance",
                "retention",
                "redaction"
              ]
            }
          },
          "required": [
            "kind",
            "entrypoint"
          ]
        }
      ]
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "role": {
            "type": "string",
            "enum": [
              "observation",
              "reproduction",
              "remediation-validation",
              "supporting"
            ]
          },
          "artifact": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "artifactId": {
                "type": "string"
              },
              "mediaType": {
                "type": "string"
              },
              "kind": {
                "type": "string"
              },
              "bytes": {
                "type": "integer"
              },
              "sha256": {
                "type": "string"
              },
              "createdAt": {
                "type": "string"
              },
              "provenance": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "producerId": {
                    "type": "string"
                  },
                  "executionHostId": {
                    "type": "string"
                  },
                  "sessionId": {
                    "type": "string"
                  },
                  "taskId": {
                    "type": "string"
                  },
                  "engagementId": {
                    "type": "string"
                  },
                  "scopeRef": {
                    "type": "string"
                  },
                  "source": {
                    "type": "string"
                  }
                },
                "required": [
                  "producerId",
                  "executionHostId"
                ]
              },
              "retention": {
                "type": "string",
                "enum": [
                  "ephemeral",
                  "session",
                  "task",
                  "engagement",
                  "pinned",
                  "managed"
                ]
              },
              "redaction": {
                "type": "string",
                "enum": [
                  "none",
                  "redacted",
                  "unknown"
                ]
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "artifactId",
              "mediaType",
              "kind",
              "bytes",
              "sha256",
              "createdAt",
              "provenance",
              "retention",
              "redaction"
            ]
          },
          "note": {
            "type": "string"
          }
        },
        "required": [
          "role",
          "artifact"
        ]
      }
    }
  },
  "required": [
    "ruleId",
    "title",
    "summary",
    "state",
    "severity",
    "confidence",
    "targets",
    "locations",
    "reachability"
  ]
}
```

来源： [`packages/security/tool-finding/src/index.ts`](../packages/security/tool-finding/src/index.ts)

### `finding_transition`

转换一个准确 finding revision。reproduced-vulnerability 和 remediation 状态要求满足对应的类型化证据前置条件。

```json
{
  "type": "object",
  "properties": {
    "findingId": {
      "type": "string"
    },
    "revision": {
      "type": "integer"
    },
    "to": {
      "type": "string",
      "enum": [
        "hypothesis",
        "reproduced-vulnerability",
        "remediation",
        "unresolved"
      ]
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "role": {
            "type": "string",
            "enum": [
              "observation",
              "reproduction",
              "remediation-validation",
              "supporting"
            ]
          },
          "artifact": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "artifactId": {
                "type": "string"
              },
              "mediaType": {
                "type": "string"
              },
              "kind": {
                "type": "string"
              },
              "bytes": {
                "type": "integer"
              },
              "sha256": {
                "type": "string"
              },
              "createdAt": {
                "type": "string"
              },
              "provenance": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "producerId": {
                    "type": "string"
                  },
                  "executionHostId": {
                    "type": "string"
                  },
                  "sessionId": {
                    "type": "string"
                  },
                  "taskId": {
                    "type": "string"
                  },
                  "engagementId": {
                    "type": "string"
                  },
                  "scopeRef": {
                    "type": "string"
                  },
                  "source": {
                    "type": "string"
                  }
                },
                "required": [
                  "producerId",
                  "executionHostId"
                ]
              },
              "retention": {
                "type": "string",
                "enum": [
                  "ephemeral",
                  "session",
                  "task",
                  "engagement",
                  "pinned",
                  "managed"
                ]
              },
              "redaction": {
                "type": "string",
                "enum": [
                  "none",
                  "redacted",
                  "unknown"
                ]
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "artifactId",
              "mediaType",
              "kind",
              "bytes",
              "sha256",
              "createdAt",
              "provenance",
              "retention",
              "redaction"
            ]
          },
          "note": {
            "type": "string"
          }
        },
        "required": [
          "role",
          "artifact"
        ]
      }
    },
    "fixGuidance": {
      "type": "string"
    }
  },
  "required": [
    "findingId",
    "revision",
    "to"
  ]
}
```

来源： [`packages/security/tool-finding/src/index.ts`](../packages/security/tool-finding/src/index.ts)

这四个 finding 工具使用当前的 Session 和 Artifact 提供方。报告 provenance 绑定当前 execution host；reproduction 和 remediation 状态转换要求类型化证据。

<a id="deepseek-aidsh-tool-vuln-kb"></a>

## `@deepseek-ai/dsh-tool-vuln-kb`

### `vuln_query`

按包名和生态系统查询漏洞知识库中的 CVE，也可以按版本筛选。返回包含严重性和修复可用性的紧凑匹配条目；使用 vuln_read 获取受影响范围和参考链接。

```json
{
  "type": "object",
  "properties": {
    "cveId": {
      "type": "string",
      "description": "Specific CVE id (e.g., CVE-2024-12345). If provided, ecosystem/package/version are ignored."
    },
    "ecosystem": {
      "type": "string",
      "description": "Package ecosystem (e.g., npm, pypi, maven, go, nuget). Required if cveId is not provided."
    },
    "package": {
      "type": "string",
      "description": "Package name within the ecosystem. Required if cveId is not provided."
    },
    "version": {
      "type": "string",
      "description": "Specific version to check for affectedness. Optional."
    },
    "maxResults": {
      "type": "integer",
      "description": "Positive maximum number of results to return. The active provider supplies the default."
    }
  }
}
```

来源： [`packages/security/tool-vuln-kb/src/index.ts`](../packages/security/tool-vuln-kb/src/index.ts)

### `vuln_read`

按 CVE id 读取单个漏洞的完整详情，包括描述、CVSS 向量、受影响包范围和参考 URL。

```json
{
  "type": "object",
  "properties": {
    "cveId": {
      "type": "string",
      "description": "The CVE id (e.g., CVE-2024-12345)."
    }
  },
  "required": [
    "cveId"
  ]
}
```

来源： [`packages/security/tool-vuln-kb/src/index.ts`](../packages/security/tool-vuln-kb/src/index.ts)

vuln_query 和 vuln_read 暴露提供方结果，但不判断可利用性，也不授予评估权限；目录启动使用 NVD+OSV 适配器且不会发起网络请求。

<a id="deepseek-aidsh-tool-work-items"></a>

## `@deepseek-ai/dsh-tool-work-items`

### `work_items_cancel_write`

按精确的持久化 operation_id 取消一个尚未执行的 Work Items 预览。

```json
{
  "type": "object",
  "properties": {
    "operation_id": {
      "type": "string",
      "description": "Exact operation_id returned by work_items_prepare_write or work_items_list_writes."
    }
  },
  "required": [
    "operation_id"
  ]
}
```

来源：[`packages/work-items/tool-work-items/src/index.ts`](../packages/work-items/tool-work-items/src/index.ts)

### `work_items_confirm_write`

按 operation_id 确认一个已持久化的 Work Items 预览；不接受替换修改内容。

```json
{
  "type": "object",
  "properties": {
    "operation_id": {
      "type": "string",
      "description": "Exact operation_id returned by work_items_prepare_write or work_items_list_writes."
    }
  },
  "required": [
    "operation_id"
  ]
}
```

来源：[`packages/work-items/tool-work-items/src/index.ts`](../packages/work-items/tool-work-items/src/index.ts)

### `work_items_get`

按不透明 Provider id 读取一个标准化 Work Item。

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Opaque id returned by work_items_list, such as github:owner/repository#123."
    }
  },
  "required": [
    "id"
  ]
}
```

来源：[`packages/work-items/tool-work-items/src/index.ts`](../packages/work-items/tool-work-items/src/index.ts)

### `work_items_list`

从已配置的 GitHub、GitLab 或 Linear Provider 列出标准化 Work Items。

```json
{
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "description": "Optional provider family; omit only when exactly one provider is usable.",
      "enum": [
        "github",
        "linear",
        "gitlab"
      ]
    },
    "scope": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "source": {
              "type": "string",
              "const": "github"
            },
            "owner": {
              "type": "string",
              "description": "Configured GitHub repository owner."
            },
            "repository": {
              "type": "string",
              "description": "Configured GitHub repository name."
            }
          },
          "required": [
            "source",
            "owner",
            "repository"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "source": {
              "type": "string",
              "const": "linear"
            },
            "team": {
              "type": "string",
              "description": "Configured Linear team id."
            },
            "project": {
              "type": "string",
              "description": "Configured Linear project id."
            }
          },
          "required": [
            "source"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "source": {
              "type": "string",
              "const": "gitlab"
            },
            "owner": {
              "type": "string",
              "description": "Configured GitLab namespace."
            },
            "repository": {
              "type": "string",
              "description": "Configured GitLab project path."
            }
          },
          "required": [
            "source",
            "owner",
            "repository"
          ]
        }
      ],
      "description": "Optional configured provider scope. GitHub requires owner and repository; Linear requires team or project; GitLab requires owner and repository."
    },
    "query": {
      "type": "string",
      "description": "Optional bounded title/body text filter."
    },
    "state": {
      "type": "string",
      "description": "Optional provider-neutral state filter; defaults to open.",
      "enum": [
        "open",
        "closed",
        "all"
      ]
    },
    "cursor": {
      "type": "string",
      "description": "Opaque cursor returned by a prior page."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum items to request, from 1 through 100."
    }
  }
}
```

来源：[`packages/work-items/tool-work-items/src/index.ts`](../packages/work-items/tool-work-items/src/index.ts)

### `work_items_list_writes`

读取一个 Provider 类型的持久化 Work Items 预览及回执，不发起 Provider 修改请求。

```json
{
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "enum": [
        "github",
        "linear",
        "gitlab"
      ]
    },
    "limit": {
      "type": "integer",
      "description": "Maximum history rows, from 1 through 100."
    }
  },
  "required": [
    "source",
    "limit"
  ]
}
```

来源：[`packages/work-items/tool-work-items/src/index.ts`](../packages/work-items/tool-work-items/src/index.ts)

### `work_items_prepare_write`

校验并持久化预览一次 Work Item 修改，不联系外部 Provider 执行修改。

```json
{
  "type": "object",
  "properties": {
    "mutation": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "create"
            },
            "source": {
              "type": "string",
              "enum": [
                "github",
                "linear",
                "gitlab"
              ]
            },
            "title": {
              "type": "string",
              "description": "New Work Item title."
            },
            "body": {
              "type": "string",
              "description": "New Work Item body."
            }
          },
          "required": [
            "kind",
            "source",
            "title",
            "body"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "comment"
            },
            "id": {
              "type": "string",
              "description": "Opaque id returned by a Work Items read."
            },
            "body": {
              "type": "string",
              "description": "Comment body."
            }
          },
          "required": [
            "kind",
            "id",
            "body"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "state"
            },
            "id": {
              "type": "string",
              "description": "Opaque id returned by a Work Items read."
            },
            "state": {
              "type": "string",
              "description": "Provider state value."
            }
          },
          "required": [
            "kind",
            "id",
            "state"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "assign"
            },
            "id": {
              "type": "string",
              "description": "Opaque id returned by a Work Items read."
            },
            "assignees": {
              "type": "array",
              "description": "Provider assignee ids; an empty list clears assignment.",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "kind",
            "id",
            "assignees"
          ]
        }
      ],
      "description": "Exact external mutation to preview. The returned operation_id is required for confirmation."
    }
  },
  "required": [
    "mutation"
  ]
}
```

来源：[`packages/work-items/tool-work-items/src/index.ts`](../packages/work-items/tool-work-items/src/index.ts)

Provider 写入默认关闭。启用后仍需持久化预览和独立确认；不确定结果绝不自动重发。

<a id="deepseek-aidsh-tool-web"></a>

## `@deepseek-ai/dsh-tool-web`

### `web_fetch`

获取指定 HTTP(S) URL 的内容，并将其解码为文本后返回。

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The HTTP(S) URL to fetch."
    }
  },
  "required": [
    "url"
  ]
}
```

来源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

### `web_search`

在 Web 上搜索最新信息。在必填的 `queries` 数组中提供 1–4 个查询。返回可选的摘要答案和来源 URL 列表。

```json
{
  "type": "object",
  "properties": {
    "queries": {
      "type": "array",
      "description": "Required search queries; accepts 1–4 items and merges their results.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "queries"
  ]
}
```

来源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

web_search 和 web_fetch 将提供方选择置于 ctx.web 之后，使模型可见 schema 在更换后端时保持稳定。
