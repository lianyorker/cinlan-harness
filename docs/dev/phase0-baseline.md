# Phase 0：基线与契约冻结

> 只读盘点，不写业务代码。
> 日期：2026-09-09
> 仓库：main (cinlan-harness) / staged-final (b84814d3) / integration (20260909)

---

## 0.1 Package Manifest 差异表

### 统计

| 仓库 | 包数 |
|------|------|
| main | 272 |
| staged-final | 296 |
| integration | 290 |

### A. staged-final 独有（不在 main，不在 integration）— 62 包

这些包只存在于 staged-final，是 main 完全缺失的独立能力。

| 能力组 | 包名 | 角色 |
|--------|------|------|
| **Artifact** | `dsh-artifact` | Service Definition |
| | `dsh-artifact-local` | Provider |
| **Execution Host** | `dsh-execution-host` | Service Definition |
| | `dsh-execution-host-local` | Provider |
| | `dsh-execution-host-bind` | Consumer |
| | `dsh-execution-host-ssh` | Provider |
| | `dsh-execution-host-ssh-bundle` | Bundle |
| **Git** | `dsh-git` | Service Definition |
| | `dsh-git-local` | Provider |
| | `dsh-tool-git` | Tool Consumer |
| **Security** | `dsh-assessment-scope` | Service Definition |
| | `dsh-assessment-scope-session` | Provider |
| | `dsh-assessment-scope-static` | Provider |
| | `dsh-finding` | Service Definition |
| | `dsh-finding-session` | Provider |
| | `dsh-security-workflow` | Bundle |
| | `dsh-security-workflow-prompt` | Prompt |
| | `dsh-security-findings` | Bundle |
| | `dsh-security-skills-bundle` | Bundle |
| | `dsh-tool-finding` | Tool Consumer |
| | `dsh-tool-vuln-kb` | Tool Consumer |
| | `dsh-vuln-kb` | Service Definition |
| | `dsh-vuln-kb-nvd` | Provider |
| | `dsh-vuln-kb-service` | Service |
| **Computer Use** | `dsh-computer-use` | Service Definition |
| | `dsh-computer-use-cinlan` | Provider |
| | `dsh-computer-use-permission-policy` | Permission Policy |
| | `dsh-tool-computer-use` | Tool Consumer |
| | `dsh-cinlan-computer-use` | Bundle |
| **Mobile Device** | `dsh-mobile-device` | Service Definition |
| | `dsh-mobile-device-cinlan` | Provider |
| | `dsh-mobile-device-permission-policy` | Permission Policy |
| | `dsh-tool-mobile-device` | Tool Consumer |
| | `dsh-cinlan-mobile-device` | Bundle |
| **Design Studio** | `dsh-design-studio` | Service Definition |
| | `dsh-design-studio-local` | Provider |
| | `dsh-design-studio-prompt` | Prompt |
| | `dsh-design-studio-service` | Service |
| | `dsh-tool-design-studio` | Tool Consumer |
| | `dsh-client-ui-design-studio` | Client UI |
| **Voice** | `dsh-voice` | Service Definition |
| | `dsh-voice-sherpa-onnx` | Provider |
| | `dsh-client-ui-voice-dictation` | Client UI |
| **API/TUI** | `dsh-codex-app-server` | API Server |
| | `dsh-codex-app-server-harness` | Harness |
| | `dsh-tui` | TUI Base |
| | `dsh-codex-tui` | Codex TUI |
| | `dsh-cinlan-tui` | Bundle |
| | `dsh-cinlan-codex-tui` | Bundle |
| | `dsh-host-apiproxy` | API Proxy |
| **Client** | `dsh-client-runtime` | Runtime Client |
| | `dsh-client-ui-settings-cinlan-capabilities` | Client UI |
| **Shared** | `dsh-agent-execution-guidance` | Preset Prompt |
| | `dsh-turn-budget-policy` | Guard Policy |
| | `dsh-session-persistence-sqlite` | Persistence Provider |
| | `dsh-tool-subagent-report` | Tool Consumer |
| | `dsh-web-permission-policy` | Permission Policy |
| | `dsh-acp-snapshot` | Test Support |
| | `dsh-acp-demo` | Example |
| | `dsh-agent-spine-demo` | Example |
| | `dsh-sdk-jsonrpc-demo` | Example |
| | `dsh-code-runtime-python` | Code Runtime (main 在 experimental/) |
| | `fixture-aggregate-better-sidebar` | Fixture |

