<!-- 英文源文件由 scripts/gen-doc-graphs.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-doc-graphs` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/capability-seams.md` 重新记录配对。 -->

# 能力 Seams 与核心服务

[English](capability-seams.md) | 中文

服务可以是核心主干服务、可替换的能力 seam，也可以是组合包／组合点。下图展示了拥有服务声明的包、已知实现包，以及直接消费该服务的包。

```mermaid
flowchart LR
  pkg_artifact["artifact"]
  svc_artifacts["ctx.artifacts<br/>Artifact storage"]
  pkg_artifact_local["artifact-local"]
  pkg_artifact_memory["artifact-memory"]
  pkg_finding_session["finding-session"]
  pkg_tool_finding["tool-finding"]
  pkg_api_security_research_controller["api-security-research-controller"]
  pkg_assessment_scope["assessment-scope"]
  svc_assessmentScope["ctx.assessmentScope<br/>Assessment scope policy"]
  pkg_assessment_scope_static["assessment-scope-static"]
  pkg_assessment_scope_session["assessment-scope-session"]
  svc_assessmentScopeSessions["ctx.assessmentScopeSessions<br/>Session assessment grants"]
  pkg_assessment_scope_tool_policy["assessment-scope-tool-policy"]
  pkg_api_automation_controller["api-automation-controller"]
  svc_automationController["ctx.automationController<br/>Automation Remote controller"]
  pkg_client_ui_settings_automation["client-ui-settings-automation"]
  pkg_automation["automation"]
  svc_automationRuntime["ctx.automationRuntime<br/>Durable automation scheduling"]
  pkg_client_ui_better_sidebar["client-ui-better-sidebar"]
  svc_betterSidebar["ctx.betterSidebar<br/>Sidebar tab and viewer registry"]
  pkg_client_ui_plan["client-ui-plan"]
  pkg_client_ui_settings_terminal["client-ui-settings-terminal"]
  pkg_browser["browser"]
  svc_browser["ctx.browser<br/>Browser automation seam"]
  pkg_browser_cinlan["browser-cinlan"]
  pkg_browser_playwright["browser-playwright"]
  pkg_tool_browser["tool-browser"]
  pkg_tool_browser_element_capture["tool-browser-element-capture"]
  pkg_api_browser_controller["api-browser-controller"]
  pkg_coordination_browser_element_capture["coordination-browser-element-capture"]
  svc_browserController["ctx.browserController<br/>Browser Remote controller"]
  pkg_client_ui_settings_security["client-ui-settings-security"]
  pkg_client_ui_browser_element_capture["client-ui-browser-element-capture"]
  pkg_browser_use["browser-use"]
  svc_browserUse["ctx.browserUse<br/>Exclusive browser-use registration"]
  pkg_experimental_browser_use_stagehand_native["experimental-browser-use-stagehand-native"]
  pkg_experimental_browser_use_playwright_mcp["experimental-browser-use-playwright-mcp"]
  pkg_experimental_browser_use_chrome_devtools_mcp["experimental-browser-use-chrome-devtools-mcp"]
  pkg_computer_use["computer-use"]
  svc_computerUse["ctx.computerUse<br/>Computer interaction seam"]
  pkg_computer_use_cinlan["computer-use-cinlan"]
  pkg_experimental_computer_use_cua_driver_native["experimental-computer-use-cua-driver-native"]
  pkg_experimental_computer_use_cua_driver_mcp["experimental-computer-use-cua-driver-mcp"]
  pkg_tool_computer_use["tool-computer-use"]
  pkg_api_device_capabilities_controller["api-device-capabilities-controller"]
  pkg_coordination["coordination"]
  svc_coordination["ctx.coordination<br/>Coordinated task execution"]
  pkg_coordination_local["coordination-local"]
  pkg_tool_coordination["tool-coordination"]
  pkg_coordination_subagent_executor["coordination-subagent-executor"]
  svc_deviceCapabilitiesController["ctx.deviceCapabilitiesController<br/>Device capability Remote controller"]
  pkg_execution_host["execution-host"]
  svc_executionHost["ctx.executionHost<br/>Execution-host seam"]
  pkg_execution_host_local["execution-host-local"]
  pkg_execution_host_worker["execution-host-worker"]
  pkg_execution_host_targets["execution-host-targets"]
  pkg_api_execution_host_controller["api-execution-host-controller"]
  svc_executionHostController["ctx.executionHostController<br/>Execution-host Remote controller"]
  pkg_client_ui_settings_hosts["client-ui-settings-hosts"]
  svc_executionHostTargets["ctx.executionHostTargets<br/>Saved execution targets"]
  pkg_finding["finding"]
  svc_findings["ctx.findings<br/>Assessment findings seam"]
  pkg_git["git"]
  svc_git["ctx.git<br/>Read-only Git inspection"]
  pkg_git_local["git-local"]
  pkg_tool_git["tool-git"]
  pkg_api_integration_preflight_controller["api-integration-preflight-controller"]
  svc_integrationPreflightController["ctx.integrationPreflightController<br/>Integration preflight Remote controller"]
  pkg_client_ui_integrations["client-ui-integrations"]
  pkg_client_ui_work_items["client-ui-work-items"]
  pkg_api_mcp_controller["api-mcp-controller"]
  svc_mcpController["ctx.mcpController<br/>MCP management Remote controller"]
  pkg_client_ui_settings_mcp["client-ui-settings-mcp"]
  pkg_mcp_management["mcp-management"]
  svc_mcpManagement["ctx.mcpManagement<br/>Persistent MCP management"]
  pkg_mcp_client["mcp-client"]
  svc_mcpRegistry["ctx.mcpRegistry<br/>Profile MCP observations"]
  pkg_mcp_resources["mcp-resources"]
  svc_mcpResources["ctx.mcpResources<br/>MCP resource registry"]
  pkg_mobile_device["mobile-device"]
  svc_mobileDevice["ctx.mobileDevice<br/>Mobile device seam"]
  pkg_mobile_device_cinlan["mobile-device-cinlan"]
  pkg_tool_mobile_device["tool-mobile-device"]
  pkg_office_to_pdf["office-to-pdf"]
  svc_officeToPdf["ctx.officeToPdf<br/>Workspace document previews"]
  pkg_plugin_manager["plugin-manager"]
  svc_pluginManagementHost["ctx.pluginManagementHost<br/>Launcher-owned plugin management facts"]
  pkg_host_plugin_inventory["host-plugin-inventory"]
  pkg_ptc_runtime["ptc-runtime"]
  svc_ptcRuntime["ctx.ptcRuntime<br/>Programmatic tool runtime"]
  pkg_ptc_runtime_node["ptc-runtime-node"]
  pkg_tools["tools"]
  pkg_workflow_ptc["workflow-ptc"]
  svc_securityResearchController["ctx.securityResearchController<br/>Security research Remote controller"]
  pkg_security_skills["security-skills"]
  svc_securitySkillResources["ctx.securitySkillResources<br/>Security skill resources"]
  pkg_command_feedback["command-feedback"]
  svc_sessionFeedback["ctx.sessionFeedback<br/>Human Session feedback"]
  pkg_client_ui_message_feedback["client-ui-message-feedback"]
  pkg_sidebar_git["sidebar-git"]
  svc_sidebarGit["ctx.sidebarGit<br/>Sidebar Git operations"]
  pkg_api_sidebar_git_controller["api-sidebar-git-controller"]
  svc_sidebarGitController["ctx.sidebarGitController<br/>Sidebar Git Remote controller"]
  pkg_api_sidebar_terminal_controller["api-sidebar-terminal-controller"]
  svc_sidebarTerminalController["ctx.sidebarTerminalController<br/>Sidebar terminal Remote controller"]
  pkg_sidebar_terminals["sidebar-terminals"]
  svc_sidebarTerminals["ctx.sidebarTerminals<br/>Sidebar terminal seam"]
  pkg_ssh["ssh"]
  svc_ssh["ctx.ssh<br/>SSH connection lifecycle"]
  pkg_fs_ssh["fs-ssh"]
  pkg_subprocess_ssh["subprocess-ssh"]
  pkg_sandbox_ssh["sandbox-ssh"]
  pkg_api_terminal_controller["api-terminal-controller"]
  svc_terminalController["ctx.terminalController<br/>Agent terminal Remote controller"]
  pkg_client_ui_right_sidebar["client-ui-right-sidebar"]
  pkg_api_usage_controller["api-usage-controller"]
  svc_usageController["ctx.usageController<br/>Usage Remote controller"]
  pkg_client_ui_settings_usage["client-ui-settings-usage"]
  pkg_usage_query["usage-query"]
  svc_usageQuery["ctx.usageQuery<br/>Session usage aggregation"]
  pkg_voice["voice"]
  svc_voice["ctx.voice<br/>Voice transcription seam"]
  pkg_voice_sherpa_onnx["voice-sherpa-onnx"]
  pkg_api_voice_controller["api-voice-controller"]
  svc_voiceController["ctx.voiceController<br/>Voice Remote controller"]
  pkg_client_ui_voice_dictation["client-ui-voice-dictation"]
  pkg_vuln_kb_service["vuln-kb-service"]
  svc_vulnKb["ctx.vulnKb<br/>Vulnerability knowledge seam"]
  pkg_vuln_kb_nvd["vuln-kb-nvd"]
  pkg_tool_vuln_kb["tool-vuln-kb"]
  pkg_workspace_isolation["workspace-isolation"]
  svc_workspaceIsolation["ctx.workspaceIsolation<br/>Workspace isolation seam"]
  pkg_workspace_isolation_git["workspace-isolation-git"]
  pkg_api_session_controller["api-session-controller"]
  pkg_api_workspace_isolation_controller["api-workspace-isolation-controller"]
  pkg_api_work_items_controller["api-work-items-controller"]
  pkg_workspace["workspace"]
  svc_workspaceIsolationController["ctx.workspaceIsolationController<br/>Workspace isolation Remote controller"]
  pkg_client_ui_workspace_isolation["client-ui-workspace-isolation"]
  pkg_worktree_task["worktree-task"]
  svc_worktreeTask["ctx.worktreeTask<br/>Worktree task seam"]
  pkg_worktree_task_git["worktree-task-git"]
  pkg_api_worktree_task_controller["api-worktree-task-controller"]
  svc_worktreeTaskController["ctx.worktreeTaskController<br/>Worktree task Remote controller"]
  pkg_client_ui_worktree_task["client-ui-worktree-task"]
  svc_pluginManager["ctx.pluginManager<br/>Profile plugin and bundle management"]
  pkg_client_ui_plugin_manager["client-ui-plugin-manager"]
  pkg_app_boot["app-boot"]
  svc_profileContext["ctx.profileContext<br/>Launcher-provided profile facts"]
  pkg_workspace_changes["workspace-changes"]
  svc_workspaceChanges["ctx.workspaceChanges<br/>Per-turn workspace file changes"]
  pkg_client_ui_deliverables["client-ui-deliverables"]
  pkg_work_items["work-items"]
  svc_workItems["ctx.workItems<br/>Work Items provider registry and write ledger"]
  pkg_work_items_github["work-items-github"]
  pkg_work_items_linear["work-items-linear"]
  pkg_tool_work_items["tool-work-items"]
  svc_workItemsController["ctx.workItemsController<br/>Work Items Remote controller"]
  pkg_attachment["attachment"]
  svc_attachments["ctx.attachments<br/>Durable binary attachment storage"]
  pkg_attachment_local["attachment-local"]
  pkg_tool_fs["tool-fs"]
  pkg_llm_pi_ai["llm-pi-ai"]
  pkg_llm_deepseek["llm-deepseek"]
  pkg_client_file_upload["client-file-upload"]
  svc_fileUploads["ctx.fileUploads<br/>Agent-scoped staged file uploads"]
  pkg_llm["llm"]
  svc_llm["ctx.llm<br/>LLM adapter registry"]
  pkg_llm_replay["llm-replay"]
  pkg_agent_loop["agent-loop"]
  pkg_compaction_basic["compaction-basic"]
  pkg_deepseek_llm_api_extensions["deepseek-llm-api-extensions"]
  svc_deepseekLlmApiExtensions["ctx.deepseekLlmApiExtensions<br/>Official DeepSeek request extensions"]
  pkg_session_log_deepseek["session-log-deepseek"]
  pkg_plugin_package_inventory_deepseek["plugin-package-inventory-deepseek"]
  pkg_token_meter["token-meter"]
  svc_tokenMeter["ctx.tokenMeter<br/>Replay token measurement"]
  pkg_compaction_tool_result_pruner["compaction-tool-result-pruner"]
  svc_toolResultPruner["ctx.toolResultPruner<br/>Model-free tool-result pruning"]
  pkg_session["session"]
  svc_sessions["ctx.sessions<br/>In-memory session store"]
  pkg_agent["agent"]
  pkg_session_persistence["session-persistence"]
  pkg_session_query["session-query"]
  pkg_session_query_sqlite["session-query-sqlite"]
  pkg_subagent_in_process_driver["subagent-in-process-driver"]
  pkg_invariants["invariants"]
  pkg_message_feedback["message-feedback"]
  svc_sessionController["ctx.sessionController<br/>Host Session Remote controller"]
  svc_sessionFileReferences["ctx.sessionFileReferences<br/>Session-addressed file-reference Remote adapter"]
  svc_sessionSkillCatalog["ctx.sessionSkillCatalog<br/>Session-addressed skill Remote adapter"]
  pkg_api_settings_controller["api-settings-controller"]
  svc_credentialsController["ctx.credentialsController<br/>Host credential-surface Remote controller"]
  svc_settingsController["ctx.settingsController<br/>Host settings-surface Remote controller"]
  pkg_api_workspace_files["api-workspace-files"]
  svc_workspaceFiles["ctx.workspaceFiles<br/>Host workspace file Remote service"]
  pkg_api_workspace_controller["api-workspace-controller"]
  svc_workspaceController["ctx.workspaceController<br/>Host Workspace Remote controller"]
  svc_directoryPickerController["ctx.directoryPickerController<br/>Host directory-picking Remote controller"]
  svc_invariants["ctx.invariants<br/>Package-owned invariant registry"]
  pkg_scope["scope"]
  pkg_typert_registry["typert-registry"]
  svc_typert["ctx.typert<br/>Runtime type registry"]
  pkg_typert_loader["typert-loader"]
  pkg_api_gateway["api-gateway"]
  svc_typertGateway["ctx.typertGateway<br/>Typert Host invocation gateway"]
  svc_sessionPersistence["ctx.sessionPersistence<br/>Durable session persistence seam"]
  pkg_session_persistence_jsonl["session-persistence-jsonl"]
  pkg_tool_bash["tool-bash"]
  pkg_hooks_claude_code["hooks-claude-code"]
  pkg_hooks_codex["hooks-codex"]
  pkg_settings["settings"]
  svc_settings["ctx.settings<br/>User-settings seam"]
  pkg_settings_file["settings-file"]
  pkg_tool_subagent["tool-subagent"]
  svc_subagentModelSelection["ctx.subagentModelSelection<br/>Subagent model-selection preference"]
  pkg_credentials["credentials"]
  svc_credentials["ctx.credentials<br/>Credential seam"]
  pkg_credentials_local["credentials-local"]
  pkg_authorization["authorization"]
  svc_authorization["ctx.authorization<br/>Authorization flow registry"]
  pkg_session_telemetry["session-telemetry"]
  svc_sessionTelemetry["ctx.sessionTelemetry<br/>Session telemetry seam"]
  pkg_session_telemetry_otel["session-telemetry-otel"]
  pkg_storage["storage"]
  svc_storage["ctx.storage<br/>Non-session storage hub"]
  pkg_storage_json["storage-json"]
  pkg_storage_sqlite["storage-sqlite"]
  pkg_storage_domain["storage-domain"]
  svc_storageDomain["ctx.storageDomain<br/>Domain data facility"]
  svc_messageFeedback["ctx.messageFeedback<br/>Lifecycle-bound message feedback"]
  svc_workspaceRegistry["ctx.workspaceRegistry<br/>Workspace entity registry"]
  svc_sessionQuery["ctx.sessionQuery<br/>Session reads, traces, filters, and search"]
  pkg_session_reference["session-reference"]
  pkg_tool_session_query["tool-session-query"]
  pkg_file_reference["file-reference"]
  svc_fileReferences["ctx.fileReferences<br/>File reference discovery"]
  pkg_file_reference_local["file-reference-local"]
  svc_sessionReferenceResolver["ctx.sessionReferenceResolver<br/>Cross-session snapshot preparation"]
  pkg_session_title["session-title"]
  svc_sessionTitle["ctx.sessionTitle<br/>Log-backed session titles"]
  pkg_session_title_first_prompt_llm["session-title-first-prompt-llm"]
  pkg_session_title_all_prompts_llm["session-title-all-prompts-llm"]
  pkg_system_prompt["system-prompt"]
  svc_systemPrompt["ctx.systemPrompt<br/>System prompt assembly registry"]
  pkg_tool_terminal["tool-terminal"]
  pkg_tool_web["tool-web"]
  svc_tools["ctx.tools<br/>Tool registry and guarded execution pipeline"]
  pkg_tool_ask_user["tool-ask-user"]
  pkg_tool_cordis["tool-cordis"]
  pkg_tool_skill["tool-skill"]
  pkg_tool_todo["tool-todo"]
  pkg_user_questions["user-questions"]
  svc_userQuestions["ctx.userQuestions<br/>Human question/answer seam"]
  pkg_plan_mode["plan-mode"]
  svc_planMode["ctx.planMode<br/>Plan collaboration state"]
  pkg_agent_presets["agent-presets"]
  svc_agentPresets["ctx.agentPresets<br/>Per-session agent composition"]
  pkg_commands["commands"]
  svc_commands["ctx.commands<br/>Human command registry"]
  pkg_session_projection["session-projection"]
  svc_sessionProjections["ctx.sessionProjections<br/>Session projection units"]
  pkg_session_projection_cache["session-projection-cache"]
  svc_sessionProjectionCache["ctx.sessionProjectionCache<br/>Persisted projection cache"]
  pkg_subagent["subagent"]
  pkg_skill["skill"]
  svc_skills["ctx.skills<br/>Skill provider registry"]
  pkg_skill_badge["skill-badge"]
  pkg_skill_filesystem["skill-filesystem"]
  svc_agents["ctx.agents<br/>Agent service"]
  pkg_acp["acp"]
  pkg_agent_default_model["agent-default-model"]
  svc_agentDefaultModel["ctx.agentDefaultModel<br/>Default Agent model selection"]
  pkg_headless["headless"]
  svc_agentLoop["ctx.agentLoop<br/>Concrete loop driver"]
  pkg_base["base"]
  pkg_sdk_minimal["sdk-minimal"]
  pkg_goal["goal"]
  svc_goals["ctx.goals<br/>Same-session goal domain"]
  pkg_e2b["e2b"]
  svc_e2b["ctx.e2b<br/>E2B sandbox lifecycle owner"]
  pkg_fs_e2b["fs-e2b"]
  pkg_subprocess_e2b["subprocess-e2b"]
  pkg_subprocess["subprocess"]
  svc_subprocess["ctx.subprocess<br/>Subprocess seam"]
  pkg_subprocess_local["subprocess-local"]
  pkg_bash_local["bash-local"]
  pkg_bash_sandbox["bash-sandbox"]
  pkg_terminal_bash["terminal-bash"]
  pkg_lsp_stdio["lsp-stdio"]
  pkg_subagent_acp["subagent-acp"]
  pkg_subagent_codex["subagent-codex"]
  pkg_subagent_claude_code["subagent-claude-code"]
  pkg_shell["shell"]
  svc_shell["ctx.shell<br/>Bash executor seam"]
  pkg_pwsh_local["pwsh-local"]
  pkg_tool_pwsh["tool-pwsh"]
  pkg_shell_env["shell-env"]
  svc_shellEnv["ctx.shellEnv<br/>Managed bash environment registry"]
  pkg_terminal["terminal"]
  svc_terminals["ctx.terminals<br/>Persistent PTY session registry"]
  pkg_sandbox["sandbox"]
  svc_sandbox["ctx.sandbox<br/>Process-sandbox seam"]
  pkg_sandbox_local["sandbox-local"]
  pkg_sandbox_policy["sandbox-policy"]
  svc_sandboxPolicy["ctx.sandboxPolicy<br/>Sandbox policy home"]
  pkg_fs_sandbox["fs-sandbox"]
  pkg_user_approval["user-approval"]
  svc_approval["ctx.approval<br/>Approval seam"]
  pkg_permission_presets["permission-presets"]
  svc_permissionPresets["ctx.permissionPresets<br/>Permission presets"]
  pkg_code_runtime["code-runtime"]
  svc_codeRuntime["ctx.codeRuntime<br/>Code-execution seam"]
  pkg_code_runtime_worker_thread["code-runtime-worker-thread"]
  pkg_experimental_code_runtime_python["experimental-code-runtime-python"]
  pkg_fs["fs"]
  svc_fs["ctx.fs<br/>Filesystem provider seam"]
  pkg_fs_local["fs-local"]
  pkg_fs_observation_policy["fs-observation-policy"]
  pkg_compaction["compaction"]
  svc_compaction["ctx.compaction<br/>Compaction seam"]
  svc_subagents["ctx.subagents<br/>Subagent provider and continuation service"]
  pkg_subagent_spawn_in_process["subagent-spawn-in-process"]
  pkg_subagent_fork_in_process["subagent-fork-in-process"]
  pkg_subagent_dsh_sdk["subagent-dsh-sdk"]
  pkg_tool_subagent_control["tool-subagent-control"]
  pkg_tool_ralph["tool-ralph"]
  pkg_experimental_agent_team["experimental-agent-team"]
  svc_agentTeams["ctx.agentTeams<br/>Agent Teams coordination domain"]
  pkg_experimental_tool_agent_team["experimental-tool-agent-team"]
  pkg_experimental_client_ui_agent_team["experimental-client-ui-agent-team"]
  pkg_inspector["inspector"]
  svc_inspector["ctx.inspector<br/>Cross-realm runtime inspection"]
  pkg_jobs["jobs"]
  svc_jobs["ctx.jobs<br/>Background job registry"]
  pkg_jobs_local["jobs-local"]
  pkg_tool_jobs["tool-jobs"]
  pkg_web["web"]
  svc_web["ctx.web<br/>Web access provider registry"]
  pkg_web_search_exa["web-search-exa"]
  pkg_web_search_perplexity["web-search-perplexity"]
  pkg_web_search_deepseek["web-search-deepseek"]
  pkg_web_fetch_http["web-fetch-http"]
  pkg_spill["spill"]
  svc_spillStore["ctx.spillStore<br/>Spill storage seam"]
  pkg_spill_local["spill-local"]
  pkg_spill_policy["spill-policy"]
  pkg_host_directory_picker["host-directory-picker"]
  svc_directoryPicker["ctx.directoryPicker<br/>Workspace-directory picking seam"]
  pkg_host_directory_picker_native["host-directory-picker-native"]
  pkg_host_directory_picker_browse["host-directory-picker-browse"]
  pkg_host_webserver["host-webserver"]
  svc_webServer["ctx.webServer<br/>HTTP route registration"]
  pkg_client_connection["client-connection"]
  pkg_client_modules["client-modules"]
  pkg_client_hmr["client-hmr"]
  svc_clientModules["ctx.clientModules<br/>Client plugin graph host"]
  pkg_workflow["workflow"]
  svc_workflowEngine["ctx.workflowEngine<br/>Workflow script engine"]
  pkg_tool_workflow["tool-workflow"]
  pkg_webhook["webhook"]
  svc_webhookRuntime["ctx.webhookRuntime<br/>Webhook rule runtime"]
  pkg_webhook_github["webhook-github"]
  pkg_lsp["lsp"]
  svc_lsp["ctx.lsp<br/>Language-server navigation seam"]
  pkg_tool_lsp["tool-lsp"]
  pkg_cordis_host_runner["cordis-host-runner"]
  svc_dynamicCordisRunner["ctx.dynamicCordisRunner<br/>Dynamic Cordis package host runner"]
  svc_cordisInspect["ctx.cordisInspect<br/>Dynamic Cordis inspect registry"]
  pkg_agent --> svc_agents
  pkg_agent_default_model --> svc_agentDefaultModel
  pkg_agent_loop --> svc_agentLoop
  pkg_agent_presets --> svc_agentPresets
  pkg_api_automation_controller --> svc_automationController
  pkg_api_browser_controller --> svc_browserController
  pkg_api_device_capabilities_controller --> svc_deviceCapabilitiesController
  pkg_api_execution_host_controller --> svc_executionHostController
  pkg_api_gateway --> svc_typertGateway
  pkg_api_integration_preflight_controller --> svc_integrationPreflightController
  pkg_api_mcp_controller --> svc_mcpController
  pkg_api_security_research_controller --> svc_securityResearchController
  pkg_api_session_controller --> svc_sessionController
  pkg_api_session_controller --> svc_sessionFileReferences
  pkg_api_session_controller --> svc_sessionSkillCatalog
  pkg_api_settings_controller --> svc_credentialsController
  pkg_api_settings_controller --> svc_settingsController
  pkg_api_sidebar_git_controller --> svc_sidebarGitController
  pkg_api_sidebar_terminal_controller --> svc_sidebarTerminalController
  pkg_api_terminal_controller --> svc_terminalController
  pkg_api_usage_controller --> svc_usageController
  pkg_api_voice_controller --> svc_voiceController
  pkg_api_work_items_controller --> svc_workItemsController
  pkg_api_workspace_controller --> svc_directoryPickerController
  pkg_api_workspace_controller --> svc_workspaceController
  pkg_api_workspace_files --> svc_workspaceFiles
  pkg_api_workspace_isolation_controller --> svc_workspaceIsolationController
  pkg_api_worktree_task_controller --> svc_worktreeTaskController
  pkg_app_boot --> svc_profileContext
  pkg_artifact --> svc_artifacts
  pkg_artifact_local --> svc_artifacts
  pkg_artifact_memory --> svc_artifacts
  pkg_assessment_scope --> svc_assessmentScope
  pkg_assessment_scope_session --> svc_assessmentScopeSessions
  pkg_assessment_scope_static --> svc_assessmentScope
  pkg_attachment --> svc_attachments
  pkg_attachment_local --> svc_attachments
  pkg_authorization --> svc_authorization
  pkg_automation --> svc_automationRuntime
  pkg_bash_local --> svc_shell
  pkg_bash_sandbox --> svc_shell
  pkg_browser --> svc_browser
  pkg_browser_cinlan --> svc_browser
  pkg_browser_playwright --> svc_browser
  pkg_browser_use --> svc_browserUse
  pkg_client_file_upload --> svc_fileUploads
  pkg_client_modules --> svc_clientModules
  pkg_client_ui_better_sidebar --> svc_betterSidebar
  pkg_client_ui_better_sidebar --> svc_sidebarTerminals
  pkg_code_runtime --> svc_codeRuntime
  pkg_code_runtime_worker_thread --> svc_codeRuntime
  pkg_command_feedback --> svc_sessionFeedback
  pkg_commands --> svc_commands
  pkg_compaction --> svc_compaction
  pkg_compaction_basic --> svc_compaction
  pkg_compaction_tool_result_pruner --> svc_toolResultPruner
  pkg_computer_use --> svc_computerUse
  pkg_computer_use_cinlan --> svc_computerUse
  pkg_coordination --> svc_coordination
  pkg_coordination_local --> svc_coordination
  pkg_cordis_host_runner --> svc_cordisInspect
  pkg_cordis_host_runner --> svc_dynamicCordisRunner
  pkg_credentials --> svc_credentials
  pkg_credentials_local --> svc_credentials
  pkg_deepseek_llm_api_extensions --> svc_deepseekLlmApiExtensions
  pkg_e2b --> svc_e2b
  pkg_execution_host --> svc_executionHost
  pkg_execution_host_local --> svc_executionHost
  pkg_execution_host_targets --> svc_executionHostTargets
  pkg_experimental_agent_team --> svc_agentTeams
  pkg_experimental_browser_use_chrome_devtools_mcp --> svc_browserUse
  pkg_experimental_browser_use_playwright_mcp --> svc_browserUse
  pkg_experimental_browser_use_stagehand_native --> svc_browserUse
  pkg_experimental_code_runtime_python --> svc_codeRuntime
  pkg_experimental_computer_use_cua_driver_mcp --> svc_computerUse
  pkg_experimental_computer_use_cua_driver_native --> svc_computerUse
  pkg_file_reference --> svc_fileReferences
  pkg_file_reference_local --> svc_fileReferences
  pkg_finding --> svc_findings
  pkg_finding_session --> svc_findings
  pkg_fs --> svc_fs
  pkg_fs_e2b --> svc_fs
  pkg_fs_local --> svc_fs
  pkg_fs_sandbox --> svc_fs
  pkg_git --> svc_git
  pkg_git_local --> svc_git
  pkg_goal --> svc_goals
  pkg_host_directory_picker --> svc_directoryPicker
  pkg_host_directory_picker_browse --> svc_directoryPicker
  pkg_host_directory_picker_native --> svc_directoryPicker
  pkg_host_webserver --> svc_webServer
  pkg_inspector --> svc_inspector
  pkg_invariants --> svc_invariants
  pkg_jobs --> svc_jobs
  pkg_jobs_local --> svc_jobs
  pkg_llm --> svc_llm
  pkg_llm_deepseek --> svc_llm
  pkg_llm_pi_ai --> svc_llm
  pkg_llm_replay --> svc_llm
  pkg_lsp --> svc_lsp
  pkg_lsp_stdio --> svc_lsp
  pkg_mcp_client --> svc_mcpRegistry
  pkg_mcp_client --> svc_mcpResources
  pkg_mcp_management --> svc_mcpManagement
  pkg_mcp_resources --> svc_mcpResources
  pkg_message_feedback --> svc_messageFeedback
  pkg_mobile_device --> svc_mobileDevice
  pkg_mobile_device_cinlan --> svc_mobileDevice
  pkg_office_to_pdf --> svc_officeToPdf
  pkg_permission_presets --> svc_permissionPresets
  pkg_plan_mode --> svc_planMode
  pkg_plugin_manager --> svc_pluginManagementHost
  pkg_plugin_manager --> svc_pluginManager
  pkg_plugin_package_inventory_deepseek --> svc_deepseekLlmApiExtensions
  pkg_ptc_runtime --> svc_ptcRuntime
  pkg_ptc_runtime_node --> svc_ptcRuntime
  pkg_pwsh_local --> svc_shell
  pkg_sandbox --> svc_sandbox
  pkg_sandbox_local --> svc_sandbox
  pkg_sandbox_policy --> svc_sandboxPolicy
  pkg_security_skills --> svc_securitySkillResources
  pkg_session --> svc_sessions
  pkg_session_log_deepseek --> svc_deepseekLlmApiExtensions
  pkg_session_persistence --> svc_sessionPersistence
  pkg_session_persistence_jsonl --> svc_sessionPersistence
  pkg_session_projection --> svc_sessionProjections
  pkg_session_projection_cache --> svc_sessionProjectionCache
  pkg_session_query --> svc_sessionQuery
  pkg_session_query_sqlite --> svc_sessionQuery
  pkg_session_reference --> svc_sessionReferenceResolver
  pkg_session_telemetry --> svc_sessionTelemetry
  pkg_session_telemetry_otel --> svc_sessionTelemetry
  pkg_session_title --> svc_sessionTitle
  pkg_session_title_all_prompts_llm --> svc_sessionTitle
  pkg_session_title_first_prompt_llm --> svc_sessionTitle
  pkg_settings --> svc_settings
  pkg_settings_file --> svc_settings
  pkg_shell --> svc_shell
  pkg_shell_env --> svc_shellEnv
  pkg_sidebar_git --> svc_sidebarGit
  pkg_sidebar_terminals --> svc_sidebarTerminals
  pkg_skill --> svc_skills
  pkg_skill_badge --> svc_skills
  pkg_skill_filesystem --> svc_skills
  pkg_spill --> svc_spillStore
  pkg_spill_local --> svc_spillStore
  pkg_ssh --> svc_ssh
  pkg_storage --> svc_storage
  pkg_storage_domain --> svc_storageDomain
  pkg_storage_json --> svc_storage
  pkg_storage_sqlite --> svc_storage
  pkg_subagent --> svc_subagents
  pkg_subagent_acp --> svc_subagents
  pkg_subagent_claude_code --> svc_subagents
  pkg_subagent_codex --> svc_subagents
  pkg_subagent_dsh_sdk --> svc_subagents
  pkg_subagent_fork_in_process --> svc_subagents
  pkg_subagent_spawn_in_process --> svc_subagents
  pkg_subprocess --> svc_subprocess
  pkg_subprocess_e2b --> svc_subprocess
  pkg_subprocess_local --> svc_subprocess
  pkg_system_prompt --> svc_systemPrompt
  pkg_terminal --> svc_terminals
  pkg_terminal_bash --> svc_terminals
  pkg_token_meter --> svc_tokenMeter
  pkg_tool_subagent --> svc_subagentModelSelection
  pkg_tools --> svc_tools
  pkg_typert_registry --> svc_typert
  pkg_usage_query --> svc_usageQuery
  pkg_user_approval --> svc_approval
  pkg_user_questions --> svc_userQuestions
  pkg_voice --> svc_voice
  pkg_voice_sherpa_onnx --> svc_voice
  pkg_vuln_kb_nvd --> svc_vulnKb
  pkg_vuln_kb_service --> svc_vulnKb
  pkg_web --> svc_web
  pkg_web_fetch_http --> svc_web
  pkg_web_search_deepseek --> svc_web
  pkg_web_search_exa --> svc_web
  pkg_web_search_perplexity --> svc_web
  pkg_webhook --> svc_webhookRuntime
  pkg_work_items --> svc_workItems
  pkg_work_items_github --> svc_workItems
  pkg_work_items_linear --> svc_workItems
  pkg_workflow --> svc_workflowEngine
  pkg_workflow_ptc --> svc_workflowEngine
  pkg_workspace --> svc_workspaceRegistry
  pkg_workspace_changes --> svc_workspaceChanges
  pkg_workspace_isolation --> svc_workspaceIsolation
  pkg_workspace_isolation_git --> svc_workspaceIsolation
  pkg_worktree_task --> svc_worktreeTask
  pkg_worktree_task_git --> svc_worktreeTask
  svc_agentDefaultModel --> pkg_api_session_controller
  svc_agentDefaultModel --> pkg_headless
  svc_agentLoop --> pkg_base
  svc_agentLoop --> pkg_sdk_minimal
  svc_agentTeams --> pkg_experimental_client_ui_agent_team
  svc_agentTeams --> pkg_experimental_tool_agent_team
  svc_agents --> pkg_acp
  svc_agents --> pkg_agent_loop
  svc_agents --> pkg_subagent_in_process_driver
  svc_approval --> pkg_acp
  svc_approval --> pkg_tool_bash
  svc_approval --> pkg_tools
  svc_artifacts --> pkg_api_security_research_controller
  svc_artifacts --> pkg_finding_session
  svc_artifacts --> pkg_tool_finding
  svc_assessmentScope --> pkg_api_security_research_controller
  svc_assessmentScope --> pkg_assessment_scope_session
  svc_assessmentScopeSessions --> pkg_api_security_research_controller
  svc_assessmentScopeSessions --> pkg_assessment_scope_tool_policy
  svc_assessmentScopeSessions --> pkg_tool_finding
  svc_attachments --> pkg_api_session_controller
  svc_attachments --> pkg_llm_deepseek
  svc_attachments --> pkg_llm_pi_ai
  svc_attachments --> pkg_tool_fs
  svc_authorization --> pkg_llm_pi_ai
  svc_automationController --> pkg_client_ui_settings_automation
  svc_automationRuntime --> pkg_api_automation_controller
  svc_betterSidebar --> pkg_client_ui_plan
  svc_betterSidebar --> pkg_client_ui_settings_terminal
  svc_browser --> pkg_api_browser_controller
  svc_browser --> pkg_coordination_browser_element_capture
  svc_browser --> pkg_tool_browser
  svc_browser --> pkg_tool_browser_element_capture
  svc_browserController --> pkg_client_ui_browser_element_capture
  svc_browserController --> pkg_client_ui_settings_security
  svc_clientModules --> pkg_client_hmr
  svc_codeRuntime --> pkg_tools
  svc_compaction --> pkg_compaction_basic
  svc_computerUse --> pkg_api_device_capabilities_controller
  svc_computerUse --> pkg_tool_computer_use
  svc_coordination --> pkg_coordination_browser_element_capture
  svc_coordination --> pkg_coordination_subagent_executor
  svc_coordination --> pkg_tool_browser_element_capture
  svc_coordination --> pkg_tool_coordination
  svc_cordisInspect --> pkg_tool_cordis
  svc_credentials --> pkg_api_settings_controller
  svc_credentials --> pkg_llm_deepseek
  svc_credentials --> pkg_llm_pi_ai
  svc_deepseekLlmApiExtensions --> pkg_llm_deepseek
  svc_deviceCapabilitiesController --> pkg_client_ui_settings_security
  svc_directoryPicker --> pkg_api_workspace_controller
  svc_dynamicCordisRunner --> pkg_tool_cordis
  svc_e2b --> pkg_fs_e2b
  svc_e2b --> pkg_subprocess_e2b
  svc_executionHost --> pkg_artifact_local
  svc_executionHost --> pkg_artifact_memory
  svc_executionHost --> pkg_execution_host_targets
  svc_executionHost --> pkg_execution_host_worker
  svc_executionHost --> pkg_tool_finding
  svc_executionHostController --> pkg_client_ui_settings_hosts
  svc_executionHostTargets --> pkg_api_execution_host_controller
  svc_fileReferences --> pkg_api_session_controller
  svc_fileUploads --> pkg_api_session_controller
  svc_findings --> pkg_api_security_research_controller
  svc_findings --> pkg_tool_finding
  svc_fs --> pkg_tool_fs
  svc_git --> pkg_tool_git
  svc_integrationPreflightController --> pkg_client_ui_integrations
  svc_integrationPreflightController --> pkg_client_ui_work_items
  svc_invariants --> pkg_agent
  svc_invariants --> pkg_agent_loop
  svc_invariants --> pkg_scope
  svc_invariants --> pkg_session
  svc_jobs --> pkg_tool_bash
  svc_jobs --> pkg_tool_jobs
  svc_jobs --> pkg_tool_subagent
  svc_jobs --> pkg_tool_terminal
  svc_llm --> pkg_agent_loop
  svc_llm --> pkg_compaction_basic
  svc_lsp --> pkg_tool_lsp
  svc_mcpController --> pkg_client_ui_settings_mcp
  svc_mcpManagement --> pkg_api_mcp_controller
  svc_mcpRegistry --> pkg_mcp_management
  svc_mcpResources --> pkg_mcp_resources
  svc_mobileDevice --> pkg_api_device_capabilities_controller
  svc_mobileDevice --> pkg_tool_mobile_device
  svc_officeToPdf --> pkg_client_ui_better_sidebar
  svc_pluginManagementHost --> pkg_host_plugin_inventory
  svc_pluginManagementHost --> pkg_plugin_manager
  svc_pluginManager --> pkg_client_ui_plugin_manager
  svc_profileContext --> pkg_plugin_manager
  svc_ptcRuntime --> pkg_ptc_runtime_node
  svc_ptcRuntime --> pkg_tools
  svc_ptcRuntime --> pkg_workflow_ptc
  svc_sandbox --> pkg_bash_sandbox
  svc_sandbox --> pkg_terminal_bash
  svc_sandboxPolicy --> pkg_bash_sandbox
  svc_sandboxPolicy --> pkg_fs_sandbox
  svc_sandboxPolicy --> pkg_terminal_bash
  svc_securityResearchController --> pkg_client_ui_settings_security
  svc_securitySkillResources --> pkg_api_security_research_controller
  svc_securitySkillResources --> pkg_security_skills
  svc_sessionFeedback --> pkg_client_ui_message_feedback
  svc_sessionPersistence --> pkg_agent_loop
  svc_sessionPersistence --> pkg_hooks_claude_code
  svc_sessionPersistence --> pkg_hooks_codex
  svc_sessionPersistence --> pkg_message_feedback
  svc_sessionPersistence --> pkg_session_query
  svc_sessionPersistence --> pkg_session_query_sqlite
  svc_sessionPersistence --> pkg_tool_bash
  svc_sessionProjectionCache --> pkg_api_session_controller
  svc_sessionProjectionCache --> pkg_session_query
  svc_sessionProjectionCache --> pkg_session_reference
  svc_sessionProjectionCache --> pkg_subagent
  svc_sessionProjections --> pkg_api_session_controller
  svc_sessionProjections --> pkg_session_title
  svc_sessionProjections --> pkg_tool_todo
  svc_sessionQuery --> pkg_session_reference
  svc_sessionQuery --> pkg_tool_session_query
  svc_sessions --> pkg_agent
  svc_sessions --> pkg_agent_loop
  svc_sessions --> pkg_invariants
  svc_sessions --> pkg_message_feedback
  svc_sessions --> pkg_session_persistence
  svc_sessions --> pkg_session_query
  svc_sessions --> pkg_session_query_sqlite
  svc_sessions --> pkg_subagent_in_process_driver
  svc_settings --> pkg_api_settings_controller
  svc_settings --> pkg_llm_deepseek
  svc_settings --> pkg_llm_pi_ai
  svc_shell --> pkg_hooks_claude_code
  svc_shell --> pkg_hooks_codex
  svc_shell --> pkg_tool_bash
  svc_shell --> pkg_tool_pwsh
  svc_shellEnv --> pkg_tool_bash
  svc_shellEnv --> pkg_tool_pwsh
  svc_sidebarGit --> pkg_api_sidebar_git_controller
  svc_sidebarGit --> pkg_client_ui_better_sidebar
  svc_sidebarGitController --> pkg_client_ui_better_sidebar
  svc_sidebarTerminalController --> pkg_client_ui_better_sidebar
  svc_sidebarTerminals --> pkg_api_sidebar_terminal_controller
  svc_skills --> pkg_tool_skill
  svc_spillStore --> pkg_spill_policy
  svc_ssh --> pkg_fs_ssh
  svc_ssh --> pkg_sandbox_ssh
  svc_ssh --> pkg_subprocess_ssh
  svc_storage --> pkg_storage_domain
  svc_storageDomain --> pkg_workspace
  svc_subagentModelSelection --> pkg_tool_subagent
  svc_subagents --> pkg_tool_ralph
  svc_subagents --> pkg_tool_subagent
  svc_subagents --> pkg_tool_subagent_control
  svc_subprocess --> pkg_bash_local
  svc_subprocess --> pkg_bash_sandbox
  svc_subprocess --> pkg_lsp_stdio
  svc_subprocess --> pkg_subagent_acp
  svc_subprocess --> pkg_subagent_claude_code
  svc_subprocess --> pkg_subagent_codex
  svc_subprocess --> pkg_terminal_bash
  svc_systemPrompt --> pkg_agent_loop
  svc_systemPrompt --> pkg_tool_fs
  svc_systemPrompt --> pkg_tool_terminal
  svc_systemPrompt --> pkg_tool_web
  svc_systemPrompt --> pkg_tools
  svc_terminalController --> pkg_client_ui_right_sidebar
  svc_terminals --> pkg_tool_terminal
  svc_tokenMeter --> pkg_compaction_basic
  svc_toolResultPruner --> pkg_compaction_basic
  svc_tools --> pkg_agent_loop
  svc_tools --> pkg_tool_ask_user
  svc_tools --> pkg_tool_bash
  svc_tools --> pkg_tool_cordis
  svc_tools --> pkg_tool_fs
  svc_tools --> pkg_tool_skill
  svc_tools --> pkg_tool_subagent
  svc_tools --> pkg_tool_terminal
  svc_tools --> pkg_tool_todo
  svc_tools --> pkg_tool_web
  svc_typert --> pkg_api_gateway
  svc_typert --> pkg_typert_loader
  svc_usageController --> pkg_client_ui_settings_usage
  svc_usageQuery --> pkg_api_usage_controller
  svc_userQuestions --> pkg_tool_ask_user
  svc_voice --> pkg_api_voice_controller
  svc_voiceController --> pkg_client_ui_voice_dictation
  svc_vulnKb --> pkg_api_security_research_controller
  svc_vulnKb --> pkg_tool_vuln_kb
  svc_web --> pkg_tool_web
  svc_webServer --> pkg_client_connection
  svc_webServer --> pkg_client_hmr
  svc_webServer --> pkg_client_modules
  svc_webhookRuntime --> pkg_webhook_github
  svc_workItems --> pkg_api_work_items_controller
  svc_workItems --> pkg_tool_work_items
  svc_workItemsController --> pkg_client_ui_work_items
  svc_workflowEngine --> pkg_tool_ralph
  svc_workflowEngine --> pkg_tool_workflow
  svc_workspaceChanges --> pkg_client_ui_deliverables
  svc_workspaceIsolation --> pkg_api_session_controller
  svc_workspaceIsolation --> pkg_api_work_items_controller
  svc_workspaceIsolation --> pkg_api_workspace_isolation_controller
  svc_workspaceIsolation --> pkg_workspace
  svc_workspaceIsolationController --> pkg_client_ui_right_sidebar
  svc_workspaceIsolationController --> pkg_client_ui_workspace_isolation
  svc_workspaceRegistry --> pkg_api_session_controller
  svc_workspaceRegistry --> pkg_api_workspace_controller
  svc_worktreeTask --> pkg_api_session_controller
  svc_worktreeTask --> pkg_api_worktree_task_controller
  svc_worktreeTaskController --> pkg_client_ui_right_sidebar
  svc_worktreeTaskController --> pkg_client_ui_worktree_task
  svc_fs -. event gate .-> pkg_fs_observation_policy
```

