---
kind: upgrade-guide
description: "直接组合 Auto 审查插件时必须明确输入、输出与超时限制。"
---

# Auto 审查请求限制

[English](guide.md) | 中文

## 变更

Auto 插件要求 `maxInputBytes`、`maxOutputTokens` 和 `timeoutMs`。缺少这些字段的直接插件行无法通过配置验证。Bundle 提供 262144 字节、1024 输出 token 与 60000 毫秒。输入超限时在模型请求前拒绝，不截断输入；期限到达后，在执行工具前拒绝晚到的放行。模型提供方必须响应取消才能及时结清。

## 迁移

1. 对直接插件行，将完整配置设为 `{ maxInputBytes: 262144, maxOutputTokens: 1024, timeoutMs: 60000 }`，按部署需要调整正整数取值。Bundle 用户继承这些值，除非后续 profile 补丁替换配置。
2. 直接调用 `ctx.plugin(AutoReview, config)` 时也提供这些字段。重启 Host，确认 Auto 选项可用后，再为 Session 选择它。
3. 被输入超限或超时拒绝的调用保持未执行。检查错误并缩小任务，或明确调整部署限制；不要把失败理解为允许使用 Full access。