### B. integration 独有（不在 main，不在 staged-final）— 15 包

| 能力组 | 包名 | 角色 | 说明 |
|--------|------|------|------|
| **Browser** | `dsh-browser-playwright` | Provider | Playwright 浏览器 Provider |
| | `dsh-tool-browser-element-capture` | Tool Consumer | 元素捕获工具 |
| | `dsh-coordination-browser-element-capture` | Executor | 元素捕获协调器 |
| | `dsh-client-ui-browser-element-capture` | Client UI | 元素捕获 UI |
| **Work Items** | `dsh-work-items` | Service Definition | 工作项能力 |
| | `dsh-work-items-github` | Provider | GitHub 工作项 |
| | `dsh-work-items-linear` | Provider | Linear 工作项 |
| | `dsh-tool-work-items` | Tool Consumer | 工作项工具 |
| | `dsh-api-work-items-controller` | API Controller | 工作项 API |
| | `dsh-client-ui-work-items` | Client UI | 工作项 UI |
| **Workspace Isolation** | `dsh-workspace-isolation` | Service Definition | 工作区隔离 |
| | `dsh-workspace-isolation-git` | Provider | Git 隔离 |
| | `dsh-api-workspace-isolation-controller` | API Controller | 隔离 API |
| | `dsh-client-ui-workspace-isolation` | Client UI | 隔离 UI |
| | `dsh-coordination-worktree-executor` | Executor | Worktree 执行器 |

### C. staged-final 和 integration 共有但 main 缺失 — 13 包

| 能力组 | 包名 | 来源 |
|--------|------|------|
| **Browser** | `dsh-browser` | Service Definition |
| | `dsh-browser-cinlan` | Provider |
| | `dsh-browser-permission-policy` | Permission Policy |
| | `dsh-tool-browser` | Tool Consumer |
| | `dsh-cinlan-browser` | Bundle |
| | `dsh-cinlan-web` | Bundle |
| **Coordination** | `dsh-coordination` | Service Definition |
| | `dsh-coordination-local` | Provider |
| | `dsh-coordination-subagent-executor` | Executor |
| | `dsh-tool-coordination` | Tool Consumer |
| **Security** | `dsh-security-skills` | Skills |
| **Client** | `dsh-client-ui-better-sidebar` | Client UI |
| | `dsh-client-ui-brand-cinlan` | Client UI |

### D. main 独有（不在 staged-final）— 52 包

这些是 main 的架构基线，**不得删除或替换**。

| 组 | 包名 | 说明 |
|----|------|------|
| API | `dsh-api-session-controller` | 分散式 API |
| | `dsh-api-settings-controller` | 分散式 API |
| | `dsh-api-workspace-controller` | 分散式 API |
| | `dsh-api-workspace-files` | 分散式 API |
| | `dsh-acp-app` | ACP 应用 |
| Auth | `dsh-authorization` | 授权能力 |
| Client | `dsh-client-file-upload` | 文件上传 |
| | `dsh-client-resources` | 资源管理 |
| | `dsh-client-store` | 状态存储 |
| | `dsh-client-ui-approval` | 审批 UI |
| | `dsh-client-ui-chat` | 聊天 UI |
| | `dsh-client-ui-dockkit` | DockKit |
| | `dsh-client-ui-open-in-app` | 应用内打开 |
| | `dsh-client-ui-schedule` | 调度 UI |
| | `dsh-client-ui-session` | 会话 UI |
| | `dsh-client-ui-sidebar-files` | 侧边栏文件 |
| | `dsh-client-ui-sidebar-right` | 右侧边栏 |
| | `dsh-client-ui-sidebar-textpreview` | 文本预览 |
| Experimental | `dsh-experimental-agent-team` | 代理团队 |
| | `dsh-experimental-agent-team-profile` | 团队 profile |
| | `dsh-experimental-agent-team-web-profile` | 团队 web profile |
| | `dsh-experimental-client-ui-agent-team` | 团队 UI |
| | `dsh-experimental-code-runtime-python` | Python 运行时 |
| | `dsh-experimental-inspector` | 检查器 |
| | `dsh-experimental-tool-agent-team` | 团队工具 |
| | `dsh-experimental-webworker-packer` | Webworker 打包 |
| | `dsh-experimental-webworker-runtime` | Webworker 运行时 |
| LLM | `dsh-deepseek-llm-api-extensions` | LLM 扩展 |
| | `dsh-plugin-package-inventory-deepseek` | 插件清单 |
| Session | `dsh-session-format` | 格式定义 |
| | `dsh-session-format-catalog` | 格式目录 |
| | `dsh-session-format-v0-to-v1` | 迁移 v0→v1 |
| | `dsh-session-format-v1-to-v2` | 迁移 v1→v2 |
| | `dsh-session-format-v2-to-v3` | 迁移 v2→v3 |
| | `dsh-session-log-deepseek` | DeepSeek 日志 |
| | `dsh-session-snapshot` | 会话快照 |
| | `dsh-session-turn-outline` | 轮次大纲 |
| Subagent | `dsh-subagent-claude-code` | Claude Code 子代理 |
| | `dsh-subagent-codex` | Codex 子代理 |
| Subprocess | `dsh-win32-process` | Win32 进程 |
| Util | `dsh-util-crypto` | 加密工具 |
| | `dsh-util-time` | 时间工具 |
| | `dsh-util-values` | 值工具 |
| | `dsh-util-workspace-path` | 工作区路径 |
| Webhook | `dsh-webhook` | Webhook 能力 |
| | `dsh-webhook-github` | GitHub Webhook |
| Host | `dsh-host-open-in-app` | 应用内打开 |
| | `dsh-http-proxy` | HTTP 代理 |
| | `dsh-package-manifest` | 包清单 |
| SDK | `dsh-sdk-app` | SDK 应用 |
| | `dsh-sdk-minimal` | 最小 SDK |

