# 官方与本地包目录清单

口径：packages/*/* 和 apps/* 下存在 package.json 的目录，包含 private 与 experimental；不是 release family 成员清单。src变化包括注释、格式和生成源码，不能直接解释成功能变化。机器证据见 packages.json。

## local-only

| 包目录 | 官方版本 | 本地版本 | src文件状态 |
|---|---|---|---|
| packages/api/automation-controller | — | 0.1.6-alpha.2 | local-only: 7 |
| packages/api/browser-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/device-capabilities-controller | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/api/execution-host-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/integration-preflight-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/mcp-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/security-research-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/sidebar-git-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/sidebar-terminal-controller | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/api/usage-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/voice-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/work-items-controller | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/api/workspace-isolation-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/api/worktree-task-controller | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/artifact/artifact | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/artifact/artifact-local | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/artifact/artifact-memory | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/automation/automation | — | 0.1.6-alpha.2 | local-only: 9 |
| packages/browser/browser | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/browser/browser-cinlan | — | 0.1.6-alpha.2 | local-only: 4 |
| packages/browser/browser-permission-policy | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/browser/browser-playwright | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/browser/tool-browser | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/browser/tool-browser-element-capture | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/cinlan-browser | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/cinlan-computer-use | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/cinlan-mobile-device | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/cinlan-work-items | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/execution-host-app | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/security-findings | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/security-research | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/security-skills | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/security-workflow | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/bundle/vuln-kb | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/client/keyboard | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/client/ui-better-sidebar | — | 0.1.6-alpha.2 | local-only: 122 |
| packages/client/ui-browser-element-capture | — | 0.1.6-alpha.2 | local-only: 7 |
| packages/client/ui-floating-workspace | — | 0.1.6-alpha.2 | local-only: 15 |
| packages/client/ui-git-settings | — | 0.1.6-alpha.2 | local-only: 8 |
| packages/client/ui-integrations | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/client/ui-keybindings | — | 0.1.6-alpha.2 | local-only: 7 |
| packages/client/ui-notifications | — | 0.1.6-alpha.2 | local-only: 8 |
| packages/client/ui-orchestration | — | 0.1.6-alpha.2 | local-only: 7 |
| packages/client/ui-right-sidebar | — | 0.1.6-alpha.2 | local-only: 11 |
| packages/client/ui-settings-automation | — | 0.1.6-alpha.2 | local-only: 10 |
| packages/client/ui-settings-hosts | — | 0.1.6-alpha.2 | local-only: 12 |
| packages/client/ui-settings-mcp | — | 0.1.6-alpha.2 | local-only: 10 |
| packages/client/ui-settings-security | — | 0.1.6-alpha.2 | local-only: 19 |
| packages/client/ui-settings-terminal | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/client/ui-settings-usage | — | 0.1.6-alpha.2 | local-only: 9 |
| packages/client/ui-sidebar-textpreview | — | 0.1.6-alpha.2 | local-only: 12 |
| packages/client/ui-voice-dictation | — | 0.1.6-alpha.2 | local-only: 14 |
| packages/client/ui-work-items | — | 0.1.6-alpha.2 | local-only: 8 |
| packages/client/ui-workspace-isolation | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/client/ui-worktree-task | — | 0.1.6-alpha.2 | local-only: 8 |
| packages/code-runtime/code-runtime | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/code-runtime/code-runtime-worker-thread | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/computer-use/computer-use-cinlan | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/computer-use/computer-use-permission-policy | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/computer-use/tool-computer-use | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/coordination/coordination | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/coordination/coordination-browser-element-capture | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/coordination/coordination-local | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/coordination/coordination-subagent-executor | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/coordination/tool-coordination | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/e2b/e2b | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/e2b/fs-e2b | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/e2b/subprocess-e2b | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/execution-host/execution-host | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/execution-host/execution-host-local | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/execution-host/execution-host-targets | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/execution-host/execution-host-worker | — | 0.1.6-alpha.2 | local-only: 6 |
| packages/experimental/code-runtime-python | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/git/git | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/git/git-local | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/git/git-settings | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/git/sidebar-git | — | 0.1.6-alpha.2 | local-only: 5 |
| packages/git/tool-git | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/mcp/mcp-management | — | 0.1.6-alpha.2 | local-only: 5 |
| packages/mobile-device/mobile-device | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/mobile-device/mobile-device-cinlan | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/mobile-device/mobile-device-permission-policy | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/mobile-device/tool-mobile-device | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/notifications/notifications | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/security/assessment-scope | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/security/assessment-scope-session | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/assessment-scope-settings | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/assessment-scope-static | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/assessment-scope-tool-policy | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/finding | — | 0.1.6-alpha.2 | local-only: 5 |
| packages/security/finding-export | — | 0.1.6-alpha.2 | local-only: 5 |
| packages/security/finding-session | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/security-skills | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/security-workflow-prompt | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/tool-finding | — | 0.1.6-alpha.2 | local-only: 4 |
| packages/security/tool-vuln-kb | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/vuln-kb-nvd | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/security/vuln-kb-service | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/session-query/usage-query | — | 0.1.6-alpha.2 | local-only: 3 |
| packages/terminal/sidebar-terminals | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/voice/voice | — | 0.1.6-alpha.2 | local-only: 4 |
| packages/voice/voice-sherpa-onnx | — | 0.1.6-alpha.2 | local-only: 10 |
| packages/work-items/tool-work-items | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/work-items/work-items | — | 0.1.6-alpha.2 | local-only: 5 |
| packages/work-items/work-items-github | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/work-items/work-items-gitlab | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/work-items/work-items-linear | — | 0.1.6-alpha.2 | local-only: 1 |
| packages/workflow/workflow-worker-thread | — | 0.1.6-alpha.2 | local-only: 9 |
| packages/workspace/workspace-isolation | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/workspace/workspace-isolation-git | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/workspace/worktree-task | — | 0.1.6-alpha.2 | local-only: 2 |
| packages/workspace/worktree-task-git | — | 0.1.6-alpha.2 | local-only: 2 |

## official-only

| 包目录 | 官方版本 | 本地版本 | src文件状态 |
|---|---|---|---|
| packages/boot/hmr | 0.1.6-alpha.2 | — | official-only: 3 |
| packages/client/ui-sidebar-browser | 0.1.6-alpha.2 | — | official-only: 13 |
| packages/client/ui-sidebar-documentpreview | 0.1.6-alpha.2 | — | official-only: 65 |
| packages/client/ui-sidebar-terminal | 0.1.6-alpha.2 | — | official-only: 18 |
| packages/compaction/compaction-image-offload | 0.1.6-alpha.2 | — | official-only: 4 |
| packages/experimental/ptc-runtime-python | 0.1.6-alpha.2 | — | official-only: 2 |
| packages/skill/skill-office | 0.1.6-alpha.2 | — | official-only: 1 |
| packages/test-support/remote-mock | 0.1.6-alpha.2 | — | official-only: 5 |
| packages/util/chunked-list | 0.1.6-alpha.2 | — | official-only: 1 |
| packages/util/lazy-require | 0.1.6-alpha.2 | — | official-only: 1 |
| packages/workflow/workflow-ptc | 0.1.6-alpha.2 | — | official-only: 9 |

## shared

| 包目录 | 官方版本 | 本地版本 | src文件状态 |
|---|---|---|---|
| apps/cli | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; identical: 3; official-only: 1 |
| apps/desktop | 0.1.6-alpha.2 | 0.1.6-alpha.2 | official-only: 29; modified: 11; local-only: 12; identical: 1 |
| apps/desktop-host | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; official-only: 4; local-only: 1 |
| apps/web | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 3 |
| packages/acp/acp | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 7 |
| packages/api/gateway | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; identical: 7 |
| packages/api/remotes | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3; identical: 1 |
| packages/api/session-controller | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 17; identical: 16; local-only: 1 |
| packages/api/settings-controller | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/api/terminal-controller | 0.1.6-alpha.2 | 0.1.6-alpha.2 | official-only: 10; modified: 2 |
| packages/api/workspace-controller | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 8 |
| packages/api/workspace-files | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 7; identical: 1 |
| packages/attachment/attachment | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3; modified: 3 |
| packages/attachment/attachment-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4; modified: 4; official-only: 1 |
| packages/boot/app-boot | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3; local-only: 1; official-only: 6 |
| packages/boot/cmdline | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/boot/plugin-manager | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6; modified: 2; official-only: 1 |
| packages/browser-use/browser-use | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/bundle/acp-app | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/bundle/base | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/bundle/headless | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 3 |
| packages/bundle/sdk-app | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/bundle/sdk-minimal | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/bundle/web-app | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/client/connection | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 9; modified: 6; local-only: 1 |
| packages/client/file-upload | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 5 |
| packages/client/hmr | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3; identical: 1 |
| packages/client/locale | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 7; modified: 4 |
| packages/client/modules | 0.1.6-alpha.2 | 0.1.6-alpha.2 | official-only: 2; modified: 4; identical: 1 |
| packages/client/resources | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 2 |
| packages/client/store | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/client/ui-agent-preset | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 8 |
| packages/client/ui-approval | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 7 |
| packages/client/ui-attachment | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 14; modified: 3; official-only: 1 |
| packages/client/ui-brand-official | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/client/ui-chat | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 62; modified: 23 |
| packages/client/ui-commands | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 8; official-only: 2; identical: 2 |
| packages/client/ui-conversation | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 31; identical: 30; official-only: 11; local-only: 6 |
| packages/client/ui-deliverables | 0.1.6-alpha.2 | 0.1.6-alpha.2 | local-only: 5; modified: 12; identical: 10; official-only: 2 |
| packages/client/ui-directory-picker-browse | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6 |
| packages/client/ui-directory-picker-native | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/client/ui-dockkit | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 10; identical: 11; official-only: 1 |
| packages/client/ui-goal | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 11 |
| packages/client/ui-input-trigger | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 5; identical: 9 |
| packages/client/ui-jobs | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6 |
| packages/client/ui-layout | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 8; local-only: 2; identical: 2 |
| packages/client/ui-message-feedback | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 9; modified: 3 |
| packages/client/ui-model-selection | 0.1.6-alpha.2 | 0.1.6-alpha.2 | local-only: 3; identical: 5; modified: 5 |
| packages/client/ui-open-in-app | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 5 |
| packages/client/ui-permission-presets | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4; modified: 4; official-only: 3 |
| packages/client/ui-plan | 0.1.6-alpha.2 | 0.1.6-alpha.2 | local-only: 1; modified: 3; identical: 12 |
| packages/client/ui-plugin-manager | 0.1.6-alpha.2 | 0.1.6-alpha.2 | local-only: 3; official-only: 3; identical: 4; modified: 4 |
| packages/client/ui-primitives | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 61; official-only: 6; modified: 24; local-only: 1 |
| packages/client/ui-reference | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/client/ui-renderer | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 4; official-only: 1 |
| packages/client/ui-schedule | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6 |
| packages/client/ui-session | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/client/ui-settings | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; identical: 4; local-only: 1 |
| packages/client/ui-settings-general | 0.1.6-alpha.2 | 0.1.6-alpha.2 | official-only: 4; identical: 9; modified: 5; local-only: 1 |
| packages/client/ui-settings-models | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 11; identical: 14; official-only: 1 |
| packages/client/ui-settings-plugin-inventory | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; identical: 2 |
| packages/client/ui-settings-plugins | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 12; local-only: 7; official-only: 8; identical: 6 |
| packages/client/ui-settings-unarchive-sessions | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; identical: 2 |
| packages/client/ui-sidebar | 0.1.6-alpha.2 | 0.1.6-alpha.2 | official-only: 2; modified: 5; identical: 2 |
| packages/client/ui-sidebar-files | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 5; official-only: 2; local-only: 1; identical: 3 |
| packages/client/ui-sidebar-right | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 17; official-only: 4; identical: 3 |
| packages/client/ui-skill | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 1 |
| packages/client/ui-slots | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/client/ui-subagent | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; identical: 5; official-only: 2 |
| packages/client/ui-theme | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 7; identical: 11 |
| packages/client/ui-tool | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 26; modified: 8; official-only: 1 |
| packages/client/ui-trajectory | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 24; modified: 13; official-only: 2 |
| packages/client/ui-user-questions | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6; modified: 4 |
| packages/client/ui-workflow-run | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 2 |
| packages/client/ui-workspace | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 10 |
| packages/client/web | 0.1.6-alpha.2 | 0.1.6-alpha.2 | official-only: 3; modified: 5; identical: 4 |
| packages/compaction/command-compact | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/compaction/compaction | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 4 |
| packages/compaction/compaction-basic | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 3 |
| packages/compaction/compaction-tool-result-pruner | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 1 |
| packages/computer-use/computer-use | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1; modified: 1; local-only: 1 |
| packages/context/agent-instructions | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 4 |
| packages/context/file-reference | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/context/file-reference-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/context/session-reference | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 2 |
| packages/context/time-context | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 2 |
| packages/context/tmux-context | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/core/agent | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6; modified: 2 |
| packages/core/agent-default-model | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/core/agent-loop | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 5; identical: 3 |
| packages/core/agent-tool-presentation | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/core/scope | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3; modified: 1 |
| packages/core/session | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 5; identical: 4 |
| packages/core/system-prompt | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/core/tools | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 6; identical: 4 |
| packages/credentials/authorization | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/credentials/credentials | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/credentials/credentials-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/deliverables/tool-present | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/deliverables/workspace-changes | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 8 |
| packages/document/office-to-pdf | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 1 |
| packages/experimental/agent-team | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 13; modified: 3 |
| packages/experimental/agent-team-profile | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/experimental/agent-team-web-profile | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/experimental/auto-review | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/experimental/browser-use-chrome-devtools-mcp | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/experimental/browser-use-playwright-mcp | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/experimental/browser-use-runtime | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/experimental/browser-use-stagehand-native | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6 |
| packages/experimental/client-ui-agent-team | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6; modified: 1 |
| packages/experimental/computer-use-cua-driver-mcp | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/experimental/computer-use-cua-driver-native | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/experimental/inspector | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 148 |
| packages/experimental/tool-agent-team | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/experimental/webworker-packer | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3; modified: 3 |
| packages/experimental/webworker-runtime | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 10; identical: 69; official-only: 2 |
| packages/extensions/cordis-client-runner | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 5; identical: 6 |
| packages/extensions/cordis-host-runner | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 2 |
| packages/extensions/tool-cordis | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; local-only: 2; identical: 1 |
| packages/extensions/ui-cordis | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 16; modified: 2 |
| packages/feedback/command-feedback | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/feedback/message-feedback | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/fs/fs | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/fs/fs-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/fs/fs-observation-policy | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/fs/fs-sandbox | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/fs/tool-fs | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3; identical: 8 |
| packages/fs/tool-fs-search | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6; modified: 1 |
| packages/fs/tool-str-replace-editor | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/goal/command-goal | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/goal/goal | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 2 |
| packages/goal/goal-round-driver | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/goal/tool-goal | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 2 |
| packages/guard/repeat-tool-reminder | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/guard/timeout-policy | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/hooks/hook-protocol | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 8; modified: 1 |
| packages/hooks/hooks-claude-code | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1; modified: 1 |
| packages/hooks/hooks-codex | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1; modified: 1 |
| packages/host/directory-picker | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/host/directory-picker-auto | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 2 |
| packages/host/directory-picker-browse | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/host/directory-picker-native | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; identical: 3 |
| packages/host/frontend-static | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/host/open-in-app | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4; modified: 2 |
| packages/host/plugin-inventory | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2 |
| packages/host/webserver | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/identity/anonymous-user-id | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/interaction/commands | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4 |
| packages/interaction/permission-presets | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1; modified: 3 |
| packages/interaction/tool-ask-user | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/interaction/user-approval | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/interaction/user-questions | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1; modified: 1 |
| packages/jobs/jobs | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/jobs/jobs-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/jobs/tool-jobs | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/llm/deepseek-llm-api-extensions | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/llm/llm | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 6; identical: 8 |
| packages/llm/llm-deepseek | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 5; official-only: 19; local-only: 14; identical: 5 |
| packages/llm/llm-pi-ai | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 10; modified: 2 |
| packages/llm/llm-retry | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4; modified: 1 |
| packages/llm/plugin-package-inventory-deepseek | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/llm/token-meter | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 5; identical: 6 |
| packages/lsp/lsp | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/lsp/lsp-stdio | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 8 |
| packages/lsp/tool-lsp | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/mcp/mcp-client | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 4; local-only: 7; official-only: 1 |
| packages/mcp/mcp-resources | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 1 |
| packages/plan/plan-mode | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 2 |
| packages/preset/agent-presets | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 7; modified: 5 |
| packages/preset/persona | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/ptc-runtime/ptc-runtime | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/ptc-runtime/ptc-runtime-node | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 13; local-only: 1 |
| packages/runtime-diagnostics/invariants | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/sandbox/sandbox | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/sandbox/sandbox-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/sandbox/sandbox-policy | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/sandbox/sandbox-windows-acl | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6; modified: 4 |
| packages/schedule/schedule | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6; modified: 4 |
| packages/sdk/client | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6 |
| packages/sdk/protocol | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/sdk/server | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1; modified: 1 |
| packages/session-query/session-log-export | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4; modified: 5 |
| packages/session-query/session-query | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 7; modified: 5 |
| packages/session-query/session-query-sqlite | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 2 |
| packages/session-query/tool-session-query | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6 |
| packages/session/session-checkpoint-policy | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/session/session-format | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 8 |
| packages/session/session-format-catalog | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 2; official-only: 1 |
| packages/session/session-format-v0-to-v1 | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 7; modified: 3 |
| packages/session/session-format-v1-to-v2 | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 4 |
| packages/session/session-format-v2-to-v3 | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 5 |
| packages/session/session-log-deepseek | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3 |
| packages/session/session-persistence | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4; modified: 1 |
| packages/session/session-persistence-jsonl | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 10 |
| packages/session/session-projection | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/session/session-projection-cache | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/session/session-stats | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/session/session-telemetry | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/session/session-telemetry-otel | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/session/session-title | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 3 |
| packages/session/session-title-all-prompts-llm | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/session/session-title-first-prompt-llm | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/session/session-title-llm | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/session/session-turn-outline | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/settings/settings | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/settings/settings-file | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/shell/bash-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/shell/bash-sandbox | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/shell/pwsh-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/shell/pwsh-sandbox | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2 |
| packages/shell/shell | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/shell/shell-env | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/shell/tool-bash | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 1 |
| packages/shell/tool-bash-persistent | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/shell/tool-pwsh | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/shell/tool-pwsh-persistent | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/skill/skill | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/skill/skill-badge | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/skill/skill-filesystem | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/skill/tool-skill | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/spill/spill | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1; modified: 1 |
| packages/spill/spill-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/spill/spill-policy | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 1 |
| packages/ssh/fs-ssh | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/ssh/sandbox-ssh | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/ssh/ssh | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 7 |
| packages/ssh/subprocess-ssh | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/storage/storage | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/storage/storage-domain | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 6 |
| packages/storage/storage-json | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5 |
| packages/storage/storage-sqlite | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/subagent/subagent | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 13; official-only: 1; modified: 9 |
| packages/subagent/subagent-acp | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/subagent/subagent-claude-code | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/subagent/subagent-codex | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/subagent/subagent-dsh-sdk | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/subagent/subagent-fork-in-process | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/subagent/subagent-in-process-driver | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/subagent/subagent-spawn-in-process | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/subagent/tool-subagent | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 5 |
| packages/subagent/tool-subagent-control | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/subprocess/subprocess | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/subprocess/subprocess-local | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 11; modified: 5 |
| packages/subprocess/win32-process | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3; modified: 3; official-only: 1 |
| packages/terminal/terminal | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/terminal/terminal-bash | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 2 |
| packages/terminal/tool-terminal | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1; identical: 1 |
| packages/test-support/agent-loop-testkit | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/test-support/client-runtime | 0.1.6-alpha.2 | 0.1.6-alpha.2 | official-only: 8; modified: 5; identical: 4; local-only: 1 |
| packages/test-support/llm-mock-server | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/test-support/llm-replay | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/test-support/loader-smoke | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2 |
| packages/test-support/session-snapshot | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 5; modified: 4 |
| packages/todo/tool-todo | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3; modified: 1 |
| packages/typert/generator | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3; identical: 5 |
| packages/typert/loader | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/typert/protocol | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; official-only: 1; identical: 1 |
| packages/typert/registry | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 2 |
| packages/util/atomic-write | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/util/brand | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/util/crypto | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/util/deque | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/util/home-paths | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/util/http-proxy | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2; modified: 1 |
| packages/util/launch-environment | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/util/native-command | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/util/output-retention | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/util/package-manifest | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2 |
| packages/util/time | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/util/timeout | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/util/values | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 1 |
| packages/util/workspace-path | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2 |
| packages/web/tool-web | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4; modified: 1 |
| packages/web/web | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 2 |
| packages/web/web-fetch-http | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/web/web-search-deepseek | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/web/web-search-exa | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/web/web-search-perplexity | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 3 |
| packages/webhook/webhook | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3; identical: 2 |
| packages/webhook/webhook-github | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 4 |
| packages/workflow/tool-ralph | 0.1.6-alpha.2 | 0.1.6-alpha.2 | identical: 1 |
| packages/workflow/tool-workflow | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 1 |
| packages/workflow/workflow | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 3; identical: 1 |
| packages/workspace/workspace | 0.1.6-alpha.2 | 0.1.6-alpha.2 | modified: 2; identical: 4 |
