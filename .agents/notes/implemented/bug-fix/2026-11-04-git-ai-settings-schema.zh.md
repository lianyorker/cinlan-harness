# Agent Note: Git AI 设置 schema 归属

Status: implemented

[English](2026-11-04-git-ai-settings-schema.md) | 中文

## 问题

Git 设置页面通过共享的 `git-source-control` 命名空间写入 `sourceControlAi`，但 Host schema 没有声明该字段。尽管 Client 类型和控件已暴露 AI 配置，Settings 提供方仍无法将其作为经过验证的持久偏好保存。

## 决策

`GitSourceControlSettingsSchema` 与其他持久化 Git 偏好一起拥有 `sourceControlAi` 的默认值和校验。`GitSourceControlSettings` 要求已解析的 AI 设置对象；需要默认值的调用方使用共享 schema，不再维护第二种可选解释。配方模版、Diff 预算、开关和可选 runner 元数据均由该 schema 限定。

该 schema 可供浏览器安全导入，并从 `ai-author.ts` 导入共享默认对象；该模块只导入设置类型，因此默认值拥有单一运行时来源且不会形成循环依赖。

## 考虑过的替代方案

**保留可选的 `sourceControlAi` 并依赖 UI 回退值。** 这样持久化校验仍无法接受该字段，且不同 UI 消费方可能使用不同默认值。解析后的 schema 值让 Host 与 Client 共用同一配置类型。

**将 AI 偏好保存到第二个命名空间。** 这会拆分 Git 偏好所有权，并要求独立注册 Settings 和绑定页面。现有 Git 设置命名空间已拥有相关控件，是最小且一致的持久化所有者。

## 结果

共享 schema 可在 Host 与浏览器消费方中接受并规范化 AI 设置；缺少新字段的旧记录会获得默认值。Git 侧栏准备草稿时会应用已保存的启用状态、配方、Diff 预算和敏感文件过滤。一次性 runner 使用已附加 Session 记录的 provider route，允许配方只覆盖 model id，并在 dispatch 前通过仅日志 Session event 记录准确的模型请求。生成文本只填入 commit 编辑框，不会修改 Git。Diff review 和 PR description 配方仍没有动作消费者。

## 测试

`git-settings` schema 测试覆盖默认值解析、无效预算和自定义配方覆盖。Git 设置页面、AI Author helper、侧栏 Git View 与 Git Remote controller 的定向测试覆盖编辑、提示词构造、模型路由、dispatch 前日志、取消、deadline、provider 错误及仅生成草稿。这些测试没有证明设置字段经过完整 profile 重启往返，也没有覆盖真实 provider 请求。