---

## 0.2 完整依赖 DAG

### 新增能力组的依赖关系

```text
execution-host
  ├── execution-host-local → subprocess, fs, shell
  ├── execution-host-ssh → subprocess, credentials
  └── execution-host-bind → execution-host

artifact
  └── artifact-local → fs

git
  ├── git-local → subprocess
  └── tool-git → git, agents, tools

coordination
  ├── coordination-local → subagent, agents
  ├── coordination-subagent-executor → subagent, coordination
  └── tool-coordination → coordination, tools

browser
  ├── browser-cinlan → subprocess, browser
  ├── browser-playwright (int) → browser
  ├── browser-permission-policy → sandbox-policy, tools
  ├── tool-browser → browser, tools
  ├── tool-browser-element-capture (int) → browser, coordination, tools
  └── coordination-browser-element-capture (int) → coordination, browser

computer-use
  ├── computer-use-cinlan → subprocess, computer-use
  ├── computer-use-permission-policy → sandbox-policy, tools
  └── tool-computer-use → computer-use, tools

mobile-device
  ├── mobile-device-cinlan → subprocess, mobile-device
  ├── mobile-device-permission-policy → sandbox-policy, tools
  └── tool-mobile-device → mobile-device, tools

security
  ├── assessment-scope → tools, credentials, execution-hosts
  ├── assessment-scope-session → assessment-scope, sessions
  ├── assessment-scope-static → assessment-scope
  ├── finding → artifacts, sessions
  ├── finding-session → finding, sessions
  ├── vuln-kb → vuln-kb-service
  ├── vuln-kb-nvd → vuln-kb-service
  ├── vuln-kb-service → storage
  ├── tool-finding → finding, tools
  ├── tool-vuln-kb → vuln-kb, tools
  ├── security-skills → skill, tools
  └── security-workflow-prompt → system-prompt

design-studio
  ├── design-studio-local → design-studio, fs
  ├── design-studio-prompt → system-prompt
  ├── design-studio-service → design-studio
  └── tool-design-studio → design-studio, tools

voice
  ├── voice-sherpa-onnx → voice, subprocess, host
  └── client-ui-voice-dictation → voice (client)

codex-app-server
  ├── codex-app-server → api controllers, sessions, settings, workspace
  ├── codex-app-server-harness → codex-app-server
  ├── host-apiproxy → codex-app-server
  ├── tui → agent, session, tools, approval, settings
  └── codex-tui → tui, codex-app-server

shared
  ├── turn-budget-policy → tools
  ├── agent-execution-guidance → system-prompt
  ├── session-persistence-sqlite → session-persistence, storage-sqlite
  ├── tool-subagent-report → subagents, tools, system-prompt
  └── web-permission-policy → sandbox-policy, tools
```

