# Agent Note: 研究预设保留 Session 权限

Status: implemented

[English](2026-10-21-research-session-permissions.md) | 中文

## 问题

研究预设初始化 Agent 时把 Session 审批策略覆盖为 `never`。以 `workspace-write` 和 `ask` 初始化的新 Session 因而显示为 Custom。原本的意图是避免审批提示中断研究，但 `never` 会拒绝审批请求，并非授权这些操作。

## 决策

[研究组合包](../../../../packages/bundle/security-research/src/index.ts)贡献角色、技能和工具，不设置 Session 权限。PermissionPresetService 负责新 Session 的权限初始化；已有 Session 仍以持久化覆盖值为准。部署和用户默认值保持可配置，基础默认值为 `workspace-write` 和 `ask`。

此决策部分取代 [Web 组合决策](../feature/2026-09-10-worktree-sidebar-security-integration.zh.md)中的审批覆盖。该记录仍保留独立的 Worktree、侧边栏和评估范围决策。研究角色不授予评估权限，也不绕过工具或 sandbox policy。

## 考虑过的替代方案

**继续强制 `never` 以避免提示。** 拒绝，因为它隐式修改选定的 Session 权限，并确定性拒绝需要审批的操作。角色不拥有审批默认值。

**将混合策略重新标为 workspace-write。** 拒绝，因为标签会掩盖 `ask` 与 `never` 的区别。

**将全部已有 Session 改写为 `ask`。** 拒绝，因为持久化覆盖值可能表达用户的明确选择。需要时由用户显式选择其他权限。

## 结果

新研究 Session 与其他预设遵循同一套权限默认值。研究操作可通过已配置的应答器请求审批；没有可用应答器时仍默认拒绝。已有 Session 可继续显示 Custom，具体见[升级指南](../../../../docs/upgrade-guide/v0.2.1-alpha.1/research-session-permissions/guide.zh.md)。

## 验证

定向测试覆盖不依赖审批服务的预设注册，以及 Agent 启动时保留原策略。冷启动 Web/Host 联调从手机界面创建 Session，从 Host 投影读取 `workspace-write`，并检查 Web 权限标签。已有 Custom Session 及其 assistant 回复在 Host 重启后保留。Desktop 创建入口、其他 profile 和自定义默认值组合尚未验证。
