# Orca Migration Reference

English | [中文](README.zh.md)

## Summary

This reference compares the pinned latest upstream source with the current dirty Harness checkout. It contains 49 feature dossiers, each with a comparison, UI checklist, and execution prompt. It does not change either product or claim runtime or visual parity. The fork uses CLH product identity; follow the [CLH isolation rules](提示词使用规则.md#clh-isolation) without replacing real upstream source or dependency names.

## Contents

- [Baseline and progress](项目进度与差异总览.md)
- [Prompt rules](提示词使用规则.md)
- [Feature catalog](#feature-catalog)

<a id="feature-catalog"></a>

## Feature Catalog

| Directory | Feature | Source Assessment | Priority |
|---|---|---|---|
| [settings-navigation](settings-navigation/差异分析.md) | 设置导航与搜索 | `设计不同` | P0 |
| [accounts-models](accounts-models/差异分析.md) | 账号与模型配置 | `设计不同` | P0 |
| [sessions-agents](sessions-agents/差异分析.md) | 会话与 Agent 生命周期 | `设计不同` | P0 |
| [workspaces-worktrees](workspaces-worktrees/差异分析.md) | 工作区与 Worktree 生命周期 | `一致` | P0 |
| [terminal](terminal/差异分析.md) | 集成终端与 Shell | `一致` | P0 |
| [remote-hosts](remote-hosts/差异分析.md) | SSH 与远程执行主机 | `一致` | P0 |
| [git-and-task-sources](git-and-task-sources/差异分析.md) | Git 与任务来源 | `设计不同` | P1 |
| [browser-computer-use](browser-computer-use/差异分析.md) | 浏览器与电脑操控 | `设计不同` | P1 |
| [files-editor-diff](files-editor-diff/差异分析.md) | 文件编辑与 Diff Review | `设计不同` | P1 |
| [automation-schedule](automation-schedule/差异分析.md) | 自动化与 Schedule | `设计不同` | P0 |
| [skills-plugins](skills-plugins/差异分析.md) | Skill 与插件管理 | `设计不同` | P1 |
| [voice-dictation](voice-dictation/差异分析.md) | 语音听写与 STT | `设计不同` | P1 |
| [notifications-permissions](notifications-permissions/差异分析.md) | 通知与原生权限 | `设计不同` | P1 |
| [mobile-emulator](mobile-emulator/差异分析.md) | 移动设备与模拟器 | `设计不同` | P1 |
| [mobile-companion](mobile-companion/差异分析.md) | 手机伴侣 | `设计不同` | P0 |
| [relay-e2ee](relay-e2ee/差异分析.md) | Relay、配对与 E2EE | `设计不同` | P0 |
| [native-chat-floating-workspace](native-chat-floating-workspace/差异分析.md) | Native Chat 与浮动工作区 | `设计不同` | P1 |
| [artifacts-session-history](artifacts-session-history/差异分析.md) | 交付物与会话历史 | `设计不同` | P1 |
| [runtime-environments-vms](runtime-environments-vms/差异分析.md) | 远程 Runtime 与临时 VM | `一致` | P2 |
| [diagnostics-release](diagnostics-release/差异分析.md) | 诊断与桌面更新 | `待运行验收` | P1 |
| [security-research](security-research/差异分析.md) | Cinlan 安全研发能力 | `设计不同` | P1 |
| [appearance-theme](appearance-theme/差异分析.md) | 主题、字体与界面外观 | `设计不同` | P1 |
| [keyboard-shortcuts](keyboard-shortcuts/差异分析.md) | 快捷键与终端优先策略 | `一致` | P0 |
| [mcp-servers](mcp-servers/差异分析.md) | MCP 服务配置与运行状态 | `设计不同` | P1 |
| [agent-orchestration](agent-orchestration/差异分析.md) | 多 Agent 编排 | `设计不同` | P0 |
| [model-discovery](model-discovery/差异分析.md) | 运行时模型发现 | `设计不同` | P1 |
| [git-ai-author](git-ai-author/差异分析.md) | Git AI Author 与动作配方 | `一致` | P2 |
| [port-forwarding](port-forwarding/差异分析.md) | 工作区端口发现与 SSH 转发 | `一致` | P2 |
| [skill-sharing](skill-sharing/差异分析.md) | Skill 审核与链接分享 | `设计不同` | P2 |
| [setup-onboarding](setup-onboarding/差异分析.md) | 首次使用与配置引导 | `设计不同` | P1 |
| [network-proxy](network-proxy/差异分析.md) | 网络代理与兼容模式 | `设计不同` | P2 |
| [usage-analytics](usage-analytics/差异分析.md) | 用量、覆盖率与统计 | `设计不同` | P1 |
| [privacy-telemetry](privacy-telemetry/差异分析.md) | 隐私、Telemetry 与诊断同意 | `设计不同` | P1 |
| [repository-hooks](repository-hooks/差异分析.md) | 仓库 Setup/Cleanup Hooks | `设计不同` | P1 |
| [sparse-checkout](sparse-checkout/差异分析.md) | Sparse Checkout 与目录预设 | `一致` | P2 |
| [quick-commands](quick-commands/差异分析.md) | 终端快捷命令 | `一致` | P2 |
| [input-editing](input-editing/差异分析.md) | 输入与剪贴板行为 | `设计不同` | P2 |
| [experimental-controls](experimental-controls/差异分析.md) | 实验能力与开发工具 | `设计不同` | P2 |
| [chat-appearance](chat-appearance/差异分析.md) | 聊天呈现与链接打开策略 | `设计不同` | P1 |
| [git-api-budget](git-api-budget/差异分析.md) | Git Provider API 预算 | `一致` | P2 |
| [editor-preferences](editor-preferences/差异分析.md) | 编辑器偏好与保存策略 | `一致` | P2 |
| [repository-project-settings](repository-project-settings/差异分析.md) | 项目与仓库级设置 | `设计不同` | P1 |
| [integrations-auth](integrations-auth/差异分析.md) | 外部集成连接与就绪检查 | `设计不同` | P1 |
| [design-element-capture](design-element-capture/差异分析.md) | Design Mode 与元素捕获 | `设计不同` | P1 |
| [file-image-references](file-image-references/差异分析.md) | 文件引用、拖放与图片附件 | `设计不同` | P1 |
| [quick-open](quick-open/差异分析.md) | Quick Open 与命令检索 | `设计不同` | P1 |
| [diff-line-comments](diff-line-comments/差异分析.md) | Diff 行评论与发送 Agent | `一致` | P1 |
| [cli-control](cli-control/差异分析.md) | CLI 控制与自动化入口 | `设计不同` | P2 |
| [browser-preferences](browser-preferences/差异分析.md) | 浏览器偏好、Profile 与 Cookie | `设计不同` | P1 |

## Evidence

The baseline, source hashes, and original prompt hashes are in [baseline.json](../exports/baseline.json). The reproducible slice is in [upstream-paths.txt](../exports/upstream-paths.txt). Samples are ignored, not product code. A partial clone also exists; neither it nor the source slice was built or launched.

## Validation

See the [progress report](项目进度与差异总览.md) for commands and limitations. Use the shared prompt rules before executing a feature prompt. No screenshots, hardware tests, or full product suite were run in this documentation task.