---

## 0.3 ctx 服务名和注入项表

### main 现有 ctx 服务（64 项）

```text
agentLoop, agentPresets, agents, agentTeams, approval, attachments, authorization,
clientBridge, codeRuntime, commands, commandUi, compaction, credentials,
deepseekLlmApiExtensions, demo, directoryPicker, e2b, fileReferences, fs, goals,
invariantProbe, invariants, jobs, llm, locale, lsp, messageFeedback,
modelDirectories, permissionPresets, planMode, sandbox, sandboxPolicy,
sessionLogDownload, sessionPersistence, sessionProjectionCache, sessionProjections,
sessionQuery, sessionReferenceResolver, sessions, sessionTelemetry, sessionTitle,
settings, settingsScope, shell, shellEnv, skills, spillStore, storage, storageDomain,
subagents, subprocess, systemPrompt, terminals, theme, tokenMeter, toolResultPruner,
tools, userQuestions, web, webhookRuntime, webServer, workflowEngine,
workspaceRegistry, writable
```

### staged-final 新增 ctx 服务（main 缺失）

| 服务名 | 来源包 | 说明 |
|--------|--------|------|
| `artifacts` | artifact | 产物存储 |
| `assessmentScope` | assessment-scope | 评估范围 |
| `assessmentScopeSessions` | assessment-scope-session | 评估范围会话 |
| `browser` | browser | 浏览器控制 |
| `codexAppServer` | codex-app-server | Codex API 服务器 |
| `computerUse` | computer-use | 桌面控制 |
| `coordination` | coordination | 任务协调 |
| `designStudio` | design-studio | 设计工作室 |
| `executionHostLocal` | execution-host-local | 本地执行主机 |
| `executionHosts` | execution-host | 执行主机 |
| `executionHostSsh` | execution-host-ssh | SSH 执行主机 |
| `findings` | finding | 安全发现 |
| `git` | git | Git 操作 |
| `mobileDevice` | mobile-device | 移动设备 |
| `tuiPrompt` | tui | TUI 提示词 |
| `voice` | voice | 语音识别 |
| `vulnKb` | vuln-kb | 漏洞知识库 |

### integration 新增 ctx 服务（main 缺失）

| 服务名 | 来源包 | 说明 |
|--------|--------|------|
| `browser` | browser | 浏览器控制 |
| `coordination` | coordination | 任务协调 |
| `workspaceIsolation` | workspace-isolation | 工作区隔离 |

### main 独有 ctx 服务（staged-final 缺失）

```text
agentTeams, authorization, clientBridge, deepseekLlmApiExtensions,
webhookRuntime, modelDirectories
```

### staged-final inject 数组新增项（main 缺失）

```text
artifacts, browser, codexAppServer, computerUse, conversation, conversationEvents,
conversationViews, coordination, designStudio, executionHosts, findings, git,
mobileDevice, tuiPrompt, voice, vulnKb, webRuntime, workspaces
```

---

## 0.4 Tool 名称和权限类表

### main 现有工具（73 个）

```text
__proto__, answer, ask_user_question, bash, cordis_define, cordis_inspect_list,
cordis_inspect_query, cordis_inspect_self, cordis_run, cordis_stop, cordis_undefine,
create_goal, deep_args, deep_output, demo, do_fetch, echo, edit, ephemeral,
finalize, get_goal, glob, greet, greet_undeclared, grep, interrupt_agent, job_kill,
job_list, job_output, list_agents, list_subagent_models, lsp, mixed, noop, probe,
probe_instanceof, probe_unknown, projected, pwsh, ralph, read, read_image,
report_view, reverse_text, roundtrip, schedule_create, schedule_delete,
schedule_list, send_message, session_event_read, session_event_search,
session_event_trace, session_search, session_trace, skill, spawn_teammate,
str_replace_editor, team_task_create, team_task_get, team_task_list,
team_task_update, terminal_close, terminal_list, terminal_open, terminal_read,
terminal_send, terminal_signal, todo_write, update_goal, wait_agent, web_fetch,
web_search, write
```

### staged-final 新增工具（main 缺失）

