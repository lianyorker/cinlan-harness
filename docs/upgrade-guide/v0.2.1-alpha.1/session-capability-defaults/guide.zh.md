---
kind: upgrade-guide
description: "Web 与 Desktop 启用惰性内容搜索、使用全消息标题，并将共享代码开关放入开发者工具。"
---

# 会话能力默认配置

[English](guide.md) | 中文

## 变更

Web 与 Desktop 将 `session-query-sqlite.config.openAt` 从 `never` 改为 `first-search`，保留 `path: ":memory:"`。首次内容搜索会打开本地索引。

base 的 `session-title-llm` 行停用。新增的 `session-title-all-prompts-llm` 行使用全部符合条件的用户消息生成自动标题，每条符合条件的消息之后都可能增加一次辅助模型请求。用户手动改名后标题仍然固定。

共享的 `ui-settings.enabled` 开关从「通用」移到「数据与高级」下的「开发者工具」。已保存的值不变。Ralph 可用性由新增 Host 行 `ralph-policy` 保持默认关闭；Standard、PTC 与 Creator 的工具行改为挂载并设置 `requirePolicy: true`，而不是由 Loader 停用。原生 Auto 后端加载但不自动选择 Auto，验收未完成期间保留 EXP 提示；高权限 NodeJS Inspector 仍为可选能力。

## 迁移

1. 重启 Web 或 Desktop Host，使组合生效。搜索已保存会话中的内容，检查惰性搜索路径。
2. 使用「设置 → 通用 → 搜索会话内容」实时控制 `searchEnabled`。关闭保留索引和精确读取；部署的 `openAt: never` 仍然优先。如需在部署级保持搜索停用，在 profile 补丁中覆盖 `session-query-sqlite`，提供完整配置 `{ path: ":memory:", openAt: never }`。
3. 如需保留首条消息标题，在该补丁中设置 `session-title-all-prompts-llm.disabled: true` 和 `session-title-llm.disabled: false`。仅启用一个标题提供者。如需完全停用模型标题，保持两个条目均停用；确定性回退标题仍然可用。
4. 使用「设置 → 通用 → 自动更新会话标题」控制 `session-title.config.automaticEnabled`，无需停用提供者。关闭后保留已有标题和显式重新生成功能，并取消自动工作。
5. 在「设置 → 数据与高级 → 开发者工具」中显式开启 Ralph 可用性并保存轮数上限。这不会启动运行，仍需用户直接提出请求。自定义受策略约束的预设必须在 Host 层组合一次 `@deepseek-ai/dsh-tool-ralph/settings`。如果 profile 覆盖仍停用其 `tool-ralph` 行，该停用优先于可用性开关。
6. 旧的 Session Search、Session Titles、Ralph 与 Auto 可选建议已移除，Web bundle 已组合其真实后端或策略。使用原生设置配置，不要重复安装另一层。高权限调试仍为独立可选的「NodeJS 运行时调试」入口。
7. 在「设置 → 数据与高级 → 开发者工具」中找到原有的代码视图开关，确认其已接受值与保存的偏好一致。
