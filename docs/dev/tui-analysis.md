# TUI（终端用户界面）分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

TUI 是终端交互界面能力，提供基于 `@earendil-works/pi-tui` 的全功能终端聊天界面。包含两个包：通用 TUI 交互层和 Codex 专用 TUI 实现。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `interaction/tui` | Service Definition + 基础 | TUI 运行时和组件 | 28 文件, ~350KB |
| `interaction/codex-tui` | 实现 | Codex 专用 TUI 启动器 | 3 文件, ~5.7KB |

## TUI 基础包（`interaction/tui`）

77696 行的 `index.ts` + 28 个源文件，是最大的交互包。

### 源文件结构

| 目录/文件 | 说明 |
|-----------|------|
| `index.ts` (77.7KB) | 主入口：TUI 运行时、聊天循环、配置 |
| `config.ts` (10.7KB) | TUI 配置 |
| `prompt.ts` (8.6KB) | 系统提示词 |
| `runtime.ts` (2.9KB) | 运行时启动 |
| `startup.ts` (3.7KB) | 启动流程 |
| `invariant.ts` (1KB) | 运行时不变量 |
| **chat/** | |
| `approval.ts` | 审批交互 |
| `autocomplete.ts` | 自动补全 |
| `channel.ts` | 频道管理 |
| `file-autocomplete.ts` (20KB) | 文件路径补全 |
| `helpers.ts` | 辅助函数 |
| `model-command.ts` | 模型切换命令 |
| `questions.ts` | 问答交互 |
| `resume.ts` (16.3KB) | 会话恢复 |
| `skill-invocation.ts` | 技能调用 |
| `timing.ts` (15.3KB) | 计时和性能 |
| `tokens.ts` | Token 计数 |
| **components/** | |
| `content.ts` | 内容渲染 |
| `dialogs.ts` (51KB) | 对话框组件 |
| `text.ts` | 文本渲染 |
| `theme.ts` (14.4KB) | 主题系统 |
| `transcript.ts` (34.9KB) | 会话记录 |
| `xml-tool-output.ts` | XML 工具输出 |
| **extension/** | |
| `overlay-manager.ts` (11.5KB) | 覆盖层管理 |
| `types.ts` | 扩展类型 |

### 核心功能

- **聊天循环** — 模型对话、工具调用、审批
- **会话恢复** — 从持久化日志恢复 TUI 会话
- **文件路径补全** — 工作区内文件路径自动补全
- **模型切换** — 运行时切换模型
- **技能调用** — 调用注册的技能
- **主题系统** — 可配置的终端主题
- **审批交互** — 工具调用的审批门控
- **会话记录** — 完整的会话记录和回放

## Codex TUI（`interaction/codex-tui`）

5709 行的 `index.ts`，Codex 专用 TUI 启动器。

### 源文件

| 文件 | 说明 |
|------|------|
| `index.ts` (5.7KB) | 启动入口 |
| `launch.ts` (3.6KB) | 启动流程 |
| `transport.ts` (12.3KB) | 传输层 |

### 功能

- 通过 Codex App Server 传输层连接
- 复用 TUI 基础包的组件和运行时
- 启动 Codex 专用配置

## Bundle

| Bundle | 说明 |
|--------|------|
| `cinlan-tui` | TUI bundle |
| `cinlan-codex-tui` | Codex TUI bundle |

## 与其他能力的关系

- `agent` — TUI 运行 Agent 对话循环
- `session` — 会话恢复和记录
- `tools` — 工具调用审批
- `skill` — 技能调用
- `api/codex-app-server` — Codex TUI 通过此服务器连接

## main 中是否存在

❌ main 没有 `interaction/tui` 和 `interaction/codex-tui`。需要完整迁移。

## 注意事项

- 依赖 `@earendil-works/pi-tui`（有 patch：`patches/@earendil-works__pi-tui@0.80.7.patch`）
- `dialogs.ts` 51KB 是最大的单文件，包含所有对话框组件
- `transcript.ts` 35KB 包含会话记录和回放逻辑
- TUI 是终端用户的交互入口，与 Web UI 互补