| 工具名 | 来源包 | 权限类 |
|--------|--------|--------|
| `browser_click` | tool-browser | mutation |
| `browser_close` | tool-browser | mutation |
| `browser_list` | tool-browser | read-only |
| `browser_navigate` | tool-browser | mutation |
| `browser_open` | tool-browser | mutation |
| `browser_screenshot` | tool-browser | read-only |
| `browser_snapshot` | tool-browser | read-only |
| `code_wrapper` | code-runtime | mutation |
| `computer_accessibility` | tool-computer-use | read-only |
| `computer_keyboard` | tool-computer-use | mutation |
| `computer_list_apps` | tool-computer-use | read-only |
| `computer_list_windows` | tool-computer-use | read-only |
| `computer_observe` | tool-computer-use | read-only |
| `computer_pointer` | tool-computer-use | mutation |
| `coordination_add_task` | tool-coordination | mutation |
| `coordination_cancel` | tool-coordination | mutation |
| `coordination_send_message` | tool-coordination | mutation |
| `coordination_start` | tool-coordination | mutation |
| `coordination_status` | tool-coordination | read-only |
| `coordination_wait` | tool-coordination | read-only |
| `design_studio_create` | tool-design-studio | mutation |
| `design_studio_export` | tool-design-studio | read-only |
| `design_studio_list` | tool-design-studio | read-only |
| `design_studio_preview` | tool-design-studio | read-only |
| `design_studio_read` | tool-design-studio | read-only |
| `design_studio_update` | tool-design-studio | mutation |
| `finding_export` | tool-finding | read-only |
| `finding_query` | tool-finding | read-only |
| `finding_record` | tool-finding | mutation |
| `finding_transition` | tool-finding | mutation |
| `git_diff` | tool-git | read-only |
| `git_log` | tool-git | read-only |
| `git_status` | tool-git | read-only |
| `mobile_button` | tool-mobile-device | mutation |
| `mobile_list_devices` | tool-mobile-device | read-only |
| `mobile_observe` | tool-mobile-device | read-only |
| `mobile_touch` | tool-mobile-device | mutation |
| `mobile_type` | tool-mobile-device | mutation |
| `report` | tool-subagent-report | mutation |
| `terminal_create` | tool-terminal (sf) | mutation |
| `terminal_resize` | tool-terminal (sf) | mutation |
| `terminal_wait_for` | tool-terminal (sf) | read-only |
| `vuln_query` | tool-vuln-kb | read-only |
| `vuln_read` | tool-vuln-kb | read-only |

### integration 新增工具（main 缺失，不在 staged-final）

| 工具名 | 来源包 | 权限类 |
|--------|--------|--------|
| `browser_capture_element` | tool-browser-element-capture | mutation |
| `browser_select_element` | tool-browser-element-capture | mutation |
| `work_items_cancel_write` | tool-work-items | mutation |
| `work_items_confirm_write` | tool-work-items | mutation |
| `work_items_get` | tool-work-items | read-only |
| `work_items_list` | tool-work-items | read-only |
| `work_items_list_writes` | tool-work-items | read-only |
| `work_items_prepare_write` | tool-work-items | mutation |

---

## 0.5 SessionEventMap / Projection / Persistence 兼容表

### main SessionEventMap 事件键（130+ 项）

main 的事件体系更完整，包含 staged-final 缺失的：

```text
agent/assistant-stream, assistant/attempt, client/probe, command/done, command/run,
compact/*, compaction/*, credentials/*, fetch/*, fixture/*, fs/promises,
gateway/*, hook/invoked, hook/result, host/probe, llm/retry-started, model/selection,
path/posix, probe/watch, schedule/change, session/agent-busy, session/attachment,
session/control, session/create, session/follow, session/fork, session/list,
session/page, session/rename, session/search, settings/*, source/*,
subagent/model-selection-policy, subagents/list, subagents/prompt, system/message,
team/*, tool/ptc-dispatch, tool/ptc-dispatch-start, tools/ptc-dispatch-log,
util/types, workspace/*
```

### staged-final 独有事件键（main 缺失）

