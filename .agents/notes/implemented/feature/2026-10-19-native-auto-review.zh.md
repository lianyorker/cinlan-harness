# Agent Note: 原生当前会话 Auto 后端

Status: implemented

[English](2026-10-19-native-auto-review.md) | 中文

## Problem

权限选项缺少逐调用授权后端时不能工作。独立插件开关会重复能力选择，也可能让已保存 Auto Session 缺少必需的审查者。

## Decision

[Auto guard](../../../../packages/guard/auto-review/README.zh.md)在 `packages/guard/auto-review` 拥有授权逻辑，发布名为 `@deepseek-ai/dsh-auto-review`。Web bundle 安装一个有界后端，可选 bundle 清单移除旧实验名称。源码导入、测试、编译引用、发布载荷与生成目录同时跟随新所有者更新。

后端存在与权限选择独立。Auto 仍仅限当前会话，保留可见风险确认，不能成为未来会话默认值，也不向子执行转移 Auto 权限状态。原生/PTC 审查、拒绝、技术失败、日志、取消和卸载行为不变，`auto` 预设和审计事件身份保持稳定。工作树持久化确认及完整验收未完成，因此保留 EXP 提示；迁移不代表发布认证。

此决策部分替代 [Auto 决策](2026-08-28-auto-review.zh.md)的可选安装与包归属选择；其权威顺序和安全限制继续有效。不改写历史 Session 代次或已接受持久化记录。

## Alternatives considered

隐藏未挂载插件行会留下不可用模式。将实验提供方导入稳定 bundle 违反产品隔离。自动选择 Auto 会在用户未选择时改变执行权限。因包移动而移除风险提示会把组合与验收混淆。

## Consequences

既有安装采用原生 Web 行前必须移除旧可选 bundle，否则重复集成注册会失败。会话 UI 与 Loader 测试验证可用性、默认值不变、显式选择、人工审批路径和撤回行为。持久化兼容失败、完整浏览器回放漂移与真实提供方认证分别报告。
