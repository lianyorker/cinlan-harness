---
kind: upgrade-guide
description: "Auto review 迁入原生 guard 包和 Web 组合，明确保留会话级选择及待完成验收。"
---

# 原生 Auto review 后端

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-experimental-auto-review` 迁为 `packages/guard/auto-review` 下的 `@deepseek-ai/dsh-auto-review`。Web 与 Desktop 默认挂载一个有界 `auto-review` 后端。加载只向当前会话权限选择器提供 Auto，不会自动选择、改变未来会话默认值或向子执行转发 Auto 权限状态。兼容确认和完整验收未完成期间保留风险确认及 EXP 提示。

`auto` 预设 ID 和必需的 `auto-review/request` 事件不变。审查可能误放行，获准调用以 Full access 执行。精确审查输入随 Session 日志保留，不认识事件的读取器会拒绝。本次包迁移不表示已发布或真实提供方完整验收通过。

## 迁移

1. 重启既有 Web/Desktop profile 前，移除已安装的 `@deepseek-ai/dsh-experimental-auto-review` 可选 bundle 及挂载它的额外行。不要在当前 Web bundle 之上再次叠加新包，重复注册会报错，不会任意选择审查者。保留 Session 文件。
2. 将直接依赖、导入和自定义插件行替换为 `@deepseek-ai/dsh-auto-review`。自定义非 Web profile 必须提供所需服务及完整配置 `{ maxInputBytes: 262144, maxOutputTokens: 1024, timeoutMs: 60000 }`，按部署需求明确调整。
3. 确认新 Session 仍选择原普通默认模式，Auto 在 composer 与 `/permission` 选择器可见，取消确认不切换当前模式。仅对可信当前任务选择 Auto。
4. 发布或与其他构建共享相关 Session 前解决尚未通过的持久化兼容检查。若在有活动 Auto Session 时停用后端，保留已记录的 Full access 迁移行为，并在继续前检查该模式。