| 事件键 | 来源 | 说明 |
|--------|------|------|
| `account/read` | codex-app-server | 账户读取 |
| `approval/requested` | codex-app-server | 审批请求 |
| `approval/resolved` | codex-app-server | 审批解决 |
| `hooks/list` | codex-app-server | Hooks 列表 |
| `host/agent-error` | codex-app-server | 主机代理错误 |
| `host/session-added` | codex-app-server | 主机会话添加 |
| `host/session-removed` | codex-app-server | 主机会话移除 |
| `host/session-status` | codex-app-server | 主机会话状态 |
| `model/list` | codex-app-server | 模型列表 |
| `question/requested` | codex-app-server | 问题请求 |
| `question/resolved` | codex-app-server | 问题解决 |
| `review/start` | codex-app-server | 审查开始 |
| `session/queue` | codex-app-server | 会话队列 |
| `session/subscribed` | codex-app-server | 会话订阅 |
| `thread/*` | codex-app-server | 线程操作 |
| `tools/code-dispatch-log` | codex-app-server | 代码调度日志 |
| `turn/interrupt` | codex-app-server | 轮次中断 |
| `turn/steer` | codex-app-server | 轮次引导 |

### 关键差异

- staged-final 的 `assistant/chunk` 直接在 SessionEventMap 中，main 用 `agent/assistant-stream` + `assistant/attempt` 替代
- staged-final 的 `tool/call` 用 `CallId`，main 用 `ToolCallId`（branded type）
- staged-final 缺少 `compaction/*`、`gateway/*`、`source/*`、`settings/*` 事件
- staged-final 的 codex-app-server 事件是 RPC 层事件，不是 session 事件

### Persistence 兼容性

| 项 | main | staged-final |
|----|------|-------------|
| Session format | v0→v1→v2→v3 迁移链 | 无迁移链 |
| Persistence | JSONL + SQLite query | JSONL + SQLite persistence |
| SCHEMA_VERSION | 单调递增 | 独立 schema |
| Projection | 可插拔 registry | 可插拔 registry |
| Snapshot | session-snapshot 包 | acp-snapshot 包 |

---

## 0.6 Settings slots 和 Client contract 对照表

### main 现有 settings slots（42 项）

```text
conversation, conversation.approval.detail, conversation.chat.assistant-actions,
conversation.chat.node, conversation.chat.turnTail, conversation.composer,
conversation.composer.dock, conversation.hero.workspace,
conversation.hero.workspace.directoryFlow, conversation.input.attachments,
conversation.input.dock, conversation.input.model, conversation.input.overlay,
conversation.input.plan, conversation.message.images,
conversation.session.header.actions, conversation.session.header.corner,
conversation.session.header.lineage, conversation.session.header.utilities,
conversation.trajectory.images, conversation.view, rightbar, settings.action,
settings.close, settings.general.item, settings.header, settings.onboarding,
settings.plugin.item, settings.plugins.tab, settings.section, settings.trigger,
sidebar.brand.mark, sidebar.brand.name, sidebar.footer.action,
sidebar.right.pane.tab, sidebar.settings, sidebar.workspaces,
sidebar.workspaces.directoryFlow, t.host, tool.call.images, tool.call.toolview
```

### staged-final 新增 slots（main 缺失）

| Slot 名 | 来源 | 说明 |
|---------|------|------|
| `conversation.details.tool` | client-runtime | 对话详情工具 |
| `conversation.hero.brand.mark` | client-runtime | 品牌标记 |
| `conversation.input.right` | client-runtime | 右侧输入 |
| `settings.section.icon` | ui-settings-cinlan-capabilities | 设置区域图标 |

### main 独有 slots（staged-final 缺失）

```text
conversation, conversation.approval.detail, conversation.composer.dock,
conversation.session.header.corner, conversation.session.header.lineage,
conversation.trajectory.images, rightbar, sidebar.right.pane.tab,
tool.call.images
```

### Settings register namespaces

| 仓库 | namespaces |
|------|-----------|
| main | `alpha`, `beta`, `editor`, `ui-theme`, `workspace` |
| staged-final | （通过不同机制注册，未检测到 `settings.register` 调用） |

### Client contract 差异

| 项 | main | staged-final |
|----|------|-------------|
| 状态管理 | `client/store` 分散式 | `client/runtime` 集中式 |
| 资源 | `client/resources` | 内嵌在 runtime |
| 模块 | `client/modules` | 内嵌在 runtime |
| UI 组件 | 分散小包 | runtime 内置 |
| 侧边栏 | `ui-sidebar*` 分散 | `ui-better-sidebar` 统一 |

---

## 0.7 Bundle / profile 装配表

### main 现有 bundles（6 个）