| ctx 键 | 角色 | 所属包 | 实现 | 直接消费方 | 配套插件 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `ctx.artifacts` | `seam` | [`artifact`](../packages/artifact/artifact) | [`artifact-local`](../packages/artifact/artifact-local), [`artifact-memory`](../packages/artifact/artifact-memory) | [`finding-session`](../packages/security/finding-session), [`tool-finding`](../packages/security/tool-finding), [`api-security-research-controller`](../packages/api/security-research-controller) | - | 存储执行主机上的证据产物，并解析其元数据与字节访问。 |
| `ctx.assessmentScope` | `seam` | [`assessment-scope`](../packages/security/assessment-scope) | [`assessment-scope-static`](../packages/security/assessment-scope-static) | [`assessment-scope-session`](../packages/security/assessment-scope-session), [`api-security-research-controller`](../packages/api/security-research-controller) | - | 校验安全评估的根授权、范围收窄、目标准入与有效期。 |
| `ctx.assessmentScopeSessions` | `core` | [`assessment-scope-session`](../packages/security/assessment-scope-session) | - | [`assessment-scope-tool-policy`](../packages/security/assessment-scope-tool-policy), [`tool-finding`](../packages/security/tool-finding), [`api-security-research-controller`](../packages/api/security-research-controller) | - | 拥有评估工具策略使用的持久 Session 授权与审计记录。 |
| `ctx.automationController` | `core` | [`api-automation-controller`](../packages/api/automation-controller) | - | [`client-ui-settings-automation`](../packages/client/ui-settings-automation) | - | 提供自动化定义、运行控制、计划预览与可用配置选项。 |
| `ctx.automationRuntime` | `core` | [`automation`](../packages/automation/automation) | - | [`api-automation-controller`](../packages/api/automation-controller) | - | 通过普通 Agent 调度持久 UTC 自动化运行，并记录其生命周期。 |
| `ctx.betterSidebar` | `core` | [`client-ui-better-sidebar`](../packages/client/ui-better-sidebar) | - | [`client-ui-plan`](../packages/client/ui-plan), [`client-ui-settings-terminal`](../packages/client/ui-settings-terminal) | - | 拥有本地浏览器界面共享的侧栏页签与查看器贡献。 |
| `ctx.browser` | `seam` | [`browser`](../packages/browser/browser) | [`browser-cinlan`](../packages/browser/browser-cinlan), [`browser-playwright`](../packages/browser/browser-playwright) | [`tool-browser`](../packages/browser/tool-browser), [`tool-browser-element-capture`](../packages/browser/tool-browser-element-capture), [`api-browser-controller`](../packages/api/browser-controller), [`coordination-browser-element-capture`](../packages/coordination/coordination-browser-element-capture) | - | 将浏览器观测与交互路由到选定的提供方。 |
| `ctx.browserController` | `core` | [`api-browser-controller`](../packages/api/browser-controller) | - | [`client-ui-settings-security`](../packages/client/ui-settings-security), [`client-ui-browser-element-capture`](../packages/client/ui-browser-element-capture) | - | 向浏览器客户端提供浏览器能力配置与元素捕获操作。 |
| `ctx.browserUse` | `seam` | [`browser-use`](../packages/browser-use/browser-use) | [`experimental-browser-use-stagehand-native`](../packages/experimental/browser-use-stagehand-native), [`experimental-browser-use-playwright-mcp`](../packages/experimental/browser-use-playwright-mcp), [`experimental-browser-use-chrome-devtools-mcp`](../packages/experimental/browser-use-chrome-devtools-mcp) | - | - | 保留唯一的具名提供方，直到其工具与所属工作完成关闭；执行方法由提供方拥有。 |
| `ctx.computerUse` | `seam` | [`computer-use`](../packages/computer-use/computer-use) | [`computer-use-cinlan`](../packages/computer-use/computer-use-cinlan), [`experimental-computer-use-cua-driver-native`](../packages/experimental/computer-use-cua-driver-native), [`experimental-computer-use-cua-driver-mcp`](../packages/experimental/computer-use-cua-driver-mcp) | [`tool-computer-use`](../packages/computer-use/tool-computer-use), [`api-device-capabilities-controller`](../packages/api/device-capabilities-controller) | - | 通过可替换的设备提供方提供桌面观测与输入。 |
| `ctx.coordination` | `seam` | [`coordination`](../packages/coordination/coordination) | [`coordination-local`](../packages/coordination/coordination-local) | [`tool-coordination`](../packages/coordination/tool-coordination), [`coordination-subagent-executor`](../packages/coordination/coordination-subagent-executor), [`coordination-browser-element-capture`](../packages/coordination/coordination-browser-element-capture), [`tool-browser-element-capture`](../packages/browser/tool-browser-element-capture) | - | 拥有执行适配器共享的任务图、取消与审批状态。 |
| `ctx.deviceCapabilitiesController` | `core` | [`api-device-capabilities-controller`](../packages/api/device-capabilities-controller) | - | [`client-ui-settings-security`](../packages/client/ui-settings-security) | - | 报告桌面与移动设备能力的可用性、SDK 检测结果及设备选项。 |
| `ctx.executionHost` | `seam` | [`execution-host`](../packages/execution-host/execution-host) | [`execution-host-local`](../packages/execution-host/execution-host-local) | [`artifact-local`](../packages/artifact/artifact-local), [`artifact-memory`](../packages/artifact/artifact-memory), [`execution-host-worker`](../packages/execution-host/execution-host-worker), [`execution-host-targets`](../packages/execution-host/execution-host-targets), [`tool-finding`](../packages/security/tool-finding) | - | 定义工作进程与产物提供方消费的执行主机身份与操作。 |
| `ctx.executionHostController` | `core` | [`api-execution-host-controller`](../packages/api/execution-host-controller) | - | [`client-ui-settings-hosts`](../packages/client/ui-settings-hosts) | - | 提供已保存的执行目标、修订版本与连接检查。 |
| `ctx.executionHostTargets` | `core` | [`execution-host-targets`](../packages/execution-host/execution-host-targets) | - | [`api-execution-host-controller`](../packages/api/execution-host-controller) | - | 拥有已保存的 SSH 目标配置及关联配置代际的检查结果。 |
| `ctx.findings` | `seam` | [`finding`](../packages/security/finding) | [`finding-session`](../packages/security/finding-session) | [`tool-finding`](../packages/security/tool-finding), [`api-security-research-controller`](../packages/api/security-research-controller) | - | 提供由所属 Session 支撑的发现与证据快照。 |
| `ctx.git` | `seam` | [`git`](../packages/git/git) | [`git-local`](../packages/git/git-local) | [`tool-git`](../packages/git/tool-git) | - | 提供标准化的仓库状态、差异与历史，不包含修改命令。 |
| `ctx.integrationPreflightController` | `core` | [`api-integration-preflight-controller`](../packages/api/integration-preflight-controller) | - | [`client-ui-integrations`](../packages/client/ui-integrations), [`client-ui-work-items`](../packages/client/ui-work-items) | - | 在客户端配置或使用远程能力前报告集成就绪状态。 |
| `ctx.mcpController` | `core` | [`api-mcp-controller`](../packages/api/mcp-controller) | - | [`client-ui-settings-mcp`](../packages/client/ui-settings-mcp) | - | 向设置客户端提供已配置的 MCP 服务器及预期生命周期变更。 |
| `ctx.mcpManagement` | `core` | [`mcp-management`](../packages/mcp/mcp-management) | - | [`api-mcp-controller`](../packages/api/mcp-controller) | - | 拥有持久的 MCP 预期条目，并协调其运行生命周期。 |
| `ctx.mcpRegistry` | `core` | [`mcp-client`](../packages/mcp/mcp-client) | - | [`mcp-management`](../packages/mcp/mcp-management) | - | 发布根 profile 中 MCP 客户端的只读观测结果。 |
| `ctx.mcpResources` | `seam` | [`mcp-resources`](../packages/mcp/mcp-resources) | [`mcp-client`](../packages/mcp/mcp-client) | [`mcp-resources`](../packages/mcp/mcp-resources) | - | 收集提供方资源与模板，供同包注册的资源工具使用。 |
| `ctx.mobileDevice` | `seam` | [`mobile-device`](../packages/mobile-device/mobile-device) | [`mobile-device-cinlan`](../packages/mobile-device/mobile-device-cinlan) | [`tool-mobile-device`](../packages/mobile-device/tool-mobile-device), [`api-device-capabilities-controller`](../packages/api/device-capabilities-controller) | - | 为移动自动化提供设备发现、观测与输入。 |
| `ctx.officeToPdf` | `core` | [`office-to-pdf`](../packages/document/office-to-pdf) | - | [`client-ui-better-sidebar`](../packages/client/ui-better-sidebar) | - | 拥有可复用转换器、有界转换队列、输出缓存及经授权的工作区预览。 |
| `ctx.pluginManagementHost` | `seam` | [`plugin-manager`](../packages/boot/plugin-manager) | - | [`plugin-manager`](../packages/boot/plugin-manager), [`host-plugin-inventory`](../packages/host/plugin-inventory) | - | Desktop 启动器提供受保护条目 id 与完整应用补丁；包事务仍由启动器拥有。 |
| `ctx.ptcRuntime` | `seam` | [`ptc-runtime`](../packages/ptc-runtime/ptc-runtime) | [`ptc-runtime-node`](../packages/ptc-runtime/ptc-runtime-node) | [`tools`](../packages/core/tools), [`workflow-ptc`](../packages/workflow/workflow-ptc), [`ptc-runtime-node`](../packages/ptc-runtime/ptc-runtime-node) | - | 解析并运行带类型化工具绑定的程序；Node 提供方还公开本地 code-runtime 兼容适配器。 |
| `ctx.securityResearchController` | `core` | [`api-security-research-controller`](../packages/api/security-research-controller) | - | [`client-ui-settings-security`](../packages/client/ui-settings-security) | - | 通过各自所属服务提供资源管理、评估范围、发现、证据产物与漏洞知识。 |
| `ctx.securitySkillResources` | `core` | [`security-skills`](../packages/security/security-skills) | - | [`security-skills`](../packages/security/security-skills)、[`api-security-research-controller`](../packages/api/security-research-controller) | - | 安装已验证的资源 generation，并在所属 Agent realm 释放前保留已加载路径。 |
| `ctx.sessionFeedback` | `core` | [`command-feedback`](../packages/feedback/command-feedback) | - | [`client-ui-message-feedback`](../packages/client/ui-message-feedback) | - | 在 Session 中记录人工反馈，不启动模型工作。 |
| `ctx.sidebarGit` | `core` | [`sidebar-git`](../packages/git/sidebar-git) | - | [`api-sidebar-git-controller`](../packages/api/sidebar-git-controller), [`client-ui-better-sidebar`](../packages/client/ui-better-sidebar) | - | 串行执行仓库修改，并为侧栏提供提交预览。 |
| `ctx.sidebarGitController` | `core` | [`api-sidebar-git-controller`](../packages/api/sidebar-git-controller) | - | [`client-ui-better-sidebar`](../packages/client/ui-better-sidebar) | - | 通过共享的 Git 所有者提供侧栏仓库状态与操作。 |
| `ctx.sidebarTerminalController` | `core` | [`api-sidebar-terminal-controller`](../packages/api/sidebar-terminal-controller) | - | [`client-ui-better-sidebar`](../packages/client/ui-better-sidebar) | - | 提供关联终端附着的输出、输入、尺寸调整、确认与释放。 |
| `ctx.sidebarTerminals` | `seam` | [`sidebar-terminals`](../packages/terminal/sidebar-terminals) | [`client-ui-better-sidebar`](../packages/client/ui-better-sidebar) | [`api-sidebar-terminal-controller`](../packages/api/sidebar-terminal-controller) | - | 为提供方管理的终端会话拥有附着身份与已确认输出。 |
| `ctx.ssh` | `core` | [`ssh`](../packages/ssh/ssh) | - | [`fs-ssh`](../packages/ssh/fs-ssh), [`subprocess-ssh`](../packages/ssh/subprocess-ssh), [`sandbox-ssh`](../packages/ssh/sandbox-ssh) | - | 拥有经验证的辅助程序设置、RPC 传输、认证流与连接释放。 |
| `ctx.terminalController` | `core` | [`api-terminal-controller`](../packages/api/terminal-controller) | - | [`client-ui-right-sidebar`](../packages/client/ui-right-sidebar) | - | 通过所属 Agent 与 Session 寻址并提供终端会话。 |
| `ctx.usageController` | `core` | [`api-usage-controller`](../packages/api/usage-controller) | - | [`client-ui-settings-usage`](../packages/client/ui-settings-usage) | - | 向设置客户端提供有界用量查询。 |
| `ctx.usageQuery` | `core` | [`usage-query`](../packages/session-query/usage-query) | - | [`api-usage-controller`](../packages/api/usage-controller) | - | 聚合实时与冷 Session 用量，支持取消并限制结果规模。 |
| `ctx.voice` | `seam` | [`voice`](../packages/voice/voice) | [`voice-sherpa-onnx`](../packages/voice/voice-sherpa-onnx) | [`api-voice-controller`](../packages/api/voice-controller) | - | 通过已配置的本地语音提供方路由音频转写。 |
| `ctx.voiceController` | `core` | [`api-voice-controller`](../packages/api/voice-controller) | - | [`client-ui-voice-dictation`](../packages/client/ui-voice-dictation) | - | 向听写客户端提供语音设置与转写请求。 |
| `ctx.vulnKb` | `seam` | [`vuln-kb-service`](../packages/security/vuln-kb-service) | [`vuln-kb-nvd`](../packages/security/vuln-kb-nvd) | [`tool-vuln-kb`](../packages/security/tool-vuln-kb), [`api-security-research-controller`](../packages/api/security-research-controller) | - | 通过知识库提供方提供标准化漏洞查询。 |
| `ctx.workspaceIsolation` | `seam` | [`workspace-isolation`](../packages/workspace/workspace-isolation) | [`workspace-isolation-git`](../packages/workspace/workspace-isolation-git) | [`api-session-controller`](../packages/api/session-controller), [`api-workspace-isolation-controller`](../packages/api/workspace-isolation-controller), [`api-work-items-controller`](../packages/api/work-items-controller), [`workspace`](../packages/workspace/workspace) | - | 管理隔离工作区租约及其比较、集成与休眠。 |
| `ctx.workspaceIsolationController` | `core` | [`api-workspace-isolation-controller`](../packages/api/workspace-isolation-controller) | - | [`client-ui-workspace-isolation`](../packages/client/ui-workspace-isolation), [`client-ui-right-sidebar`](../packages/client/ui-right-sidebar) | - | 提供隔离工作区租约状态与集成控制。 |
| `ctx.worktreeTask` | `seam` | [`worktree-task`](../packages/workspace/worktree-task) | [`worktree-task-git`](../packages/workspace/worktree-task-git) | [`api-worktree-task-controller`](../packages/api/worktree-task-controller), [`api-session-controller`](../packages/api/session-controller) | - | 拥有任务分支、worktree、Session 绑定与评审操作。 |
| `ctx.worktreeTaskController` | `core` | [`api-worktree-task-controller`](../packages/api/worktree-task-controller) | - | [`client-ui-worktree-task`](../packages/client/ui-worktree-task), [`client-ui-right-sidebar`](../packages/client/ui-right-sidebar) | - | 向浏览器客户端提供任务 worktree 及其评审生命周期。 |
| `ctx.pluginManager` | `core` | [`plugin-manager`](../packages/boot/plugin-manager) | - | [`client-ui-plugin-manager`](../packages/client/ui-plugin-manager) | - | 拥有持久组合变更、包操作、取消与 profile 重载结果。 |
| `ctx.profileContext` | `core` | [`app-boot`](../packages/boot/app-boot) | - | [`plugin-manager`](../packages/boot/plugin-manager) | - | 启动器提供不可变的 profile 路径、启动选择与重载策略。 |
| `ctx.workspaceChanges` | `core` | [`workspace-changes`](../packages/deliverables/workspace-changes) | - | [`client-ui-deliverables`](../packages/client/ui-deliverables) | - | 记录变更文件并提供摘要与比较，直到所属 Session 释放。 |
| `ctx.workItems` | `seam` | [`work-items`](../packages/work-items/work-items) | [`work-items-github`](../packages/work-items/work-items-github), [`work-items-linear`](../packages/work-items/work-items-linear) | [`tool-work-items`](../packages/work-items/tool-work-items), [`api-work-items-controller`](../packages/api/work-items-controller) | - | 提供方拥有固定来源的请求；服务拥有不可变写入预览与持久回执。 |
| `ctx.workItemsController` | `core` | [`api-work-items-controller`](../packages/api/work-items-controller) | - | [`client-ui-work-items`](../packages/client/ui-work-items) | - | 投影标准化议题，并独立于外部修改持久保存显式 Workspace 与 Session 关联。 |
| `ctx.attachments` | `seam` | [`attachment`](../packages/attachment/attachment) | [`attachment-local`](../packages/attachment/attachment-local) | [`api-session-controller`](../packages/api/session-controller), [`tool-fs`](../packages/fs/tool-fs), [`llm-pi-ai`](../packages/llm/llm-pi-ai), [`llm-deepseek`](../packages/llm/llm-deepseek) | - | 宿主会在会话事件之前提交已接受的图片；提供方适配器将已授权的持久引用解析为提供方原生内容。 |
| `ctx.fileUploads` | `core` | [`client-file-upload`](../packages/client/file-upload) | - | [`api-session-controller`](../packages/api/session-controller) | - | 负责流式接收、持久存储和暂存回执生命周期；Session Controller 将回执绑定到已接受的提交。 |
| `ctx.llm` | `seam` | [`llm`](../packages/llm/llm) | [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai), [`llm-replay`](../packages/test-support/llm-replay) | [`agent-loop`](../packages/core/agent-loop), [`compaction-basic`](../packages/compaction/compaction-basic) | - | 适配器注册提供方实现；agent loop（智能体循环）与压缩功能调用提供方无关的流服务。 |
| `ctx.deepseekLlmApiExtensions` | `seam` | [`deepseek-llm-api-extensions`](../packages/llm/deepseek-llm-api-extensions) | [`session-log-deepseek`](../packages/session/session-log-deepseek), [`plugin-package-inventory-deepseek`](../packages/llm/plugin-package-inventory-deepseek) | [`llm-deepseek`](../packages/llm/llm-deepseek) | - | 插件准备彼此独立的顶层字段；官方适配器会合并这些字段，并在 HTTP 接受后提交其交付状态。 |
| `ctx.tokenMeter` | `core` | [`token-meter`](../packages/llm/token-meter) | - | [`compaction-basic`](../packages/compaction/compaction-basic) | - | 拥有按会话隔离的回放折叠区；压力消费方共享不可变且带修订版本的测量结果。 |
| `ctx.toolResultPruner` | `core` | [`compaction-tool-result-pruner`](../packages/compaction/compaction-tool-result-pruner) | - | [`compaction-basic`](../packages/compaction/compaction-basic) | - | 在摘要压缩前，通过可回放的单节点表层替换来改写过大的当前工具结果。 |
| `ctx.sessions` | `core` | [`session`](../packages/core/session) | - | [`agent-loop`](../packages/core/agent-loop), [`agent`](../packages/core/agent), [`session-persistence`](../packages/session/session-persistence), [`session-query`](../packages/session-query/session-query), [`session-query-sqlite`](../packages/session-query/session-query-sqlite), [`subagent-in-process-driver`](../packages/subagent/subagent-in-process-driver), [`invariants`](../packages/runtime-diagnostics/invariants), [`message-feedback`](../packages/feedback/message-feedback) | - | 拥有仅追加的 Session 实例，并发出持久的会话事件流。 |
| `ctx.sessionController` | `core` | [`api-session-controller`](../packages/api/session-controller) | - | - | - | 负责 Session 命令、冷读取、持久事件跟随、实时控制状态、模型目录、workspace 打开与 Agent 激活策略。 |
| `ctx.sessionFileReferences` | `core` | [`api-session-controller`](../packages/api/session-controller) | - | - | - | 通过 Session Controller 的既有 Agent lookup 策略委托文件引用发现。 |
| `ctx.sessionSkillCatalog` | `core` | [`api-session-controller`](../packages/api/session-controller) | - | - | - | 在不激活冷 Agent 的前提下列出 Session 组合中允许用户调用的 skill。 |
| `ctx.credentialsController` | `core` | [`api-settings-controller`](../packages/api/settings-controller) | - | - | - | 把凭据引用 seam 投影到生成的 Remote namespace：批量扇出、视图投影与拒绝映射都在这里，而不在 seam Definition 上。 |
| `ctx.settingsController` | `core` | [`api-settings-controller`](../packages/api/settings-controller) | - | - | - | 把用户设置 seam 投影到生成的 Remote namespace：读取一律脱敏，所有拒绝在这里分类，而不在 seam Definition 上。 |
| `ctx.workspaceFiles` | `core` | [`api-workspace-files`](../packages/api/workspace-files) | - | - | - | 为会话工作区根内的文件提供 stat、分页文本、字节窗口、目录列举与变更流，经 lstat、包含关系与 stat 重检限定。 |
| `ctx.workspaceController` | `core` | [`api-workspace-controller`](../packages/api/workspace-controller) | - | - | - | 通过生成的 Remote namespace 负责 Workspace 命令和可在重连后收敛的 Workspace 状态投递。 |
| `ctx.directoryPickerController` | `core` | [`api-workspace-controller`](../packages/api/workspace-controller) | - | - | - | 把选目录 seam 送上线：能力门禁、取消传播，以及浏览器目录流程用于分支判断的 seam 错误码。 |
| `ctx.invariants` | `core` | [`invariants`](../packages/runtime-diagnostics/invariants) | - | [`session`](../packages/core/session), [`agent`](../packages/core/agent), [`scope`](../packages/core/scope), [`agent-loop`](../packages/core/agent-loop) | - | 配套子路径注册所属包本地的检查；该服务负责选择、唯一性、子 fiber，以及标明所属包的失败。 |
| `ctx.typert` | `core` | [`typert-registry`](../packages/typert/registry) | - | [`typert-loader`](../packages/typert/loader), [`api-gateway`](../packages/api/gateway) | - | 插件直接或通过 dsh-typert-loader 注册实时 zod 贡献；API 网关消费调用描述符和提供方，其他运行时消费方则在各自边界查询 schema 与反射元数据。 |
| `ctx.typertGateway` | `core` | [`api-gateway`](../packages/api/gateway) | - | - | - | 将生成的 Remote 描述符与实时 Cordis 服务关联，解析已注册的身份，并通过共享的 Connection RPC 载体提供一元调用。 |
| `ctx.sessionPersistence` | `seam` | [`session-persistence`](../packages/session/session-persistence) | [`session-persistence-jsonl`](../packages/session/session-persistence-jsonl) | [`agent-loop`](../packages/core/agent-loop), [`tool-bash`](../packages/shell/tool-bash), [`hooks-claude-code`](../packages/hooks/hooks-claude-code), [`hooks-codex`](../packages/hooks/hooks-codex), [`session-query`](../packages/session-query/session-query), [`session-query-sqlite`](../packages/session-query/session-query-sqlite), [`message-feedback`](../packages/feedback/message-feedback) | - | JSONL backend 把 SessionEvent 词汇持久化为每个 Session 一份产物。 |
| `ctx.settings` | `seam` | [`settings`](../packages/settings/settings) | [`settings-file`](../packages/settings/settings-file) | [`api-settings-controller`](../packages/api/settings-controller), [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai) | - | 插件注册命名空间 schema 并解析分层值；提供方存储原始文档。LLM（大语言模型）适配器在用户分区下将其入口配置注册为组合基础；settings controller 提供经过脱敏的分层描述符，并写入用户层。 |
| `ctx.subagentModelSelection` | `core` | [`tool-subagent`](../packages/subagent/tool-subagent) | - | [`tool-subagent`](../packages/subagent/tool-subagent) | - | 拥有默认关闭的设置命名空间；Agent 作用域的委派工具会在组合新顶层 Session 时读取它。 |
| `ctx.credentials` | `seam` | [`credentials`](../packages/credentials/credentials) | [`credentials-local`](../packages/credentials/credentials-local) | [`api-settings-controller`](../packages/api/settings-controller), [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai) | - | 配置携带对机密信息的引用；提供方拥有实际值。消费方按操作解析，因此轮换后的凭据会在紧接着的下一次请求中生效；settings controller 提供不含实际值的视图和只写存储。 |
| `ctx.authorization` | `seam` | [`authorization`](../packages/credentials/authorization) | - | [`llm-pi-ai`](../packages/llm/llm-pi-ai) | - | flow 由知道如何取得某份凭据的插件注册，并以其写入的记录为键；seam 拥有这段对话与"每个键同时只跑一次尝试"的生命周期，而非协议本身。 |
| `ctx.sessionTelemetry` | `seam` | [`session-telemetry`](../packages/session/session-telemetry) | [`session-telemetry-otel`](../packages/session/session-telemetry-otel) | - | - | 该 seam 捕获会话记录、进行脱敏并交给一个后端；没有其他组件消费该服务，其输出会离开当前进程。 |
| `ctx.storage` | `seam` | [`storage`](../packages/storage/storage) | [`storage-json`](../packages/storage/storage-json), [`storage-sqlite`](../packages/storage/storage-sqlite) | [`storage-domain`](../packages/storage/storage-domain) | - | 各后端以不同名称并列注册；数据形态（领域优先）挂载到枢纽上，并将类型化操作转换为不透明的 KV 单元原语。 |
| `ctx.storageDomain` | `core` | [`storage-domain`](../packages/storage/storage-domain) | - | [`workspace`](../packages/workspace/workspace) | - | 等待所有已配置后端就绪，然后将领域形态发布为一个受生命周期约束的服务，用于类型化持久状态。 |
| `ctx.messageFeedback` | `core` | [`message-feedback`](../packages/feedback/message-feedback) | - | - | - | 拥有权威 Session 日志中的逐 assistant 消息反馈、目标校验、逐条目 compare-and-set 及 Host 一元 Remote 契约。反馈不进入模型历史；日志导出遵循消费方策略。 |
| `ctx.workspaceRegistry` | `core` | [`workspace`](../packages/workspace/workspace) | - | [`api-workspace-controller`](../packages/api/workspace-controller), [`api-session-controller`](../packages/api/session-controller) | - | 通过领域设施拥有带 WorkspaceId 品牌类型的记录；稳定的 sessionIds 账户驱动 Host RPC 与 GUI 投影。 |
| `ctx.sessionQuery` | `seam` | [`session-query`](../packages/session-query/session-query) | [`session-query-sqlite`](../packages/session-query/session-query-sqlite) | [`session-reference`](../packages/context/session-reference), [`tool-session-query`](../packages/session-query/tool-session-query) | - | 该接口提供精确读取、过滤和追踪；具体后端还提供全文协调、排序、摘要片段和游标世代，而模型消费方负责工作区权限与不含游标的渲染。 |
| `ctx.fileReferences` | `seam` | [`file-reference`](../packages/context/file-reference) | [`file-reference-local`](../packages/context/file-reference-local) | [`api-session-controller`](../packages/api/session-controller) | - | 该接口返回 Agent cwd 内仅含路径的补全候选；提供方负责命名空间访问与排序，但不读取文件内容。 |
| `ctx.sessionReferenceResolver` | `core` | [`session-reference`](../packages/context/session-reference) | - | - | - | 将当前表层中有界的对话快照投影为持久但不可信的消息上下文；Host 适配器负责提及语法。 |
| `ctx.sessionTitle` | `seam` | [`session-title`](../packages/session/session-title) | [`session-title-first-prompt-llm`](../packages/session/session-title-first-prompt-llm), [`session-title-all-prompts-llm`](../packages/session/session-title-all-prompts-llm) | - | - | 负责确定性回退、最新标题折叠区，以及唯一的可选异步提供方注册。 |
| `ctx.systemPrompt` | `core` | [`system-prompt`](../packages/core/system-prompt) | - | [`agent-loop`](../packages/core/agent-loop), [`tools`](../packages/core/tools), [`tool-fs`](../packages/fs/tool-fs), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-web`](../packages/web/tool-web) | - | 为每个步骤收集提示词各部分和面向模型的工具 schema。 |
| `ctx.tools` | `core` | [`tools`](../packages/core/tools) | - | [`agent-loop`](../packages/core/agent-loop), [`tool-ask-user`](../packages/interaction/tool-ask-user), [`tool-bash`](../packages/shell/tool-bash), [`tool-cordis`](../packages/extensions/tool-cordis), [`tool-fs`](../packages/fs/tool-fs), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-skill`](../packages/skill/tool-skill), [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-todo`](../packages/todo/tool-todo), [`tool-web`](../packages/web/tool-web) | - | 注册能力，负责 PTC mode 传输，并让调用依次经过策略前处理、单调守卫、环绕分派、策略后处理和最终结果观测。 |
| `ctx.userQuestions` | `seam` | [`user-questions`](../packages/interaction/user-questions) | - | [`tool-ask-user`](../packages/interaction/tool-ask-user) | - | UI 前端提供当前生效的人工回答提供方；tool-ask-user 在提供方无关的 ask() promise 上暂停工具调用。 |
| `ctx.planMode` | `core` | [`plan-mode`](../packages/plan/plan-mode) | - | - | - | 折叠已记录的计划／模式状态，在轮次边界刷新用户选择，渲染由部署方拥有的指导信息，注册 /plan，并在状态转换期间保持计划退出 schema 稳定。 |
| `ctx.agentPresets` | `core` | [`agent-presets`](../packages/preset/agent-presets) | - | - | - | 在受信任根目录与用户创作根目录上发现 preset 目录，并在创建期把一份 preset cordis.yml 挂载到 agent 作用域之下，拒绝始终未激活或向根服务 realm 发布服务的行。 |
| `ctx.commands` | `core` | [`commands`](../packages/interaction/commands) | - | - | - | 插件注册直接面向人的命令，而不会把调用发送给模型。 |
| `ctx.sessionProjections` | `core` | [`session-projection`](../packages/session/session-projection) | - | [`api-session-controller`](../packages/api/session-controller), [`tool-todo`](../packages/todo/tool-todo), [`session-title`](../packages/session/session-title) | - | 各领域注册由状态驱动的折叠单元；主动驱动过程维护每个会话的水位状态，Session controller 提供 baseline 并推送发生变化的值。 |
| `ctx.sessionProjectionCache` | `core` | [`session-projection-cache`](../packages/session/session-projection-cache) | - | [`api-session-controller`](../packages/api/session-controller), [`session-query`](../packages/session-query/session-query), [`session-reference`](../packages/context/session-reference), [`subagent`](../packages/subagent/subagent) | - | 按会话持久保存投影单元状态的检查点（节流检查点，以及轮次／结束／分离时的必选检查点），并提供冷读取阶梯：缓存行加持久化尾部回放，因此列表读取永远不需要加载完整日志。 |
| `ctx.skills` | `seam` | [`skill`](../packages/skill/skill) | [`skill-badge`](../packages/skill/skill-badge), [`skill-filesystem`](../packages/skill/skill-filesystem) | [`tool-skill`](../packages/skill/tool-skill) | - | 合并提供方的 skill（技能）目录；tool-skill 渲染会话前缀目录，并加载完整的 skill 正文。 |
| `ctx.agents` | `core` | [`agent`](../packages/core/agent) | - | [`agent-loop`](../packages/core/agent-loop), [`acp`](../packages/acp/acp), [`subagent-in-process-driver`](../packages/subagent/subagent-in-process-driver) | - | 拥有实时 Agent 句柄、创建／恢复工厂 seam，以及进程本地的发起方传播。 |
| `ctx.agentDefaultModel` | `core` | [`agent-default-model`](../packages/core/agent-default-model) | - | [`api-session-controller`](../packages/api/session-controller), [`headless`](../packages/bundle/headless) | - | 通过 settings 分层默认 `ModelSelection`，让直接入口与 Host 支撑的 Agent 入口共享同一个状态所有者。 |
| `ctx.agentLoop` | `bundle` | [`agent-loop`](../packages/core/agent-loop) | - | [`base`](../packages/bundle/base), [`sdk-minimal`](../packages/bundle/sdk-minimal) | - | 唯一的具体循环插件；扩展包依赖 dsh-agent 的事件和服务，而不依赖此包。 |
| `ctx.goals` | `core` | [`goal`](../packages/goal/goal) | - | - | - | 从会话日志折叠带修订版本的目标状态，并将实时延续激活保留在进程本地。 |
| `ctx.e2b` | `core` | [`e2b`](../packages/e2b/e2b) | - | [`fs-e2b`](../packages/e2b/fs-e2b), [`subprocess-e2b`](../packages/e2b/subprocess-e2b) | - | 拥有一个共享的 E2B SDK 句柄、远程工作目录和最终沙箱处置，使两个基础 E2B 提供方处于同一个 Linux 运行时中。 |
| `ctx.subprocess` | `seam` | [`subprocess`](../packages/subprocess/subprocess) | [`subprocess-local`](../packages/subprocess/subprocess-local), [`subprocess-e2b`](../packages/e2b/subprocess-e2b) | [`bash-local`](../packages/shell/bash-local), [`bash-sandbox`](../packages/shell/bash-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash), [`lsp-stdio`](../packages/lsp/lsp-stdio), [`subagent-acp`](../packages/subagent/subagent-acp), [`subagent-codex`](../packages/subagent/subagent-codex), [`subagent-claude-code`](../packages/subagent/subagent-claude-code) | - | Bash 执行器、PTY shell 后端、LSP Host，以及进程外 ACP、Codex 和 Claude Code subagent 后端都通过 ctx.subprocess 执行 spawn；该服务负责进程坐标、进程树／会话生命周期、stdio 处置、终端机制和 kill 升级。 |
| `ctx.shell` | `seam` | [`shell`](../packages/shell/shell) | [`bash-local`](../packages/shell/bash-local), [`bash-sandbox`](../packages/shell/bash-sandbox), [`pwsh-local`](../packages/shell/pwsh-local) | [`tool-bash`](../packages/shell/tool-bash), [`tool-pwsh`](../packages/shell/tool-pwsh), [`hooks-claude-code`](../packages/hooks/hooks-claude-code), [`hooks-codex`](../packages/hooks/hooks-codex) | - | 面向模型的 shell 工具和钩子桥接消费此 seam；沙箱、远程或 PowerShell 执行器可以替换 bash-local，而无需改动这些消费方。 |
| `ctx.shellEnv` | `core` | [`shell-env`](../packages/shell/shell-env) | - | [`tool-bash`](../packages/shell/tool-bash), [`tool-pwsh`](../packages/shell/tool-pwsh) | - | 插件声明限定于 effect 作用域的 DSH_* 事实；每个 shell 工具在每次执行时收集一份可信快照，其执行器据此重建命名空间。 |
| `ctx.terminals` | `seam` | [`terminal`](../packages/terminal/terminal) | [`terminal-bash`](../packages/terminal/terminal-bash) | [`tool-terminal`](../packages/terminal/tool-terminal) | - | 注册表负责精确到 Agent 的会话身份和清理；后端负责终端机制，tool-terminal 则提供限定于所有者作用域的模型接口。 |
| `ctx.sandbox` | `seam` | [`sandbox`](../packages/sandbox/sandbox) | [`sandbox-local`](../packages/sandbox/sandbox-local) | [`bash-sandbox`](../packages/shell/bash-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash) | - | 消费方交出即将执行 spawn 的确切 argv；与宿主共享文件系统和内核的后端按每次调用的策略包装该 argv，并报告强制执行情况。 |
| `ctx.sandboxPolicy` | `core` | [`sandbox-policy`](../packages/sandbox/sandbox-policy) | - | [`bash-sandbox`](../packages/shell/bash-sandbox), [`fs-sandbox`](../packages/fs/fs-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash) | - | 统一保存部署默认模式和工作区根目录；只有沙箱执行器和提供方读取该服务（工具层使用它同时导出的纯 `sandbox/mode` 折叠区）。两类强制执行组件都读取该服务，因此 bash 与 fs 不会限制到不同的根目录。 |
| `ctx.approval` | `seam` | [`user-approval`](../packages/interaction/user-approval) | - | [`tools`](../packages/core/tools), [`tool-bash`](../packages/shell/tool-bash), [`acp`](../packages/acp/acp) | - | 一次性权限决策通过 `approval/request` waterfall（瀑布式事件）分派；回答方是监听器（即 ACP 为自身 agent 提供的桥接），没有回答方时以 `unavailable` 关闭失败。 |
| `ctx.permissionPresets` | `core` | [`permission-presets`](../packages/interaction/permission-presets) | - | - | - | 面向用户的预设表（`workspace-write`／`danger-full-access`），将沙箱模式与审批策略选项组合在一起；一次切换会写入一个 `permission/preset` 事件，并贯通到两个选项事件。 |
| `ctx.codeRuntime` | `seam` | [`code-runtime`](../packages/code-runtime/code-runtime) | [`code-runtime-worker-thread`](../packages/code-runtime/code-runtime-worker-thread), [`experimental-code-runtime-python`](../packages/experimental/code-runtime-python) | [`tools`](../packages/core/tools) | - | 使用 Host 提供的异步绑定运行一段由模型编写的程序；各后端采用不同的基础环境和语言（工具注册表在 PTC mode 下消费该服务）。 |
| `ctx.fs` | `seam` | [`fs`](../packages/fs/fs) | [`fs-local`](../packages/fs/fs-local), [`fs-sandbox`](../packages/fs/fs-sandbox), [`fs-e2b`](../packages/e2b/fs-e2b) | [`tool-fs`](../packages/fs/tool-fs) | [`fs-observation-policy`](../packages/fs/fs-observation-policy) | tool-fs 通过 ctx.fs 执行读取／写入／编辑；fs-sandbox 按共享沙箱模式限制变更；fs-observation-policy 通过 fs/* 事件门禁贡献基于观测状态的检查。 |
| `ctx.compaction` | `seam` | [`compaction`](../packages/compaction/compaction) | [`compaction-basic`](../packages/compaction/compaction-basic) | [`compaction-basic`](../packages/compaction/compaction-basic) | - | 基础后端消费步骤后的压力事件和请求错误恢复事件；不存在面向模型的压缩工具。 |
| `ctx.subagents` | `seam` | [`subagent`](../packages/subagent/subagent) | [`subagent-spawn-in-process`](../packages/subagent/subagent-spawn-in-process), [`subagent-fork-in-process`](../packages/subagent/subagent-fork-in-process), [`subagent-acp`](../packages/subagent/subagent-acp), [`subagent-codex`](../packages/subagent/subagent-codex), [`subagent-claude-code`](../packages/subagent/subagent-claude-code), [`subagent-dsh-sdk`](../packages/subagent/subagent-dsh-sdk) | [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-subagent-control`](../packages/subagent/tool-subagent-control), [`tool-ralph`](../packages/workflow/tool-ralph) | - | 提供方实现传输；该服务还负责可选的、基于 Activation 的延续编排，tool-subagent 选择一次性或可延续委派，tool-subagent-control 传递后续消息，而 tool-ralph 要求一条全新的结构化输出路由。 |
| `ctx.agentTeams` | `core` | [`experimental-agent-team`](../packages/experimental/agent-team) | - | [`experimental-tool-agent-team`](../packages/experimental/tool-agent-team), [`experimental-client-ui-agent-team`](../packages/experimental/client-ui-agent-team) | - | 负责隐式 Root roster、持久 peer mailbox、共享任务 DAG、continuable child 生命周期与生成式 Team Remote method；tool-agent-team 提供模型控制工具，client-ui-agent-team 挂载浏览器 contribution。 |
| `ctx.inspector` | `core` | `inspector` | - | - | - | 负责 Worker 托管的 CDP target，以及独立于传输的 Host 和 Client observation 与 Cordis tree query API。 |
| `ctx.jobs` | `seam` | [`jobs`](../packages/jobs/jobs) | [`jobs-local`](../packages/jobs/jobs-local) | [`tool-bash`](../packages/shell/tool-bash), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-jobs`](../packages/jobs/tool-jobs) | - | 生产方（后台 bash、PTY 发送和 subagent 委派）登记正在运行的工作；tool-jobs 是面向模型的控制器，用于读取、列出和终止这些工作；jobs-local 是进程本地注册表。 |
| `ctx.web` | `seam` | [`web`](../packages/web/web) | [`web-search-exa`](../packages/web/web-search-exa), [`web-search-perplexity`](../packages/web/web-search-perplexity), [`web-search-deepseek`](../packages/web/web-search-deepseek), [`web-fetch-http`](../packages/web/web-fetch-http) | [`tool-web`](../packages/web/tool-web) | - | 搜索和抓取提供方注册到同一个 ctx.web seam；tool-web 负责稳定的面向模型名称。 |
| `ctx.spillStore` | `seam` | [`spill`](../packages/spill/spill) | [`spill-local`](../packages/spill/spill-local) | [`spill-policy`](../packages/spill/spill-policy) | - | 后端保存过大的工具文本，并返回面向模型的定位信息和取回提示；spill-policy 是 tools/post-execute 消费方，负责决定何时 spill。 |
| `ctx.directoryPicker` | `seam` | [`host-directory-picker`](../packages/host/directory-picker) | [`host-directory-picker-native`](../packages/host/directory-picker-native), [`host-directory-picker-browse`](../packages/host/directory-picker-browse) | [`api-workspace-controller`](../packages/api/workspace-controller) | - | 带判别标记的交互能力：原生后端在 Host 显示设备上打开一个操作系统选择器，浏览后端为应用内浏览器提供列表与创建原语；双端后端通过其浏览器侧填充 ui-workspace 目录流程的 slot（不通过协议发布）。 |
| `ctx.webServer` | `core` | [`host-webserver`](../packages/host/webserver) | - | [`client-connection`](../packages/client/connection), [`client-modules`](../packages/client/modules), [`client-hmr`](../packages/client/hmr) | - | 普通的 node:http 载体：具名路由注册表、索引转换 tap，以及静态 dist 回退；Web 传输插件注册自己的路由。 |
| `ctx.clientModules` | `core` | [`client-modules`](../packages/client/modules) | - | [`client-hmr`](../packages/client/hmr) | - | 通过增量 `dsh.client` 扫描组合 __DSH_BOOT__ 入口图，提供插件组合包，并通知重建／图变更订阅方。 |
| `ctx.workflowEngine` | `seam` | [`workflow`](../packages/workflow/workflow) | [`workflow-ptc`](../packages/workflow/workflow-ptc) | [`tool-workflow`](../packages/workflow/tool-workflow), [`tool-ralph`](../packages/workflow/tool-ralph) | - | 每个上下文使用一个引擎，与 bash 相同，且没有具名提供方注册表；通用工作流与固定 Ralph 消费方启动运行，其中的 agent() 调用通过 ctx.subagents 扇出。 |
| `ctx.webhookRuntime` | `core` | [`webhook`](../packages/webhook/webhook) | - | [`webhook-github`](../packages/webhook/webhook-github) | - | 提供方适配器分派已认证交付；可信插件注册独立的进程本地规则，runtime 把非 null 结果转换为普通的 Workspace-backed Session，不保留交付或完成状态。 |
| `ctx.lsp` | `seam` | [`lsp`](../packages/lsp/lsp) | [`lsp-stdio`](../packages/lsp/lsp-stdio) | [`tool-lsp`](../packages/lsp/tool-lsp) | - | 提供方注册与选择，加上恰好四种操作的标准化查询执行；该 seam 不提供协议逃生口，后端必须转换为标准化请求和结果。 |
| `ctx.dynamicCordisRunner` | `core` | [`cordis-host-runner`](../packages/extensions/cordis-host-runner) | - | [`tool-cordis`](../packages/extensions/tool-cordis) | - | 拥有内存定义注册表、Host 半的 vm 沙箱和 request-run 往返流程；浏览器页面通过其 Remote 命名空间在线访问同一服务。 |
| `ctx.cordisInspect` | `core` | [`cordis-host-runner`](../packages/extensions/cordis-host-runner) | - | [`tool-cordis`](../packages/extensions/tool-cordis) | - | 注册 Host inspect 提供方、镜像 Client 提供方 manifest，并通过动态 Cordis 传输路由 Client 查询。 |

维护模式：混合模式。服务从 Cordis 声明中发现；接口、实现和消费方角色在 `scripts/gen-doc-graphs.ts` 中分类，并设有完整性守卫。