```text
acp-app, base, headless, sdk-app, sdk-minimal, web-app
```

### staged-final bundles（15 个）

```text
base, cinlan-browser, cinlan-codex-tui, cinlan-computer-use,
cinlan-mobile-device, cinlan-tui, cinlan-web, design-studio,
execution-host-ssh, headless, security-findings, security-skills,
security-workflow, vuln-kb, web-app
```

### integration bundles（8 个）

```text
acp-app, base, cinlan-browser, cinlan-web, headless, sdk-app,
sdk-minimal, web-app
```

### 需要新增的 bundles（12 个）

| Bundle | 来源 | 包含能力 |
|--------|------|---------|
| `cinlan-browser` | sf+int | browser + browser-cinlan + tool-browser + permission-policy |
| `cinlan-computer-use` | sf | computer-use + cinlan + tool + permission-policy |
| `cinlan-mobile-device` | sf | mobile-device + cinlan + tool + permission-policy |
| `cinlan-tui` | sf | tui |
| `cinlan-codex-tui` | sf | codex-tui + codex-app-server |
| `cinlan-web` | sf+int | web-permission-policy |
| `design-studio` | sf | design-studio + local + prompt + tool |
| `execution-host-ssh` | sf | execution-host-ssh |
| `security-findings` | sf | finding + finding-session + tool-finding |
| `security-skills` | sf | security-skills |
| `security-workflow` | sf | security-workflow-prompt + assessment-scope |
| `vuln-kb` | sf | vuln-kb + nvd + service + tool-vuln-kb |

### 不得删除的 main bundles

```text
acp-app, base, headless, sdk-app, sdk-minimal, web-app
```

---

## 0.8 Native / 外部依赖清单

### Native 模块

| 仓库 | native 目录 | 说明 |
|------|------------|------|
| main | `system` | 系统级 native addon |
| staged-final | `desktop` | 桌面控制 native |
| | `landlock-run` | Linux sandbox native |
| integration | （同 main） | |

**冲突**：staged-final 的 `desktop` 和 `landlock-run` native 模块需要迁移，但不能替换 main 的 `system`。

### Patches

| 仓库 | patch | 说明 |
|------|-------|------|
| main | `@yao-pkg__pkg@6.21.0.patch` | pkg 打包 |
| | `node-pty@1.2.0-beta.15.patch` | node-pty |
| staged-final | `@earendil-works__pi-tui@0.80.7.patch` | **TUI 依赖** |
| | `node-pty@1.1.0.patch` | 旧版 node-pty |
| | `node-pty@1.2.0-beta.15.patch` | 同 main |

**需要新增**：`@earendil-works__pi-tui@0.80.7.patch`（TUI 依赖必需）

### 外部依赖差异

| 依赖 | main | staged-final | 说明 |
|------|------|-------------|------|
| `@agentclientprotocol/sdk` | ❌ | ✅ | ACP SDK（codex-app-server） |
| `@earendil-works/pi-tui` | ❌ | ✅ | TUI 框架 |
| `node-pty` | ❌ (root) | ✅ (root) | PTY 依赖 |
| `knip` | ❌ | ✅ | 代码分析 |
| `@deepseek-ai/dsh-agent` | ✅ | ❌ | main 独有 |
| `@yao-pkg/pkg` | ✅ | ❌ | 打包 |
| `@types/spdx-expression-parse` | ✅ | ✅ | |
| `mermaid` | ✅ | ✅ | |

---

## 0.9 需要适配的旧 API 清单

### A. codex-app-server RPC → main controller 映射

| RPC 域 | staged-final 实现 | main 适配目标 |
|--------|-------------------|-------------|
| sessions | 内嵌 session 管理 | `api/session-controller` |
| settings | 内嵌 settings 管理 | `api/settings-controller` |
| workspace | 内嵌 workspace 管理 | `api/workspace-controller` |
| workspace files | 内嵌 | `api/workspace-files` |
| subagents | 内嵌 | `subagent` service |
| goals | 内嵌 | `goal` service |
| jobs | 内嵌 | `jobs` service |
| skills | 内嵌 | `skill` service |
| approvals | 内嵌 | `user-approval` service |
| credentials | 内嵌 | `credentials` service |

### B. Session format 差异

| 项 | main | staged-final | 适配方式 |
|----|------|-------------|---------|
| `assistant/chunk` | ❌ 用 `agent/assistant-stream` | ✅ 直接事件 | codex-app-server 做转换 |
| `assistant/attempt` | ✅ | ❌ | codex-app-server 忽略 |
| `tool/call` CallId | `ToolCallId` (branded) | `CallId` (plain) | 类型映射 |
| `system/message` | ✅ | ❌ | codex-app-server 补充 |
| `todo/write` | ❌ (在 tool result) | ✅ (session event) | 保留 main 方式 |
| `request/header` | 有 `startsSeries` | 无 `startsSeries` | 适配 |

### C. client/runtime 兼容层边界

| 项 | main 方式 | client/runtime 方式 | 兼容策略 |
|----|---------|-------------------|---------|
| 状态管理 | `client/store` | 内嵌 store | runtime 调用 store，不替换 |
| 资源 | `client/resources` | 内嵌 | runtime 调用 resources |
| 模块 | `client/modules` | 内嵌 | runtime 调用 modules |
| UI slots | `client/ui-slots` | 内嵌 | runtime 注册到 ui-slots |
| 设置 | `client/ui-settings` | 内嵌 | runtime 调用 ui-settings |

### D. SQLite 持久化适配

| 项 | main | staged-final | 适配方式 |
|----|------|-------------|---------|
| 持久化协调器 | `SessionPersistence` | 相同接口 | 直接接入 |
| 格式迁移 | v0→v1→v2→v3 | 无 | SQLite provider 不触碰迁移链 |
| 物理存储 | JSONL only | JSONL + SQLite | SQLite 作为可选 Provider |
| SCHEMA_VERSION | main 的 | staged-final 的 | 使用 main 的 SCHEMA_VERSION |

### E. TUI 适配

| 项 | main | staged-final | 适配方式 |
|----|------|-------------|---------|
| Agent Loop | 直接修改 | 通过插件 | TUI 作为 Consumer，不改 Loop |
| 会话持久化 | main 的 | TUI 复用 main 的 | 不创建第二套 |
| 启动 | `dsh` profile | `dsh` profile | 新增 cinlan-tui profile |

---

## 冻结决定

以下 6 项契约在 Phase 0 冻结，后续阶段不得更改：

### 1. Artifact 服务名和导出名

```text
ctx service name: artifacts
Service class: ArtifactStore
Provider: artifact-local
Methods: publish(), describe(), read()
Branded types: ArtifactId, ArtifactKind
```

### 2. Browser Element Capture 是否随 cinlan-browser 一起启用

**决定**：不随 `cinlan-browser` 默认启用。Element Capture 需要 integration 的 4 个额外包，作为可选 patch layer。

### 3. Playwright 是否作为可选 Provider

**决定**：是。`browser-playwright` 作为可选 Provider，不包含在默认 `cinlan-browser` bundle 中。

### 4. client/runtime 仅兼容层的边界

**决定**：
- `client/runtime` 可以恢复包入口和必要导出
- 只能调用 main 现有 `client/store`、`client/resources`、`client/modules`、`client/ui-slots`
- 不允许成为全局状态中心
- 不允许替换 main 的 `client/*` 包

### 5. codex-app-server 的 RPC 到 main controller 映射

**决定**：
- codex-app-server 只做 RPC schema + rpc-map + normalization
- 所有 RPC 调用委托给 main 现有 controllers 和 Service
- 不复制 Session、Settings、Workspace 实现
- `host/apiproxy` 只作为 RPC 适配模块

### 6. SQLite 与 main Session Persistence 的物理兼容方式

**决定**：
- `session-persistence-sqlite` 作为可选 Provider 接入 main 的 `SessionPersistence` 协调器
- 不覆盖 main 的 Session format 迁移链
- 不修改 main 的 `SCHEMA_VERSION`
- SQLite 使用独立的物理 schema，逻辑事件仍走 JSONL

---

## 总结

| 项 | 数量 |
|----|------|
| 需要新增的包（sf 独有） | 62 |
| 需要新增的包（int 独有） | 15 |
| 需要新增的包（sf+int 共有） | 13 |
| 总计需要新增 | **90 包** |
| main 独有（不得删除） | 52 |
| 新增 ctx 服务 | 17 |
| 新增工具 | 44+ |
| 新增 bundles | 12 |
| 新增 native 模块 | 2 |
| 新增 patches | 1 |
| 冻结决定 | 6 |
